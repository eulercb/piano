// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import type { Song } from './music';
import { parseMusicXml } from './musicxml';
import { parseProject } from './project';
import { SONGS_KEY } from './songLibrary';
import { stubDialogs } from './testDialog';

// Original synthetic notation. Real import, edit, storage and export code;
// engraving, native dialogs, file reads and download dispatch are simulated.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
const xml = `<score-partwise version="4.0"><work><work-title>Synthetic slots</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><technical><fingering>2</fingering></technical></notations></note><note><rest/><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><rest/><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>16</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff><notations><technical><fingering>5</fingering></technical></notations></note></measure></part></score-partwise>`;
let downloads: Blob[];
beforeEach(() => {
  stubDialogs(); localStorage.clear(); downloads = [];
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:synthetic'; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const button = (name: string) => screen.getByRole('button', { name });
const saved = (): Song[] => JSON.parse(localStorage.getItem(SONGS_KEY) ?? '[]');
const music = (song: Song) => song.notes.map(({ id: _id, sourceNoteIds: _sources, ...note }) => note);
function file(text: string, name: string) { return Object.assign(new File([text], name), { text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer }); }
function choose(container: HTMLElement, input: File) { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [input] } }); }
function slot(id: string) { fireEvent.change(screen.getByRole('combobox', { name: 'Written slot' }), { target: { value: id } }); }
function beats(value: string) { fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration (quarter-note beats)' }), { target: { value } }); }
async function open(container: HTMLElement) { choose(container, file(xml, 'synthetic.musicxml')); await screen.findByRole('heading', { name: 'Synthetic slots' }); }
function downloadText() {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(downloads.at(-1)!); });
}
async function exportProject() { fireEvent.click(button('Export project + fingers')); return downloadText(); }

it('shows optional preparation guidance near import without changing songs or appearing in the practice room', () => {
  const view = render(<App />);
  expect(view.container.querySelector('.score-preparation-guide')).toBeNull();
  fireEvent.click(button('My library'));
  const guide = view.container.querySelector<HTMLDetailsElement>('.score-preparation-guide')!;
  expect(guide).not.toBeNull(); expect(guide.open).toBe(false);
  expect(button('Import song')).toBeTruthy();
  const snapshot = localStorage.getItem(SONGS_KEY);
  guide.open = true; fireEvent(guide, new Event('toggle'));
  expect(localStorage.getItem(SONGS_KEY)).toBe(snapshot);
  fireEvent.click(button('Practice room')); expect(view.container.querySelector('.score-preparation-guide')).toBeNull();
});

it('inserts a written note, preserves saved music until Save, and round trips linked score and both hands', async () => {
  const view = render(<App />); await open(view.container);
  const original = saved()[0];
  slot('0:0:1');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'New pitch (MIDI)' }), { target: { value: '65' } });
  beats('.5'); fireEvent.click(button('Insert into rest'));
  expect(saved()).toEqual([original]);
  const serialized = await exportProject();
  const draft = parseProject(serialized);
  expect(JSON.parse(serialized).song.notes).toEqual(draft.notes);
  expect(draft.notes).toHaveLength(4);
  expect(draft.notes.find(note => note.pitch === 65)).toMatchObject({ start: .5, duration: .25, hand: 'right' });
  expect(music(draft).filter(note => note.pitch !== 65)).toEqual(music(original));
  expect(music(parseMusicXml(draft.scoreXml!).song)).toEqual(music(draft));
  expect(draft.duration).toBe(original.duration);
  fireEvent.click(button('Export MusicXML'));
  const exportedXml = await downloadText();
  expect(exportedXml).toBe(draft.scoreXml);
  expect(music(parseMusicXml(exportedXml).song)).toEqual(music(draft));
  fireEvent.click(button('Save')); await screen.findByText('Saved to your library on this device.');
  expect(saved()[0]).toEqual(draft);
  choose(view.container, file(await exportProject(), 'restored.json'));
  await waitFor(() => expect(saved()).toHaveLength(2));
  expect(music(saved()[0])).toEqual(music(draft));
  expect(saved()[0].scoreXml).toBe(draft.scoreXml);
  expect(saved()[1]).toEqual(draft);
});

it('extends into adjacent rest, retains fingering, and confirms deletion without moving the other hand', async () => {
  const view = render(<App />); await open(view.container);
  const original = saved()[0];
  slot('0:0:0'); beats('2'); fireEvent.click(button('Apply written duration'));
  let draft = parseProject(await exportProject());
  expect(draft.notes.find(note => note.pitch === 60)).toMatchObject({ start: 0, duration: 1, finger: 2 });
  expect(music(draft).filter(note => note.pitch !== 60)).toEqual(music(original).filter(note => note.pitch !== 60));
  fireEvent.click(button('Replace note with rest')); fireEvent.click(button('Keep written note'));
  expect(parseProject(await exportProject())).toEqual(draft);
  fireEvent.click(button('Replace note with rest')); fireEvent.click(button('Confirm replace with rest'));
  draft = parseProject(await exportProject());
  expect(draft.notes.some(note => note.pitch === 60)).toBe(false);
  expect(music(draft)).toEqual(music(original).filter(note => note.pitch !== 60));
  expect(draft.duration).toBe(original.duration);
  expect(saved()).toEqual([original]);
});

it('cancels a pending replacement import when a newer written-duration edit applies', async () => {
  const view = render(<App />); await open(view.container);
  const original = saved()[0];
  let resolve!: (text: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  const late = file('', 'late.json'); late.text = vi.fn(() => pending);
  choose(view.container, late); expect(late.text).toHaveBeenCalledTimes(1);
  slot('0:0:0'); beats('.5'); fireEvent.click(button('Apply written duration'));
  await act(async () => resolve(JSON.stringify({ version: 1, song: { ...original, title: 'Late replacement' } })));
  expect(screen.queryByRole('heading', { name: 'Late replacement' })).toBeNull();
  const draft = parseProject(await exportProject());
  expect(draft.notes.find(note => note.pitch === 60)).toMatchObject({ duration: .25, finger: 2 });
  expect(saved()).toEqual([original]);
  expect(music(parseMusicXml(draft.scoreXml!).song)).toEqual(music(draft));
});

it('retains the authored score after dirty replacement is declined and a stale-tab Save conflicts', async () => {
  const view = render(<App />); await open(view.container);
  const original = saved()[0];
  slot('0:0:0'); beats('.5'); fireEvent.click(button('Apply written duration'));
  choose(view.container, file(xml.replace('Synthetic slots', 'Replacement'), 'replacement.musicxml'));
  expect(window.confirm).toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Replacement' })).toBeNull();
  const external = { ...original, title: 'Changed in another tab' };
  localStorage.setItem(SONGS_KEY, JSON.stringify([external]));
  fireEvent.click(button('Save')); await screen.findByText(/This piece changed in another tab/);
  expect(saved()).toEqual([external]);
  const retained = parseProject(await exportProject());
  expect(retained.notes.find(note => note.pitch === 60)?.duration).toBe(.25);
  expect(music(parseMusicXml(retained.scoreXml!).song)).toEqual(music(retained));
});
