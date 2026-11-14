// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import { parseMusicXml } from './musicxml';
import { SONGS_KEY } from './songLibrary';
import type { Song } from './music';

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
// The actual deferred score reader, MusicXML parser and library save run here.
// Only Blob.arrayBuffer is supplied because this jsdom File lacks that method.
const markedMessage = 'Score imported with playable notes, hands and printed fingerings.';
const unmarkedMessage = 'Score imported with playable notes and hands.';
const mark = (text = '3') => `<notations><technical><fingering>${text}</fingering></technical></notations>`;
const note = (content = '', before = '') => `<note>${before}<pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>${content}</note>`;
const sound = '<sound tempo="90"/>';
const metronome = '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type></direction>';
const score = (notes: string, tempo = sound) => `<score-partwise version="4.0"><work><work-title>Synthetic notice study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${tempo}${notes}</measure></part></score-partwise>`;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
async function importAndCheck(xml: string, notice: string) {
  const expected = parseMusicXml(xml);
  const bytes = new TextEncoder().encode(xml);
  const file = new File([bytes], 'synthetic.musicxml', { type: 'application/vnd.recordare.musicxml+xml' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  const { container } = render(<App />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByRole('heading', { name: 'Synthetic notice study' });
  expect(screen.getByText(notice).getAttribute('role')).toBe('status');
  if (notice !== markedMessage) expect(screen.queryByText(markedMessage)).toBeNull();
  const saved = JSON.parse(localStorage.getItem(SONGS_KEY) ?? '[]') as Song[];
  expect(saved).toHaveLength(1);
  expect(saved[0].scoreXml).toBe(xml);
  expect(saved[0].notes).toEqual(expected.song.notes);
  expect(saved[0].tempo).toBe(expected.song.tempo);
}

for (const [label, tempo] of [['sound', sound], ['metronome', metronome]] as const) {
  it(`does not claim printed fingers for unmarked notes with numeric ${label} tempo`, async () => {
    const xml = score(note(), tempo);
    expect(parseMusicXml(xml).warnings).toEqual([]);
    await importAndCheck(xml, unmarkedMessage);
  });
  it(`reports retained playable finger hints with numeric ${label} tempo`, async () => {
    const xml = score(note(mark()), tempo);
    const parsed = parseMusicXml(xml);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.song.notes[0].finger).toBe(3);
    await importAndCheck(xml, markedMessage);
  });
  it(`ignores a numeric mark on a rest when no playable note has a hint (${label})`, async () => {
    const xml = score(`<note><rest/><duration>1</duration>${mark()}</note>${note()}`, tempo);
    const parsed = parseMusicXml(xml);
    expect(parsed.warnings).toEqual([]);
    expect(xml).toContain('<fingering>3</fingering>');
    expect(parsed.song.notes).toHaveLength(1);
    expect(parsed.song.notes[0].finger).toBeUndefined();
    await importAndCheck(xml, unmarkedMessage);
  });
}
it('finds a playable hint after an unmarked first note', async () => {
  const xml = score(note() + note(mark('5')));
  expect(parseMusicXml(xml).song.notes.map(n => n.finger)).toEqual([undefined, 5]);
  await importAndCheck(xml, markedMessage);
});
it('reports a hint retained from a tied continuation', async () => {
  const xml = score(note('<tie type="start"/>') + note('<tie type="stop"/>' + mark('2')));
  const parsed = parseMusicXml(xml);
  expect(parsed.warnings).toEqual([]);
  expect(parsed.song.notes).toHaveLength(1);
  expect(parsed.song.notes[0]).toMatchObject({ finger: 2, sourceNoteIds: ['0:0:0', '0:0:1'] });
  await importAndCheck(xml, markedMessage);
});
it('preserves the compound-mark warning instead of claiming a playable hint', async () => {
  const xml = score(note(mark('1-2')));
  const parsed = parseMusicXml(xml);
  expect(parsed.song.notes[0].finger).toBeUndefined();
  expect(parsed.warnings).toEqual(['Non-numeric or compound fingering marks remain in the score but are not shown as a single finger hint.']);
  await importAndCheck(xml, parsed.warnings.join(' '));
});
it('preserves the cue warning when its mark is not a playable hint', async () => {
  const xml = score(note(mark(), '<cue/>') + note());
  const parsed = parseMusicXml(xml);
  expect(parsed.song.notes).toHaveLength(1);
  expect(parsed.song.notes[0].finger).toBeUndefined();
  expect(parsed.warnings).toEqual(['Cue notes are displayed but omitted from playback.']);
  await importAndCheck(xml, parsed.warnings.join(' '));
});
it('preserves warning text and order even when a playable hint exists', async () => {
  const xml = score(note(mark('2')), '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>');
  const parsed = parseMusicXml(xml);
  expect(parsed.song.notes[0].finger).toBe(2);
  expect(parsed.warnings).toEqual([
    'Dynamics, articulation, pedal, fermatas and ornament symbols are shown in the score but are not performed automatically.',
    'No numeric tempo is written; playback uses 120 BPM.',
  ]);
  await importAndCheck(xml, parsed.warnings.join(' '));
});
it('preserves the missing numeric tempo warning for unmarked notes', async () => {
  const xml = score(note(), '');
  expect(parseMusicXml(xml).warnings).toEqual(['No numeric tempo is written; playback uses 120 BPM.']);
  await importAndCheck(xml, 'No numeric tempo is written; playback uses 120 BPM.');
});
