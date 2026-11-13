// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import trimFixture from '../fixtures/trim-pickup-tie-tuplet.musicxml?raw';
import { clickDownload } from "./testDownload";
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import type { Song } from './music';
import { parseMusicXml } from './musicxml';
import { parseProject } from './project';
import { serializeProject } from './projectFormat';
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
async function open(container: HTMLElement) { choose(container, file(xml, 'synthetic.musicxml')); await screen.findByRole('heading', { name: 'Synthetic slots' }); await screen.findByRole('combobox', { name: 'Written slot' }); }
function downloadText() {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(downloads.at(-1)!); });
}
async function exportProject() { clickDownload(button('Export project + fingers')); return downloadText(); }

it('shows optional preparation guidance near import without changing songs or appearing in the practice room', () => {
  const view = renderPractice(<App />);
  expect(view.container.querySelector('.score-preparation-guide')).toBeNull();
  fireEvent.click(button('My library'));
  const guide = view.container.querySelector<HTMLDetailsElement>('.score-preparation-guide')!;
  expect(guide).not.toBeNull(); expect(guide.open).toBe(false);
  expect(button('Import song')).toBeTruthy();
  const snapshot = localStorage.getItem(SONGS_KEY);
  guide.open = true; fireEvent(guide, new Event('toggle'));
  expect(localStorage.getItem(SONGS_KEY)).toBe(snapshot);
  fireEvent.click(button('Practice room')); openPracticeRoom(); expect(view.container.querySelector('.score-preparation-guide')).toBeNull();
});

it('inserts a written note, preserves saved music until Save, and round trips linked score and both hands', async () => {
  const view = renderPractice(<App />); await open(view.container);
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
  clickDownload(button('Export MusicXML'));
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
  const view = renderPractice(<App />); await open(view.container);
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
  const view = renderPractice(<App />); await open(view.container);
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
  const view = renderPractice(<App />); await open(view.container);
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

it('adds and removes chord tones in the App, round trips source and saves only the explicit draft', async () => {
  const view = renderPractice(<App />);
  const positioned = xml.replace('<note>', '<note default-x="20" default-y="-40">');
  choose(view.container, file(positioned, 'positioned.musicxml'));
  await screen.findByRole('heading', { name: 'Synthetic slots' });
  await screen.findByRole('combobox', { name: 'Written slot' });
  const original = saved()[0];
  fireEvent.change(screen.getByRole('spinbutton', { name: 'New chord pitch (MIDI)' }), { target: { value: '64' } });
  fireEvent.click(button('Add chord tone'));
  let draft = parseProject(await exportProject());
  expect(saved()).toEqual([original]);
  expect(draft.notes).toHaveLength(4);
  expect(draft.notes.find(n => n.sourceNoteIds?.includes('0:0:1'))).toMatchObject({ pitch: 64, start: 0, duration: .5, hand: 'right' });
  expect(draft.notes.find(n => n.sourceNoteIds?.includes('0:0:0'))?.finger).toBe(2);
  expect(draft.scoreXml).toContain('default-x="20" default-y="-40"');
  expect(music(draft).filter(n => !(n.pitch === 64 && n.start === 0))).toEqual(music(original));
  expect((button('Apply chord duration') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button('Remove chord tone')); fireEvent.click(button('Keep written note'));
  expect(parseProject(await exportProject())).toEqual(draft);
  // Delete the leader, promoting the newly added tone without a rest or shift.
  fireEvent.click(button('Remove chord tone')); fireEvent.click(button('Confirm remove chord tone'));
  draft = parseProject(await exportProject());
  expect(draft.notes.some(n => n.pitch === 60)).toBe(false);
  expect(draft.notes.find(n => n.sourceNoteIds?.includes('0:0:0'))).toMatchObject({ pitch: 64, start: 0, duration: .5 });
  expect(music(draft).filter(n => !(n.pitch === 64 && n.start === 0))).toEqual(music(original).filter(n => n.pitch !== 60));
  expect(draft.scoreXml).not.toContain('<chord');
  expect(draft.duration).toBe(original.duration);
  expect(saved()).toEqual([original]);
  expect(music(parseMusicXml(draft.scoreXml!).song)).toEqual(music(draft));
  clickDownload(button('Export MusicXML'));
  expect(await downloadText()).toBe(draft.scoreXml);
  fireEvent.click(button('Save')); await screen.findByText('Saved to your library on this device.');
  expect(saved()).toEqual([draft]);
  choose(view.container, file(await exportProject(), 'chord-restored.json'));
  await waitFor(() => expect(saved()).toHaveLength(2));
  expect(music(saved()[0])).toEqual(music(draft));
  expect(saved()[0].scoreXml).toBe(draft.scoreXml);
  expect(saved()[1]).toEqual(draft);
});

it('retains an unsaved resized chord when a stale-tab save fails and a replacement is canceled', async () => {
  const view = renderPractice(<App />); await open(view.container);
  const original = saved()[0];
  fireEvent.change(screen.getByRole('spinbutton', { name: 'New chord pitch (MIDI)' }), { target: { value: '67' } });
  fireEvent.click(button('Add chord tone'));
  beats('2'); fireEvent.click(button('Apply chord duration'));
  choose(view.container, file(xml.replace('Synthetic slots', 'Replacement'), 'replacement.musicxml'));
  expect(window.confirm).toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Replacement' })).toBeNull();
  const external = { ...original, title: 'Newer library revision' };
  localStorage.setItem(SONGS_KEY, JSON.stringify([external]));
  fireEvent.click(button('Save')); await screen.findByText(/This piece changed in another tab/);
  expect(saved()).toEqual([external]);
  const draft = parseProject(await exportProject());
  expect(draft.notes.find(n => n.pitch === 67)).toMatchObject({ start: 0, duration: 1 });
  expect(draft.notes.find(n => n.pitch === 60)).toMatchObject({ start: 0, duration: 1, finger: 2 });
  expect(music(parseMusicXml(draft.scoreXml!).song)).toEqual(music(draft));
});


it('resizes a whole chord from its follower, preserves the saved original and round trips both hands through export and Save', async () => {
  const view = renderPractice(<App />);
  const chordXml = xml.replace('</note>', '</note><note default-x="20" default-y="-20"><chord/><pitch><step>G</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><accidental>flat</accidental><staff>1</staff><notations><technical><fingering>4</fingering></technical></notations></note>');
  choose(view.container, file(chordXml, 'original-chord.musicxml'));
  await screen.findByRole('heading', { name: 'Synthetic slots' });
  await screen.findByRole('combobox', { name: 'Written slot' });
  const original = saved()[0];
  slot('0:0:1'); beats('2'); fireEvent.click(button('Apply chord duration'));
  let draft = parseProject(await exportProject());
  expect(saved()).toEqual([original]);
  expect(draft.notes.filter(n => n.start === 0 && n.hand === 'right').map(n => [n.pitch, n.duration, n.finger])).toEqual([[60, 1, 2], [66, 1, 4]]);
  expect(music(draft).filter(n => n.start > 0 || n.hand === 'left')).toEqual(music(original).filter(n => n.start > 0 || n.hand === 'left'));
  expect(draft.scoreXml).toContain('<step>G</step><alter>-1</alter>');
  expect(draft.scoreXml).toContain('default-x="20" default-y="-20"');
  expect(draft.duration).toBe(original.duration);
  expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('2');
  beats('.5'); fireEvent.click(button('Apply chord duration'));
  const raw = await exportProject();
  draft = parseProject(raw);
  expect(JSON.parse(raw).song.notes).toEqual(draft.notes);
  expect(draft.notes.filter(n => n.start === 0 && n.hand === 'right').map(n => [n.pitch, n.duration, n.finger])).toEqual([[60, .25, 2], [66, .25, 4]]);
  expect(music(draft).filter(n => n.start > 0 || n.hand === 'left')).toEqual(music(original).filter(n => n.start > 0 || n.hand === 'left'));
  expect(saved()).toEqual([original]);
  fireEvent.click(button('Remove chord tone')); fireEvent.click(button('Keep written note'));
  expect(parseProject(await exportProject())).toEqual(draft);
  clickDownload(button('Export MusicXML'));
  const outputXml = await downloadText();
  expect(outputXml).toBe(draft.scoreXml);
  expect(music(parseMusicXml(outputXml).song)).toEqual(music(draft));
  fireEvent.click(button('Save')); await screen.findByText('Saved to your library on this device.');
  expect(saved()).toEqual([draft]);
  choose(view.container, file(raw, 'resized-chord.json'));
  await waitFor(() => expect(saved()).toHaveLength(2));
  expect(music(saved()[0])).toEqual(music(draft));
  expect(saved()[0].scoreXml).toBe(draft.scoreXml);
  expect(saved()[1]).toEqual(draft);
  expect(original.scoreXml).toBe(chordXml);
});

it('invalidates a pending import when a whole-chord duration is applied', async () => {
  const view = renderPractice(<App />); await open(view.container);
  const original = saved()[0];
  fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'), { target: { value: '67' } });
  fireEvent.click(button('Add chord tone'));
  let resolve!: (text: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  const late = file('', 'late.json'); late.text = vi.fn(() => pending);
  vi.mocked(window.confirm).mockReturnValueOnce(true);
  choose(view.container, late); expect(late.text).toHaveBeenCalledTimes(1);
  slot('0:0:1'); beats('2'); fireEvent.click(button('Apply chord duration'));
  await act(async () => resolve(JSON.stringify({ version: 1, song: { ...original, title: 'Late chord replacement' } })));
  expect(screen.queryByRole('heading', { name: 'Late chord replacement' })).toBeNull();
  const draft = parseProject(await exportProject());
  expect(draft.notes.filter(n => n.start === 0 && n.hand === 'right').map(n => [n.pitch, n.duration])).toEqual([[60, 1], [67, 1]]);
  expect(saved()).toEqual([original]);
  expect(music(parseMusicXml(draft.scoreXml!).song)).toEqual(music(draft));
});


it('keeps a saved Studio finger through a clipped tie, separate passage save and both export round trips', async () => {
  const view = renderPractice(<App />);
  choose(view.container, file(trimFixture, 'original-tie-study.musicxml'));
  await screen.findByRole('heading', { name: 'Release Pickup Tie Tuplet' });
  const original = saved()[0];
  const tiedIndex = original.notes.findIndex(note => note.sourceNoteIds?.includes('0:1:0'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Note' }), { target: { value: String(tiedIndex) } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '4' } });
  fireEvent.click(button('Save'));
  await screen.findByText('Saved to your library on this device.');
  const fullPiece = saved()[0];
  expect(fullPiece.notes[tiedIndex].finger).toBe(4);
  fireEvent.change(screen.getByRole('combobox', { name: 'First measure' }), { target: { value: '2' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Last measure' }), { target: { value: '2' } });
  fireEvent.click(button('Trim score passage'));
  await screen.findByText(/Passage created. Score and playback trimmed together/);
  const passage = parseProject(await exportProject());
  expect(passage.notes.find(note => note.sourceNoteIds?.includes('0:0:0'))?.finger).toBe(4);
  expect(passage.scoreXml).toContain('<fingering>4</fingering>');
  expect(passage.scoreXml).not.toContain('<tie ');
  expect(passage.id).not.toBe(fullPiece.id);
  expect(saved()).toEqual([fullPiece]);
  clickDownload(button('Export MusicXML'));
  const exportedXml = await downloadText();
  expect(exportedXml).toBe(passage.scoreXml);
  expect(music(parseMusicXml(exportedXml).song)).toEqual(music(passage));
  fireEvent.click(button('Save'));
  await screen.findByText('Saved to your library on this device.');
  expect(saved().find(song => song.id === fullPiece.id)).toEqual(fullPiece);
  expect(saved().find(song => song.id === passage.id)).toEqual(passage);
  choose(view.container, file(exportedXml, 'trimmed-tie.musicxml'));
  await waitFor(() => expect(saved()).toHaveLength(3));
  expect(music(saved()[0])).toEqual(music(passage));
  choose(view.container, file(serializeProject(passage), 'trimmed-tie.piano.json'));
  await waitFor(() => expect(saved()).toHaveLength(4));
  expect(music(saved()[0])).toEqual(music(passage));
  expect(saved().find(song => song.id === fullPiece.id)).toEqual(fullPiece);
});
