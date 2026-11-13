// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest provides this Node built-in; browser app has no Node typings.
import { webcrypto } from 'node:crypto';
import { App } from './main';
import { parseMusicXml } from './musicxml';
import { SONGS_KEY } from './songLibrary';
import { HISTORY_KEY, parsePracticeHistory, practicePieceRevision } from './practiceHistory';
import { BOOKMARKS_KEY, exportBookmarks, songRevision } from './practiceBookmarks';
import { stubDialogs } from './testDialog';
import { clickDownload } from './testDownload';

// Synthetic app integration, not real browser/audio/device acceptance. Preserve
// real Song/parser/export/session/history code; mock rendering and frame timing.
const scoreProps = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: (props: any) => { scoreProps.current = props; return null; } }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
const xml = `<score-partwise version="4.0"><work><work-title>Original range exercise</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><sound tempo="60"/><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><fingering>2</fingering></technical></notations></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><fingering>3</fingering></technical></notations></note><backup><duration>2</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note></measure><measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>2</duration></backup><note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note></measure></part></score-partwise>`;
const original = { ...parseMusicXml(xml).song, id: 'original-range-exercise' };
const bytes = JSON.stringify([original]);
Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
let frame: FrameRequestCallback | undefined, now = 1000;
let blobs: Blob[];
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
function range(start: string, end: string) {
  click('Custom time range');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Start (seconds)' }), { target: { value: start } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'End (seconds)' }), { target: { value: end } });
}
function chooseOriginal() { click('Choose another piece'); click(/YOUR COLLECTION Original range exercise/); }
function muteAndStart() {
  click('Mute'); fireEvent.click(screen.getByRole('checkbox', { name: 'Count in 4 beats' })); click('Start practice');
}
async function advance(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) await act(async () => { now += 100; const callback = frame; frame = undefined; callback?.(now); });
}
function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)).join(',')); reader.readAsArrayBuffer(blob); });
}
async function exports() {
  const result: string[] = [];
  for (const name of ['Export project + fingers', 'Export MusicXML', 'Export MIDI']) {
    clickDownload(screen.getByRole('button', { name })); result.push(await readBlob(blobs.at(-1)!));
  }
  return result;
}
beforeEach(() => {
  stubDialogs(); localStorage.clear(); localStorage.setItem(SONGS_KEY, bytes);
  now = 1000; frame = undefined; blobs = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:range-test'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('practises a temporary window from an unsaved fingering draft without changing identity, source, storage or export bytes', async () => {
  render(<App />); chooseOriginal(); click('Prepare a shorter passage');
  await screen.findByRole('combobox', { name: 'Finger' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '5' } });
  const sourceBefore = scoreProps.current.sourceSong;
  const exportBefore = await exports();
  click('Practice room'); range('1', '2.2'); click(/Right hand One part/); click(/Wait for notes The music/); muteAndStart();
  const slider = screen.getByRole('slider', { name: 'Playback position' });
  expect(slider.getAttribute('min')).toBe('1'); expect(slider.getAttribute('max')).toBe('2.2'); expect(slider.getAttribute('value')).toBe('1');
  expect(screen.getByRole('status').textContent).toMatch(/D4/);
  click('Play C4'); expect(slider.getAttribute('value')).toBe('1');
  click('Play D4'); await advance(0.2); expect(Number(slider.getAttribute('value'))).toBeGreaterThan(1);
  click('Reading score'); expect(scoreProps.current.sourceSong).toBe(sourceBefore); expect(scoreProps.current.xml).toBe(sourceBefore.scoreXml);
  expect(scoreProps.current.playbackTime).toBeGreaterThan(1);
  click('Change plan'); click('Prepare a shorter passage');
  expect((screen.getByRole('combobox', { name: 'Finger' }) as HTMLSelectElement).value).toBe('5');
  expect(screen.getByRole('slider', { name: 'Playback position' }).getAttribute('min')).toBe('0');
  expect(screen.getByRole('slider', { name: 'Playback position' }).getAttribute('max')).toBe('4');
  expect(await exports()).toEqual(exportBefore);
  expect(localStorage.getItem(SONGS_KEY)).toBe(bytes); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  click('Practice room'); expect((screen.getByRole('spinbutton', { name: 'Start (seconds)' }) as HTMLInputElement).value).toBe('1');
  click('Prepare a shorter passage'); fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '4' } }); click('Practice room');
  expect(screen.getByRole('button', { name: 'Whole piece' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/Practising your unsaved draft/)).toBeTruthy();
});

it.each(['Listen & explore', 'Find the rhythm', 'Play a recital'])('records only completed source interval in %s with original identity', async label => {
  render(<App />); chooseOriginal(); range('0.5', '1.25'); click(new RegExp(`^${label}`)); muteAndStart();
  await advance(2.5);
  await waitFor(() => expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull());
  const passes = parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!);
  expect(passes).toHaveLength(1); expect(passes[0]).toMatchObject({ pieceId: original.id, pieceRevision: practicePieceRevision(original), startSeconds: 0.5, endSeconds: 1.25, noteCount: 1 });
  if (label !== 'Listen & explore') expect(passes[0].rhythm).toMatchObject({ total: 1, missed: 1 });
  expect(localStorage.getItem(SONGS_KEY)).toBe(bytes);
  click('Results'); expect(screen.getByRole('button', { name: /^Repeat selected passage/ })).toBeTruthy();
  click(/^Repeat selected passage/); expect(screen.getByRole('slider', { name: 'Playback position' }).getAttribute('value')).toBe('0.5');
  expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
});

it('does not save a range as a whole-piece bookmark, and restores a legacy bookmark as a stopped whole-piece plan', async () => {
  localStorage.setItem(BOOKMARKS_KEY, exportBookmarks([{ id: 'whole', name: 'Whole original', songId: original.id, title: original.title, revision: await songRevision(original), hand: 'right', mode: 'melody', speed: 50, countIn: false, repeat: false }]));
  const before = localStorage.getItem(BOOKMARKS_KEY);
  render(<App />); chooseOriginal(); range('1', '2.2'); muteAndStart(); click('Practice setup');
  fireEvent.change(screen.getByRole('textbox', { name: 'Bookmark name' }), { target: { value: 'Unsafe range bookmark' } });
  expect((screen.getByRole('button', { name: 'Save practice bookmark' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Temporary practice ranges are not stored in bookmarks/)).toBeTruthy();
  click('Done'); click('My library'); click('Open Whole original');
  await screen.findByRole('heading', { name: 'Let’s play a little.' });
  expect(screen.getByRole('button', { name: 'Whole piece' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(localStorage.getItem(BOOKMARKS_KEY)).toBe(before); expect(localStorage.getItem(SONGS_KEY)).toBe(bytes);
});

it('keeps range and unsaved fingering when replacement is canceled, but clears the range on confirmed replacement', async () => {
  render(<App />); chooseOriginal(); click('Prepare a shorter passage'); await screen.findByRole('combobox', { name: 'Finger' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '5' } }); click('Practice room'); range('1', '2.2');
  click('Choose another piece'); click(/A STUDIO ORIGINAL Morning Light/);
  expect(window.confirm).toHaveBeenCalled(); click('Practice room');
  expect((screen.getByRole('spinbutton', { name: 'Start (seconds)' }) as HTMLInputElement).value).toBe('1');
  expect(screen.getByText(/Practising your unsaved draft/)).toBeTruthy();
  vi.mocked(window.confirm).mockReturnValue(true); click('Choose another piece'); click(/A STUDIO ORIGINAL Morning Light/);
  expect(screen.getByRole('button', { name: 'Whole piece' }).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem(SONGS_KEY)).toBe(bytes);
});

it('records a completed wait-for-notes range only after its selected note is reached', async () => {
  render(<App />); chooseOriginal(); range('1', '1.2'); click(/Right hand One part/); click(/Wait for notes The music/); muteAndStart();
  await advance(1); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  click('Play D4'); await advance(0.6);
  await waitFor(() => expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull());
  expect(parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!)[0]).toMatchObject({ pieceId: original.id, startSeconds: 1, endSeconds: 1.2, mode: 'melody', noteCount: 1 });
});

it('cancels pending audio before selecting a different range and ignores the stale unlock', async () => {
  let finish!: () => void;
  class PendingAudio extends EventTarget {
    state = 'suspended'; currentTime = 0; destination = {};
    resume() { return new Promise<void>(resolve => { finish = () => { this.state = 'running'; resolve(); }; }); }
    close() { return Promise.resolve(); }
    createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  }
  vi.stubGlobal('AudioContext', PendingAudio);
  render(<App />); chooseOriginal(); range('1', '2'); click(/Right hand One part/); click(/Wait for notes The music/);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Count in 4 beats' })); click('Start practice');
  expect(screen.getByRole('button', { name: 'Cancel audio start' })).toBeTruthy();
  click('Change plan'); range('2', '3');
  await act(async () => { finish(); await Promise.resolve(); });
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(screen.queryByText(/Starting audio/)).toBeNull(); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  click('Start practice');
  expect(screen.getByRole('slider', { name: 'Playback position' }).getAttribute('value')).toBe('2');
  expect(screen.getByRole('status').textContent).toMatch(/E4/);
});
