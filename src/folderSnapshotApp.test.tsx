// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import { serializeProject } from './projectFormat';
import { SONGS_KEY } from './songLibrary';
import { HISTORY_KEY } from './practiceHistory';
import { BOOKMARKS_KEY } from './practiceBookmarks';
import * as folderModule from './songFolder';
import type { Song } from './music';
import { exportMidi } from './music';
import { stubDialogs } from './testDialog';

// Synthetic local FileLists only; not a native chooser or Android test.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
const NativeFile = File;
class ReadableFile extends NativeFile {
  arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject; reader.readAsArrayBuffer(this);
    });
  }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
}
const piece = (title: string): Song => ({ id: title, title, tempo: 90,
  notes: [{ id: 'n', start: 0, duration: 1, pitch: 60, hand: 'right', velocity: .5, finger: 2 }] });
const original = piece('Existing piece');
const originalBytes = JSON.stringify([original]);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const input = () => document.querySelector('input[webkitdirectory]') as HTMLInputElement;
const saved = (): Song[] => JSON.parse(localStorage.getItem(SONGS_KEY)!);
function snapshotFile(name: string, path = `Songs/${name}`) {
  const f = new File([serializeProject(piece(name))], name, { type: 'application/json' });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  vi.spyOn(f, 'arrayBuffer');
  return f;
}
function choose(...files: File[]) {
  click('Import folder once'); fireEvent.change(input(), { target: { files } });
}
let directoryDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  stubDialogs(); localStorage.clear(); localStorage.setItem(SONGS_KEY, originalBytes);
  directoryDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'webkitdirectory');
  Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', { configurable: true, get() { return this.hasAttribute('webkitdirectory'); } });
  vi.stubGlobal('File', ReadableFile);
  vi.stubGlobal('showDirectoryPicker', undefined);
  vi.spyOn(folderModule, 'storedFolder').mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  if (directoryDescriptor) Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', directoryDescriptor);
  else delete (HTMLInputElement.prototype as any).webkitdirectory;
});
function library() { render(<App />); click('Choose another piece'); }

it('imports top-level copies without reading skipped files, changing originals or remembering access', async () => {
  const remembered = { id: 'remembered', handle: { kind: 'directory', name: 'Remembered',
    values: vi.fn(), queryPermission: vi.fn(), requestPermission: vi.fn() } };
  vi.mocked(folderModule.storedFolder).mockResolvedValue(remembered);
  library(); await screen.findByRole('button', { name: 'Refresh / reconnect folder' });
  const a = snapshotFile('a.json'), nested = snapshotFile('nested.json', 'Songs/child/nested.json');
  const other = snapshotFile('notes.txt'), large = snapshotFile('large.json');
  Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
  choose(other, nested, large, a);
  await screen.findByText(/Folder snapshot: 1 imported/);
  expect(saved()).toHaveLength(2); expect(saved().find(s => s.id === original.id)).toEqual(original);
  expect(saved()[0]).toMatchObject({ title: 'a.json', notes: [expect.objectContaining({ finger: 2 })] });
  expect(saved()[0].id).not.toBe('a.json'); expect(saved()[0].folderSource).toBeUndefined();
  expect(a.arrayBuffer).toHaveBeenCalledOnce();
  for (const f of [nested, other, large]) expect(f.arrayBuffer).not.toHaveBeenCalled();
  expect(folderModule.storedFolder).toHaveBeenCalledTimes(1); expect(folderModule.storedFolder).toHaveBeenCalledWith();
  expect(remembered.handle.values).not.toHaveBeenCalled(); expect(remembered.handle.requestPermission).not.toHaveBeenCalled();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull(); expect(localStorage.getItem(BOOKMARKS_KEY)).toBeNull();
  click('My library'); expect(screen.getByText(/Folder: Remembered/)).toBeTruthy();
  choose(a); await screen.findByText(/Folder snapshot: 1 imported/);
  expect(saved()).toHaveLength(3); expect(new Set(saved().map(s => s.id)).size).toBe(3);
});

it.each(['', 'Other/b.json', 'Songs/../b.json'])('rejects ambiguous paths before any content read (%s)', async path => {
  library(); const a = snapshotFile('a.json'), b = snapshotFile('b.json', path);
  choose(a, b); await screen.findByText(/missing or ambiguous paths/);
  expect(a.arrayBuffer).not.toHaveBeenCalled(); expect(b.arrayBuffer).not.toHaveBeenCalled();
  expect(localStorage.getItem(SONGS_KEY)).toBe(originalBytes);
});

it('uses the real MIDI and MusicXML importers for pathless snapshot copies', async () => {
  library();
  const midi = new File([new Uint8Array(exportMidi(piece('Original MIDI')))], 'a.mid');
  const xml = new File(['<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><technical><fingering>3</fingering></technical></notations></note></measure></part></score-partwise>'], 'b.musicxml');
  for (const f of [midi, xml]) Object.defineProperty(f, 'webkitRelativePath', { value: `Songs/${f.name}` });
  choose(xml, midi); await screen.findByText(/Folder snapshot: 2 imported/);
  expect(saved()).toHaveLength(3);
  expect(saved().find(s => s.title === 'a')?.notes[0].pitch).toBe(60);
  const notation = saved().find(s => s.scoreOrigin === 'musicxml');
  expect(notation?.notes[0]).toMatchObject({ pitch: 60, finger: 3 });
  expect(notation?.scoreXml).toContain('<fingering>3</fingering>');
  expect(saved().every(s => !s.folderSource)).toBe(true);
});

it('hides the one-time option without directory selection support and retains file fallback', () => {
  delete (HTMLInputElement.prototype as any).webkitdirectory;
  library(); expect(screen.queryByRole('button', { name: 'Import folder once' })).toBeNull();
  click('Open song folder');
  expect(vi.mocked(HTMLInputElement.prototype.click).mock.instances[0]).toBe(document.querySelector('input[type="file"]'));
});

it('ignores an old picker selection after navigation before reading any file', () => {
  library(); click('Import folder once'); click('Practice room');
  const stale = snapshotFile('stale.json'); fireEvent.change(input(), { target: { files: [stale] } });
  expect(stale.arrayBuffer).not.toHaveBeenCalled();
  expect(localStorage.getItem(SONGS_KEY)).toBe(originalBytes);
  expect(document.body.textContent).not.toMatch(/Folder snapshot:/);
});

it('retains ordinary multi-file fallback and does not automatically use snapshot after a native denial', async () => {
  library(); click('Open song folder');
  expect(HTMLInputElement.prototype.click).toHaveBeenCalledOnce();
  expect(vi.mocked(HTMLInputElement.prototype.click).mock.instances[0]).toBe(document.querySelector('input[type="file"]'));
  vi.mocked(HTMLInputElement.prototype.click).mockClear();
  vi.stubGlobal('showDirectoryPicker', vi.fn().mockRejectedValue(new DOMException('/private/path', 'SecurityError')));
  click('Open song folder'); await screen.findByText(/The browser blocked folder access/);
  expect(HTMLInputElement.prototype.click).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('/private/path');
  expect(localStorage.getItem(SONGS_KEY)).toBe(originalBytes);
});

it('preserves a dirty fingering draft when selection is declined or canceled', async () => {
  render(<App />); click('Prepare a shorter passage');
  fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '5' } });
  click('My library'); click('Import folder once');
  expect(window.confirm).toHaveBeenCalled(); expect(HTMLInputElement.prototype.click).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true); click('Import folder once');
  fireEvent(input(), new Event('cancel', { bubbles: true }));
  const stale = snapshotFile('stale.json'); fireEvent.change(input(), { target: { files: [stale] } });
  expect(stale.arrayBuffer).not.toHaveBeenCalled(); expect(localStorage.getItem(SONGS_KEY)).toBe(originalBytes);
  click('Practice room'); expect(screen.getByText(/Practising your unsaved draft/)).toBeTruthy();
  click('Prepare a shorter passage');
  expect((screen.getByRole('combobox', { name: 'Finger' }) as HTMLSelectElement).value).toBe('5');
});

it.each(['navigation', 'new import'])('ignores a delayed read after %s', async next => {
  library(); const slow = snapshotFile('slow.json');
  let finish!: (bytes: ArrayBuffer) => void;
  vi.mocked(slow.arrayBuffer).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  choose(slow); expect(slow.arrayBuffer).toHaveBeenCalledOnce();
  if (next === 'navigation') click('Practice room');
  else {
    const replacement = snapshotFile('replacement.json');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [replacement] } });
    await waitFor(() => expect(saved()).toHaveLength(2));
  }
  await act(async () => { finish(new TextEncoder().encode(serializeProject(piece('slow.json'))).buffer); });
  expect(saved()).toHaveLength(next === 'navigation' ? 1 : 2);
  expect(saved().some(s => s.title === 'slow.json')).toBe(false);
  expect(document.body.textContent).not.toMatch(/Folder snapshot:/);
});

it('sanitizes read failures and preserves earlier imports when storage later rejects a save', async () => {
  library(); const bad = snapshotFile('a-bad.json'), good = snapshotFile('b-good.json');
  vi.mocked(bad.arrayBuffer).mockRejectedValue(new Error('/private/phone/secret/file.json'));
  choose(bad, good); await screen.findByText(/Folder snapshot: 1 imported/);
  expect(document.body.textContent).not.toContain('/private/phone');
  expect(screen.getByText(/A selected file could not be read/)).toBeTruthy();
  click('My library');
  const write = Storage.prototype.setItem; let writes = 0;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (key === SONGS_KEY && ++writes === 2) throw new DOMException('Full', 'QuotaExceededError');
    return write.call(this, key, value);
  });
  const a = snapshotFile('c-first.json'), b = snapshotFile('d-unsaved.json'), c = snapshotFile('e-unread.json');
  choose(a, b, c); await screen.findByText(/Import is open but not saved/);
  expect(saved().some(s => s.title === 'c-first.json')).toBe(true);
  expect(saved().some(s => s.title === 'd-unsaved.json')).toBe(false);
  expect(c.arrayBuffer).not.toHaveBeenCalled();
});
