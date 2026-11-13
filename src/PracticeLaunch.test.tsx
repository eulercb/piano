// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import { PracticeLaunch } from './PracticeLaunch';
import { demoSong } from './music';
import { stubDialogs } from './testDialog';

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
let finishResume: (() => void) | undefined;
class Audio extends EventTarget {
  static instances: Audio[] = []; static pending = false;
  state = Audio.pending ? 'suspended' : 'running'; currentTime = 0; destination = {};
  constructor() { super(); Audio.instances.push(this); }
  resume() { return new Promise<void>(resolve => { finishResume = () => { this.state = 'running'; resolve(); }; if (!Audio.pending) finishResume(); }); }
  close() { return Promise.resolve(); }
  createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
beforeEach(() => { stubDialogs(); localStorage.clear(); Audio.instances = []; Audio.pending = false; finishResume = undefined; vi.stubGlobal('AudioContext', Audio); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('starts on an accessible plan without playback, grading, or keyboard preview', () => {
  render(<StrictMode><App /></StrictMode>);
  expect(screen.getByRole('heading', { name: 'Let’s play a little.' })).toBe(document.activeElement);
  expect(screen.queryByRole('region', { name: 'Practice room' })).toBeNull();
  expect(screen.queryByRole('slider', { name: 'Playback position' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Practice room' }).getAttribute('aria-current')).toBe('page');
  fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
  click(/Right hand One part/); click(/Wait for notes The music/); click(/50% Gentle/);
  expect(Audio.instances).toHaveLength(0);
  expect(localStorage.getItem('piano-practice-history')).toBeNull();
});
it('starts the chosen hand and mode only on Start, with ordinary count-in and focused room', () => {
  render(<App />); click(/Right hand One part/); click(/Wait for notes The music/); click(/25%/);
  click(/Start practice/);
  expect(screen.getByRole('heading', { name: 'Morning Light' })).toBe(document.activeElement);
  expect(screen.getByText('Right hand · 25% · Wait for notes')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(screen.getAllByText(/Get ready/).length).toBeGreaterThan(0);
  expect(Audio.instances).toHaveLength(1);
});
it('change plan stops playback, retains choices, and never automatically resumes', () => {
  render(<App />); click(/Left hand One part/); click(/75%/); click(/Start practice/); click('Change plan');
  expect(screen.getByRole('heading', { name: 'Let’s play a little.' })).toBe(document.activeElement);
  expect(screen.getByRole('button', { name: /Left hand One part/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('slider', { name: 'Practice speed' }).getAttribute('value')).toBe('75');
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  click(/Start practice/); expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  click('Restart'); expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
});
it('cancels a delayed audio start on change plan and ignores its later completion', async () => {
  Audio.pending = true; render(<App />); click(/Start practice/);
  expect(screen.getByRole('button', { name: 'Cancel audio start' })).toBeTruthy();
  click('Change plan'); await act(async () => { finishResume?.(); await Promise.resolve(); });
  expect(screen.getByRole('heading', { name: 'Let’s play a little.' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(screen.queryByText(/Starting audio/)).toBeNull();
});
it('library selection returns a paused plan and keeps song storage unchanged', () => {
  const saved = { ...demoSong, id: 'travel-study', title: 'Travel study' };
  const bytes = JSON.stringify([saved]); localStorage.setItem('piano-songs', bytes);
  render(<App />); click('Choose another piece'); click(/YOUR COLLECTION Travel study/);
  expect(screen.getByRole('heading', { name: 'Travel study' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(localStorage.getItem('piano-songs')).toBe(bytes);
  expect(Audio.instances).toHaveLength(0);
});
it('supports a muted travel session without MIDI permission or an audio context', () => {
  const request = vi.fn(); Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: request });
  render(<App />); click('Mute'); click(/Wait for notes The music/); fireEvent.click(screen.getByRole('checkbox', { name: 'Count in 4 beats' })); click(/Start practice/);
  expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play C4' })).toBeTruthy();
  expect(Audio.instances).toHaveLength(0); expect(request).not.toHaveBeenCalled();
});
it('preserves an unsaved Studio draft through preparation and starting', async () => {
  render(<App />); click('Prepare a shorter passage');
  const finger = await screen.findByRole('combobox', { name: 'Finger' });
  fireEvent.change(finger, { target: { value: '5' } }); click('Practice room');
  expect(screen.getByText(/Practising your unsaved draft/)).toBeTruthy();
  click('Mute'); click(/Start practice/); click('Change plan'); click('Prepare a shorter passage');
  expect((screen.getByRole('combobox', { name: 'Finger' }) as HTMLSelectElement).value).toBe('5');
  expect(localStorage.getItem('piano-songs')).toBeNull();
});
it('disables empty hand choices and refuses empty selected-hand starts without inventing notes', () => {
  const start = vi.fn(); const song = { ...demoSong, notes: demoSong.notes.filter(note => note.hand === 'right') };
  render(<PracticeLaunch song={song} dirty={false} hand="left" mode="melody" speed={50} countIn={false} muted={false} repeat={true} metronome={true}
    onHand={vi.fn()} onMode={vi.fn()} onSpeed={vi.fn()} onCountIn={vi.fn()} onMute={vi.fn()} onStart={start} onLibrary={vi.fn()} onPrepare={vi.fn()} />);
  expect((screen.getByRole('button', { name: /Left hand No notes/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /Start practice/ }) as HTMLButtonElement).disabled).toBe(true);
  click(/Start practice/); expect(start).not.toHaveBeenCalled();
  expect(screen.getByText(/Repeat is on. Metronome is on./)).toBeTruthy();
  expect(screen.getByText(/Starts from the beginning/)).toBeTruthy();
});

it('review: a hand valid for the previous piece cannot launch an empty part of the next piece', () => {
  const saved = { ...demoSong, id: 'only-right', title: 'Only right', notes: demoSong.notes.filter(n => n.hand === 'right') };
  localStorage.setItem('piano-songs', JSON.stringify([saved]));
  render(<App />); click(/Left hand One part/); click('Choose another piece'); click(/YOUR COLLECTION Only right/);
  expect((screen.getByRole('button', { name: /Start practice/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/No notes for this hand/)).toBeTruthy();
  click(/Right hand One part/); click('Mute'); click(/Wait for notes The music/); fireEvent.click(screen.getByRole('checkbox', { name: 'Count in 4 beats' })); click(/Start practice/);
  expect(screen.getByText('Right hand · 50% · Wait for notes')).toBeTruthy();
  expect(screen.getByText('Your turn · E4')).toBeTruthy();
  click('Play F4'); expect(screen.getByText('Your turn · E4')).toBeTruthy();
  click('Play E4'); expect(screen.queryByText('Your turn · E4')).toBeNull();
});
it('review: denied piece replacement preserves edited draft and revisitable launcher', async () => {
  render(<App />); click('Prepare a shorter passage');
  const finger = await screen.findByRole('combobox', { name: 'Finger' }); fireEvent.change(finger, { target: { value: '5' } });
  click('Practice room'); click('Choose another piece'); vi.spyOn(window, 'confirm').mockReturnValue(false); click(/Morning Light/);
  expect(screen.getByRole('heading', { name: 'On your music stand' })).toBeTruthy(); click('Practice room');
  expect(screen.getByText(/Practising your unsaved draft/)).toBeTruthy(); click('Prepare a shorter passage');
  expect((screen.getByRole('combobox', { name: 'Finger' }) as HTMLSelectElement).value).toBe('5');
});
it('review: audio failure opens recoverable paused room, then muted retry needs no permission', () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw Error('unavailable'); } });
  render(<App />); click(/Start practice/);
  expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy(); expect(screen.getByText(/Audio could not start/)).toBeTruthy();
  click('Change plan'); click('Mute'); click(/Start practice/); expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
});
