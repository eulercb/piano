// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateRaw } from 'pako';
import { App } from './main';
import { stubDialogs } from './testDialog';
import { loadScoreRenderer } from './scoreRenderer';
import { parseMusicXml } from './musicxml';
import { parseProject } from './project';
import { HISTORY_KEY, parsePracticeHistory } from './practiceHistory';
import type { ScoreTimeline } from './scoreCursor';
import type { Song } from './music';

// Synthetic app integration, not browser/device QA. The import, parser, editing,
// project storage, transport, score-following adapter and history are real.
// OSMD drawing, audio, animation time, PWA registration and download dispatch
// are simulated. No user score, browser upload, MIDI permission or network use.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }),
}));
vi.mock('./scoreRenderer', () => ({ loadScoreRenderer: vi.fn() }));

const title = 'Synthetic Studio workflow';
const note = (step: string, octave: number, duration: number, staff: number, finger: number) =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${staff}</voice><staff>${staff}</staff><notations><technical><fingering>${finger}</fingering></technical></notations></note>`;
const xml = `<score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
  <measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><sound tempo="60"/>
    ${note('C', 4, 1, 1, 2)}<backup><duration>1</duration></backup>${note('C', 3, 1, 2, 1)}</measure>
  <measure number="1">${note('D', 4, 1, 1, 3)}${note('E', 4, 1, 1, 4)}<backup><duration>2</duration></backup>${note('D', 3, 2, 2, 2)}</measure>
  <measure number="2">${note('F', 4, 1, 1, 3)}${note('G', 4, 1, 1, 4)}<backup><duration>2</duration></backup>${note('F', 3, 2, 2, 3)}</measure>
</part></score-partwise>`;
const encode = (source: string) => new TextEncoder().encode(source);

/** Independent, standards-shaped ZIP fixture. Both members really use DEFLATE. */
function compressedScore(source: string) {
  const entries = [
    ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="scores/study.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'],
    ['scores/study.musicxml', source],
  ];
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, contents] of entries) {
    const name = encode(path), data = encode(contents), compressed = deflateRaw(data);
    let checksum = 0xffffffff;
    for (const byte of data) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1;
    }
    checksum = (checksum ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length + compressed.length), localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); localView.setUint16(8, 8, true);
    localView.setUint32(14, checksum, true); localView.setUint32(18, compressed.length, true); localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true); local.set(name, 30); local.set(compressed, 30 + name.length);
    const central = new Uint8Array(46 + name.length), centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true); centralView.setUint16(10, 8, true); centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, compressed.length, true); centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true); centralView.setUint32(42, offset, true); central.set(name, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((size, part) => size + part.length, 0);
  const archive = new Uint8Array(offset + centralSize + 22), end = new DataView(archive.buffer);
  let position = 0;
  for (const part of [...locals, ...centrals]) { archive.set(part, position); position += part.length; }
  end.setUint32(position, 0x06054b50, true); end.setUint16(position + 8, entries.length, true); end.setUint16(position + 10, entries.length, true);
  end.setUint32(position + 12, centralSize, true); end.setUint32(position + 16, offset, true);
  return archive;
}

// jsdom File lacks the modern browser read methods. Supply only those methods;
// the production file input handler and real bounded importer still read bytes.
function localFile(content: string | Uint8Array, name: string): File {
  const bytes = typeof content === 'string' ? encode(content) : new Uint8Array(content);
  const file = new File([new Uint8Array(bytes)], name);
  Object.defineProperties(file, {
    arrayBuffer: { value: async () => bytes.buffer },
    text: { value: async () => new TextDecoder().decode(bytes) },
  });
  return file;
}

class DrawingCursor {
  index = 0;
  cursorElement = document.createElement('div');
  constructor(readonly positions: { measureIndex: number; beat: number }[]) {}
  get Iterator() {
    return { EndReached: this.index >= this.positions.length,
      CurrentMeasureIndex: this.positions[this.index]?.measureIndex ?? 0,
      CurrentRelativeInMeasureTimestamp: { RealValue: (this.positions[this.index]?.beat ?? 0) / 4 } };
  }
  reset() { this.index = 0; }
  next() { this.index++; }
  show() { this.cursorElement.hidden = false; }
  hide() { this.cursorElement.hidden = true; }
}
class DrawingRenderer {
  timeline?: ScoreTimeline;
  cursor = new DrawingCursor([]);
  constructor(readonly container: HTMLElement) {}
  async load(source: string) { this.timeline = parseMusicXml(source).scoreTimeline; }
  render() {
    const unique = new Map(this.timeline!.entries.map(entry => [`${entry.measureIndex}:${entry.beat}`, { measureIndex: entry.measureIndex, beat: entry.beat }]));
    this.cursor = new DrawingCursor([...unique.values()].sort((a, b) => a.measureIndex - b.measureIndex || a.beat - b.beat));
    this.container.replaceChildren(this.cursor.cursorElement);
  }
  dispose() {}
  clear() { this.container.replaceChildren(); }
}
class SilentAudio {
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
let now = 0, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const downloads: { blob: Blob; url: string }[] = [];
let clickedDownloads: { filename: string; href: string }[] = [];
function advance(seconds: number) {
  const ticks = Math.round(seconds * 10);
  // Run real transport callbacks in 100 ms steps while batching React drawing
  // until the assertion checkpoint, so full-suite CPU load does not dominate.
  act(() => {
    for (let index = 0; index < ticks; index++) {
      now += 100;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(now));
    }
  });
}
beforeEach(() => {
  stubDialogs();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  localStorage.clear(); frames.clear(); downloads.length = 0; clickedDownloads = [];
  now = 0; frameId = 0;
  vi.mocked(loadScoreRenderer).mockReset().mockResolvedValue({ OpenSheetMusicDisplay: DrawingRenderer } as unknown as Awaited<ReturnType<typeof loadScoreRenderer>>);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('AudioContext', SilentAudio);
  // Keep real Blob/FileReader serialization, replacing only browser dispatch.
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { const url = `blob:synthetic-download-${downloads.length}`; downloads.push({ blob, url }); return url; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clickedDownloads.push({ filename: this.download, href: this.href });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
function chooseFile(container: HTMLElement, file: File) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
}
async function importStudy(container: HTMLElement, format: 'musicxml' | 'mxl') {
  chooseFile(container, localFile(format === 'mxl' ? compressedScore(xml) : xml, `study.${format}`));
  await screen.findByRole('heading', { name: title });
  await screen.findByRole('checkbox', { name: 'Follow score while playing' });
}
function savedSongs(): Song[] { return JSON.parse(localStorage.getItem('piano-songs') || '[]'); }
function completedPasses() { return parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!); }
function position() { return Number((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value); }
function setupPractice(hand: 'Left' | 'Right', mode: 'Melody practice' | 'Rhythm practice' | 'Listen & explore') {
  fireEvent.click(screen.getByRole('button', { name: hand }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${mode}`) }));
  fireEvent.change(screen.getByRole('slider', { name: 'Tempo percentage' }), { target: { value: '100' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Count in 4 beats' }));
}
function press(noteName: string) { fireEvent(screen.getByRole('button', { name: `Play ${noteName}` }), new MouseEvent('pointerdown', {bubbles: true, button: 0})); }
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
  });
}

describe('existing import → Studio → practice workflow', () => {
  it.each(['musicxml', 'mxl'] as const)('round trips actual %s through finger edits, measure trimming, save/reload, export and project reimport', async format => {
    let view = render(<App />);
    await importStudy(view.container, format);
    const original = savedSongs()[0];
    expect(original.scoreXml).toBe(xml);
    expect(original.notes).toHaveLength(8);
    expect(original.notes.find(note => note.pitch === 62)?.finger).toBe(3);
    const selectNote = screen.getByRole('combobox', { name: 'Note' }) as HTMLSelectElement;
    const target = [...selectNote.options].find(option => option.textContent?.includes('D4'))!;
    fireEvent.change(selectNote, { target: { value: target.value } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '5' } });
    await screen.findByRole('checkbox', { name: 'Follow score while playing' });
    expect(savedSongs()[0].scoreXml).toBe(xml); // Editing alone does not rewrite the saved original.
    fireEvent.change(screen.getByRole('combobox', { name: 'First measure' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Last measure' }), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trim score passage' }));
    await screen.findByRole('heading', { name: `${title} · passage` });
    await screen.findByRole('checkbox', { name: 'Follow score while playing' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const stored = savedSongs(), passage = stored.find(song => song.id !== original.id)!;
    expect(stored).toHaveLength(2);
    expect(stored.find(song => song.id === original.id)).toEqual(original);
    expect(passage).toMatchObject({ duration: 2, scoreOrigin: 'musicxml' });
    expect(passage.notes).toHaveLength(3);
    expect(passage.notes.find(note => note.pitch === 62)).toMatchObject({ finger: 5, start: 0, hand: 'right' });
    expect(parseMusicXml(passage.scoreXml!).song.notes).toEqual(passage.notes);

    view.unmount(); view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'My library' }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${title} · passage`) }));
    fireEvent.click(screen.getByRole('button', { name: 'Practice setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare a song' }));
    await screen.findByRole('checkbox', { name: 'Follow score while playing' });
    expect(screen.getByText('Reading position: measure 1 of 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export project + fingers' }));
    expect(clickedDownloads.at(-1)?.filename).toBe(`${title} · passage.piano.json`);
    expect(clickedDownloads.at(-1)?.href).toBe(downloads.at(-1)?.url);
    const exported = await blobText(downloads.at(-1)!.blob), restored = parseProject(exported);
    expect(restored).toEqual(passage);
    chooseFile(view.container, localFile(exported, 'restored.PIANO.JSON'));
    await screen.findByRole('button', { name: 'Trim score passage' });
    await screen.findByRole('checkbox', { name: 'Follow score while playing' });
    const imported = savedSongs()[0];
    expect(imported.id).not.toBe(passage.id);
    expect(imported.notes).toEqual(passage.notes);
    expect(imported.scoreXml).toBe(passage.scoreXml);
    expect(savedSongs()).toHaveLength(3);

    setupPractice('Right', 'Listen & explore');
    fireEvent.click(screen.getByRole('button', { name: 'Play' })); advance(2.1);
    expect(completedPasses()).toHaveLength(1);
    expect(completedPasses()[0]).toMatchObject({ pieceId: imported.id, pieceTitle: passage.title, hand: 'right', mode: 'listen', noteCount: 2, endSeconds: 2 });
  });

  it('carries real score pitch/finger edits into focused practice and back to Studio', async () => {
    const view = render(<App />); await importStudy(view.container, 'mxl');
    const noteSelect = screen.getByRole('combobox', { name: 'Note' }) as HTMLSelectElement;
    const firstRight = [...noteSelect.options].find(option => option.textContent?.includes('C4'))!;
    fireEvent.change(noteSelect, { target: { value: firstRight.value } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Pitch (MIDI)' }), { target: { value: '65' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Finger' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start practising' }));
    expect(view.container.querySelector('.practice-shell')).toBeTruthy();
    expect([...view.container.querySelectorAll('.fall-note[title="F4"]')].some(note => note.textContent === '5')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Practice setup' }));
    setupPractice('Right', 'Melody practice');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reading score' }));
    await screen.findByRole('checkbox', { name: 'Follow score while playing' });
    expect(view.container.querySelector('.roll')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play' })); advance(.5);
    expect(position()).toBe(0); press('C4'); advance(.2); expect(position()).toBe(0);
    press('F4'); advance(.5); expect(position()).toBeCloseTo(.5);
    fireEvent.click(screen.getByRole('button', { name: 'Falling notes' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Practice setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare a song' }));
    expect((screen.getByRole('spinbutton', { name: 'Pitch (MIDI)' }) as HTMLInputElement).value).toBe('65');
    expect((screen.getByRole('combobox', { name: 'Finger' }) as HTMLSelectElement).value).toBe('5');
  });

  it('keeps count-in off the score clock and preserves the full score for one-hand listening', async () => {
    const view = render(<App />); await importStudy(view.container, 'mxl');
    fireEvent.click(screen.getByRole('button', { name: 'Right' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Tempo percentage' }), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' })); advance(3);
    expect(position()).toBe(0); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    advance(2.5); expect(position()).toBeCloseTo(1.5);
    expect(screen.getByRole('checkbox', { name: 'Follow score while playing' })).toBeTruthy();
    expect(screen.getByText('Reading position: measure 2 of 3')).toBeTruthy();
    advance(3.6); expect(position()).toBe(5);
    expect(completedPasses()[0]).toMatchObject({ hand: 'right', mode: 'listen', noteCount: 5, endSeconds: 5 });
  });

  it('waits for selected-hand melody input, ignores the other hand, and preserves progress across pause/resume', async () => {
    const view = render(<App />); await importStudy(view.container, 'mxl');
    setupPractice('Right', 'Melody practice');
    fireEvent.click(screen.getByRole('button', { name: 'Play' })); advance(1);
    expect(position()).toBe(0); press('C3'); advance(.2); expect(position()).toBe(0);
    press('C4'); advance(1); expect(position()).toBeCloseTo(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' })); advance(1);
    expect(position()).toBeCloseTo(1); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    for (const pitch of ['D4', 'E4', 'F4', 'G4']) { press(pitch); advance(1); }
    advance(.1); // Let the next animation frame cross the final duration boundary.
    expect(position()).toBe(5);
    expect(completedPasses()).toHaveLength(1);
    expect(completedPasses()[0]).toMatchObject({ mode: 'melody', hand: 'right', noteCount: 5 });
    expect(completedPasses()[0].rhythm).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Practice history' }));
    expect(screen.getByText(/5 selected notes reached in wait-for-note practice/)).toBeTruthy();
  });

  it('grades only selected-hand rhythm starts and saves the actual completed timing summary', async () => {
    const view = render(<App />); await importStudy(view.container, 'musicxml');
    setupPractice('Left', 'Rhythm practice');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    press('C3'); press('C4'); advance(1); press('D3'); advance(4.1);
    const [pass] = completedPasses();
    expect(pass).toMatchObject({ mode: 'rhythm', hand: 'left', noteCount: 3, endSeconds: 5,
      rhythm: { total: 3, onTime: 2, early: 0, late: 0, missed: 1, extra: 1 } });
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    advance(1); expect(completedPasses()).toHaveLength(1);
  });

  it('rejects corrupt compressed input without replacing the current library, playback or later history completion', async () => {
    const view = render(<App />); await importStudy(view.container, 'mxl');
    const saved = localStorage.getItem('piano-songs');
    setupPractice('Right', 'Listen & explore');
    fireEvent.click(screen.getByRole('button', { name: 'Play' })); advance(.5);
    chooseFile(view.container, localFile(new Uint8Array([1, 2, 3]), 'broken.mxl'));
    await screen.findByText(/not a complete ZIP archive/);
    expect(localStorage.getItem('piano-songs')).toBe(saved);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy(); expect(position()).toBeCloseTo(.5);
    advance(4.6); expect(completedPasses()).toHaveLength(1);
    expect(completedPasses()[0].pieceTitle).toBe(title);
  });
});
