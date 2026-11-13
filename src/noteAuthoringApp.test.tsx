// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { clickDownload } from "./testDownload";
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import { exportMidi, type Song } from './music';
import { parseProject } from './project';
import { SONGS_KEY } from './songLibrary';
import { stubDialogs } from './testDialog';

// Real parsers, editing, persistence and export; synthetic DOM/file reads and
// download dispatch only. No private assets or physical/browser-device claims.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
const source: Song = { id: 'synthetic', title: 'Synthetic authoring', tempo: 120, duration: 5, notes: [
  { id: 'a', pitch: 60, start: 0, duration: 1, hand: 'right', finger: 2, velocity: .7 },
  { id: 'b', pitch: 48, start: 2, duration: .5, hand: 'left', finger: 4, velocity: .6 },
] };
const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
let downloads: Blob[];
beforeEach(() => {
  stubDialogs(); localStorage.clear(); downloads = [];
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:synthetic'; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
function saved(): Song[] { return JSON.parse(localStorage.getItem(SONGS_KEY) ?? '[]'); }
function file(content: string | Uint8Array, name: string) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return Object.assign(new File([new Uint8Array(bytes)], name), { text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer });
}
function choose(container: HTMLElement, input: File) { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [input] } }); }
async function open(container: HTMLElement, song = source) {
  choose(container, file(JSON.stringify({ version: 1, song }), 'synthetic.piano.json'));
  await screen.findByRole('heading', { name: song.title });
  await screen.findByRole('heading', { name: song.scoreOrigin === 'musicxml' ? 'Add, delete & resize written notes' : 'Add, delete & retime notes' });
}
const button = (name: string) => screen.getByRole('button', { name });
const change = (name: string, value: string) => fireEvent.change(screen.getByRole('spinbutton', { name: new RegExp(`^${name}`) }), { target: { value } });
const value = (name: string) => (screen.getByRole('spinbutton', { name: new RegExp(`^${name}`) }) as HTMLInputElement).value;
function prepare() { openPracticeRoom(); fireEvent.click(button('Practice setup')); fireEvent.click(button('Prepare a song')); }
async function exportProject() {
  clickDownload(button('Export project + fingers'));
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(downloads.at(-1)!); });
}

it('imports actual MIDI, retimes and inserts, preserves hands/fingers, saves, reloads and round trips project export', async () => {
  let view = renderPractice(<App />);
  choose(view.container, file(exportMidi(source), 'Synthetic MIDI.mid'));
  await screen.findByRole('heading', { name: 'Synthetic MIDI' });
  await screen.findByRole('heading', { name: 'Add, delete & retime notes' });
  const original = saved()[0];
  fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '3' } });
  change('Start', '3'); change('Duration', '1.5');
  fireEvent.click(button('Apply note changes'));
  expect(value('Note number')).toBe('2');
  expect((screen.getByRole('combobox', { name: 'Note' }) as HTMLSelectElement).value).toBe('1');
  fireEvent.click(button('Add a note'));
  change('New note pitch', '65'); change('Start', '.5'); change('Duration', '.75');
  fireEvent.change(screen.getByRole('combobox', { name: 'New note hand' }), { target: { value: 'left' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'New note finger' }), { target: { value: '5' } });
  fireEvent.click(button('Add note'));
  expect(saved()[0]).toEqual(original);
  fireEvent.click(button('Save'));
  await screen.findByText('Saved to your library on this device.');
  const authored = saved()[0];
  expect(authored.tempo).toBe(original.tempo);
  expect(authored.notes).toHaveLength(3);
  expect(authored.notes[0]).toMatchObject({ pitch: 65, start: .5, duration: .75, hand: 'left', finger: 5 });
  expect(authored.notes[2]).toMatchObject({ pitch: 60, start: 3, duration: 1.5, finger: 3, hand: 'right' });
  expect(authored.notes[1]).toEqual(original.notes[1]);
  view.unmount(); view = renderPractice(<App />);
  fireEvent.click(button('My library'));
  fireEvent.click(screen.getByRole('button', { name: /Synthetic MIDI/ })); prepare();
  const serialized = await exportProject();
  expect(parseProject(serialized)).toEqual(authored);
  choose(view.container, file(serialized, 'restored.json'));
  await waitFor(() => expect(saved()).toHaveLength(2));
  expect(saved()[0].notes).toEqual(authored.notes);
});

it('shares note selection, confirms deletion, survives navigation, and can author an empty piece', async () => {
  const view = renderPractice(<App />); await open(view.container);
  fireEvent.change(screen.getByRole('combobox', { name: 'Note' }), { target: { value: '1' } });
  expect(value('Start')).toBe('2');
  fireEvent.click(button('Delete note')); fireEvent.click(button('Keep note'));
  expect(parseProject(await exportProject()).notes).toHaveLength(2);
  fireEvent.click(button('Delete note')); fireEvent.click(button('Delete this note'));
  fireEvent.click(button('Start practising')); prepare();
  expect(parseProject(await exportProject()).notes).toEqual([source.notes[0]]);
  fireEvent.click(button('Delete note')); fireEvent.click(button('Delete this note'));
  expect(parseProject(await exportProject()).notes).toHaveLength(0);
  change('New note pitch', '67'); fireEvent.click(button('Add note'));
  expect(parseProject(await exportProject()).notes[0].pitch).toBe(67);
  expect(saved()[0].notes).toEqual(source.notes);
});

it('rejects invalid timing without touching playback and resets paused playback on valid changes', async () => {
  const view = renderPractice(<App />); await open(view.container);
  fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '2' } });
  change('Duration', '0'); fireEvent.click(button('Apply note changes'));
  expect(screen.getByRole('alert').textContent).toMatch(/greater than zero/);
  expect((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value).toBe('2');
  change('Duration', '6'); fireEvent.click(button('Apply note changes'));
  expect((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value).toBe('0');
  expect(value('Trim end')).toBe('6');
  expect(button('Play')).toBeTruthy();
  expect(parseProject(await exportProject()).notes[0].duration).toBe(6);
  expect(saved()[0]).toMatchObject({ notes: source.notes, duration: 5 });
});

it('offers written-slot MusicXML authoring and preserves reference XML explicitly', async () => {
  const view = renderPractice(<App />); await open(view.container, { ...source, scoreOrigin: 'musicxml', scoreXml: xml });
  expect(screen.getByRole('heading', { name: 'Add, delete & resize written notes' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add a note' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Finger' })).toBeTruthy();
  await open(view.container, { ...source, title: 'Reference study', scoreXml: xml });
  expect(screen.getByText(/attached score is a reference only/)).toBeTruthy();
  change('Start', '1'); fireEvent.click(button('Apply note changes'));
  const edited = parseProject(await exportProject());
  expect(edited.scoreXml).toBe(xml); expect(edited.scoreOrigin).toBeUndefined();
  expect(edited.notes[0].start).toBe(1);
});

it('invalidates a pending import when structural edits apply and keeps the newer draft', async () => {
  const view = renderPractice(<App />); await open(view.container);
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(r => { resolve = r; });
  const delayed = file('', 'late.json'); delayed.text = vi.fn(() => pending);
  const original = saved()[0];
  choose(view.container, delayed);
  expect(delayed.text).toHaveBeenCalledTimes(1);
  change('Duration', '3'); fireEvent.click(button('Apply note changes'));
  expect(value('Duration')).toBe('3');
  expect(value('Note number')).toBe('1');
  await act(async () => resolve(JSON.stringify({ version: 1, song: { ...source, title: 'Late replacement' } })));
  expect(screen.queryByRole('heading', { name: 'Late replacement' })).toBeNull();
  expect(value('Duration')).toBe('3');
  expect(value('Note number')).toBe('1');
  expect(saved()).toEqual([original]);
  const draft = parseProject(await exportProject());
  expect(draft.notes[0]).toEqual({ ...original.notes[0], duration: 3 });
  expect(draft.notes[1]).toEqual(original.notes[1]);
  expect(draft.id).toBe(original.id);
});

it('preserves a structural draft and external data when saving meets a stale-tab conflict', async () => {
  const view = renderPractice(<App />); await open(view.container);
  const external = { ...saved()[0], title: 'Changed elsewhere' };
  change('Start', '1'); fireEvent.click(button('Apply note changes'));
  localStorage.setItem(SONGS_KEY, JSON.stringify([external]));
  fireEvent.click(button('Save'));
  await screen.findByText(/This piece changed in another tab/);
  expect(saved()[0]).toEqual(external);
  expect(parseProject(await exportProject()).notes[0].start).toBe(1);
  fireEvent.click(button('My library')); fireEvent.click(screen.getByRole('button', { name: /Morning Light/ }));
  expect(window.confirm).toHaveBeenCalled();
  fireEvent.click(button('Prepare a song'));
  expect(value('Start')).toBe('1');
});

it('authors a trimmed passage without changing the saved full piece or its fingerings', async () => {
  const view = renderPractice(<App />); await open(view.container);
  const original = saved()[0];
  change('Trim start', '1'); change('Trim end', '4');
  fireEvent.click(button('Trim passage'));
  change('Duration', '2'); fireEvent.click(button('Apply note changes'));
  fireEvent.click(button('Save')); await screen.findByText('Saved to your library on this device.');
  expect(saved()).toHaveLength(2);
  expect(saved().find(song => song.id === original.id)).toEqual(original);
  const passage = saved().find(song => song.id !== original.id)!;
  expect(passage).toMatchObject({ tempo: source.tempo, duration: 3 });
  expect(passage.notes).toHaveLength(1);
  expect(passage.notes[0]).toMatchObject({ start: 1, duration: 2, finger: 4, hand: 'left' });
});

it('keeps edited notes exportable after quota failure and does not replace stored data', async () => {
  const view = renderPractice(<App />); await open(view.container);
  const original = localStorage.getItem(SONGS_KEY);
  change('Duration', '2'); fireEvent.click(button('Apply note changes'));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  fireEvent.click(button('Save'));
  await screen.findByText(/could not be saved|storage is full/i);
  expect(localStorage.getItem(SONGS_KEY)).toBe(original);
  expect(parseProject(await exportProject()).notes[0].duration).toBe(2);
});
