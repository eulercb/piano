import { expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xml from '../fixtures/transpose-cues.musicxml?raw';
import { parseMusicXml } from './musicxml';
import { transposeScore } from './scoreEditing';
import { parseProject } from './project';
import { serializeProject } from './projectFormat';

const writtenPitches = (source: string) => {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  const steps: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return Array.from(doc.getElementsByTagName('*')).filter(e => e.localName === 'pitch').map(pitch => {
    const text = (name: string) => Array.from(pitch.getElementsByTagName('*')).find(e => e.localName === name)?.textContent ?? '';
    return (Number(text('octave')) + 1) * 12 + steps[text('step')] + Number(text('alter'));
  });
};
const pitch = (step = 'C', octave = '4', alter?: string) => `<pitch><step>${step}</step>${alter === undefined ? '' : `<alter>${alter}</alter>`}<octave>${octave}</octave></pitch>`;
const note = (body: string, prefix = '') => `<note>${prefix}${body}<duration>1</duration><type>quarter</type></note>`;
const study = (notes: string, attributes = '') => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>${attributes}</attributes>${notes}</measure></part></score-partwise>`;
const withoutPitch = (source: string) => {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  for (const e of Array.from(doc.getElementsByTagName('*')))
    if (['pitch', 'accidental'].includes(e.localName || '')) e.parentNode!.removeChild(e);
  return new XMLSerializer().serializeToString(doc);
};

it('transposes ordinary and silent cue pitches together', () => {
  const original = parseMusicXml(xml).song;
  const result = transposeScore(original, 2);
  expect(result.notes.map(note => note.pitch)).toEqual(original.notes.map(note => note.pitch + 2));
  expect(writtenPitches(xml)).toEqual([60, 66, 69, 71, 72, 76, 48]);
  expect(writtenPitches(result.scoreXml!)).toEqual([62, 68, 71, 73, 74, 78, 50]);
});

it.each([-3, 0, 2, 12])('preserves cue silence, timing, hands, fingers and all non-pitch source through %i and round trips', semitones => {
  const parsed = parseMusicXml(xml);
  const original = { ...parsed.song, folderSource: { folderId: 'test-folder', name: 'study.musicxml', digest: 'a'.repeat(64) } };
  const snapshot = JSON.stringify(original);
  const result = transposeScore(original, semitones);
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(result).toMatchObject({ id: original.id, title: original.title, tempo: original.tempo, duration: original.duration, folderSource: original.folderSource });
  expect(result.notes).toEqual(original.notes.map(n => ({ ...n, pitch: n.pitch + semitones })));
  expect(result.notes).toHaveLength(5); // Cue chord and rest remain silent.
  expect(writtenPitches(result.scoreXml!)).toEqual(writtenPitches(xml).map(n => n + semitones));
  expect(withoutPitch(result.scoreXml!)).toBe(withoutPitch(xml));
  const reparsed = parseMusicXml(result.scoreXml!);
  expect(reparsed.song.notes).toEqual(result.notes);
  expect(reparsed.scoreTimeline).toEqual(parsed.scoreTimeline);
  expect(reparsed.tempoMap).toEqual(parsed.tempoMap);
  expect(reparsed.warnings).toEqual(parsed.warnings);
  expect(parseProject(serializeProject(result))).toEqual(result);
});

it.each(['default', 'prefixed'])('transposes %s namespaced pitched cues', namespace => {
  const source = namespace === 'default'
    ? xml.replace('<score-partwise ', '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" ')
    : xml.replace(/<(\/?)([a-z][\w-]*)/g, '<$1m:$2').replace('<m:score-partwise ', '<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml" ');
  const original = parseMusicXml(source).song;
  const result = transposeScore(original, 1);
  expect(writtenPitches(result.scoreXml!)).toEqual(writtenPitches(xml).map(n => n + 1));
  expect(parseMusicXml(result.scoreXml!).song.notes).toEqual(result.notes);
  expect(parseProject(serializeProject(result))).toEqual(result);
});

it('transposes silent cue graces without realizing or sounding them', () => {
  const source = study(`<note><grace/><cue/>${pitch('D')}<type>eighth</type></note>${note(pitch())}`);
  const parsed = parseMusicXml(source);
  const result = transposeScore(parsed.song, -1);
  expect(writtenPitches(result.scoreXml!)).toEqual([61, 59]);
  expect(result.notes).toEqual(parsed.song.notes.map(n => ({ ...n, pitch: n.pitch - 1 })));
  expect(parseMusicXml(result.scoreXml!).scoreTimeline).toEqual(parsed.scoreTimeline);
});

it('keeps hidden and cue-sized sounding notes sounding rather than treating them as cues', () => {
  const source = study(note(pitch()).replace('<note>', '<note print-object="no">') + note(pitch('D')).replace('<type>', '<type size="cue">') + note(pitch('E'), '<cue/>'));
  const original = parseMusicXml(source).song;
  const result = transposeScore(original, 1);
  expect(result.notes.map(n => n.pitch)).toEqual([61, 63]);
  expect(writtenPitches(result.scoreXml!)).toEqual([61, 63, 65]);
  expect(withoutPitch(result.scoreXml!)).toBe(withoutPitch(source));
});

it('moves every tie constituent and every part exactly once', () => {
  const part = (id: string) => `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>${note(pitch()).replace('<type>', '<tie type="start"/><type>')}<backup><duration>1</duration></backup>${note(pitch('E'), '<cue/>')}</measure><measure number="2">${note(pitch()).replace('<type>', '<tie type="stop"/><type>')}${note(pitch('G'), '<cue/>')}</measure></part>`;
  const source = `<score-partwise><part-list><score-part id="P1"><part-name>Upper</part-name></score-part><score-part id="P2"><part-name>Lower</part-name></score-part></part-list>${part('P1')}${part('P2')}</score-partwise>`;
  const original = parseMusicXml(source).song;
  const result = transposeScore(original, 5);
  expect(original.notes).toHaveLength(2);
  expect(result.notes).toEqual(original.notes.map(n => ({ ...n, pitch: n.pitch + 5 })));
  expect(result.notes[0].sourceNoteIds).toHaveLength(2);
  expect(writtenPitches(result.scoreXml!)).toEqual(writtenPitches(source).map(n => n + 5));
});

it.each([
  '', pitch('H'), pitch('constructor'), pitch('D', ''), pitch('D', '4.5'), pitch('D', '4', ''), pitch('D', '4', '0.5'),
  pitch('D', '4', 'NaN'), pitch('C', '-2'), pitch('G', '9', '1'), pitch('D', '9007199254740992'),
  pitch('A', '750599937895081', '-9007199254740991'), pitch('B', '-750599937895084', '9007199254740991'),
  pitch() + pitch('D'), pitch().replace('<step>C</step>', '<step>C</step><step>D</step>'),
  pitch().replace('<octave>', '<alter>0</alter><alter>1</alter><octave>'),
  pitch().replace('<octave>4</octave>', '<octave>4</octave><octave>5</octave>'),
  pitch().replace('<step>C</step>', '<step><text>C</text></step>'),
  pitch().replace('</pitch>', '<display-step>D</display-step></pitch>'),
  pitch().replace('<pitch>', '<pitch xmlns="urn:extension">'),
  pitch().replace('<step>', '<step xmlns="urn:extension">'),
  pitch('D', '4', '1').replace('<alter>', '<alter xmlns="urn:extension">'),
  pitch().replace('<octave>', '<octave xmlns="urn:extension">'),
  `<rest/>${pitch()}`,
])('refuses unsupported cue pitch %s without changing source, playback or backup', cuePitch => {
  // Cue pitch is deliberately outside the importer's playback validation.
  const original = parseMusicXml(study(note(pitch()) + note(cuePitch, '<cue/>'))).song;
  const before = serializeProject(original);
  expect(() => transposeScore(original, 1)).toThrow(/supported whole MIDI pitch.*including cue notes/);
  expect(serializeProject(original)).toBe(before);
  expect(parseProject(before)).toEqual(original);
});

it.each([
  { edge: pitch('G', '9'), semitones: 1, expected: 127 },
  { edge: pitch('C', '-1'), semitones: -1, expected: 0 },
])('enforces inclusive MIDI limits on silent cues as well as sounding notes: $expected', ({ edge, semitones, expected }) => {
  for (const cue of ['', '<cue/>']) {
    const original = parseMusicXml(study(note(pitch()) + note(edge, cue))).song;
    const snapshot = serializeProject(original);
    expect(writtenPitches(transposeScore(original, 0).scoreXml!).at(-1)).toBe(expected);
    expect(() => transposeScore(original, semitones)).toThrow('outside the piano MIDI range');
    expect(serializeProject(original)).toBe(snapshot);
    expect(writtenPitches(transposeScore(original, -semitones).scoreXml!).at(-1)).toBe(expected - semitones);
  }
});

it.each([.5, NaN, Infinity, -Infinity])('refuses invalid interval %s without mutation', interval => {
  const original = parseMusicXml(xml).song;
  const before = serializeProject(original);
  expect(() => transposeScore(original, interval)).toThrow('whole number of semitones');
  expect(serializeProject(original)).toBe(before);
});

it('derives written pitches from source even if cached playback or mappings are stale', () => {
  const parsed = parseMusicXml(xml).song;
  const original = { ...parsed, notes: parsed.notes.map(n => ({ ...n, pitch: 10, sourceNoteIds: ['99:99:99'] })) };
  const before = serializeProject(original);
  const result = transposeScore(original, 1);
  expect(result.notes).toEqual(parsed.notes.map(n => ({ ...n, pitch: n.pitch + 1 })));
  expect(writtenPitches(result.scoreXml!)).toEqual(writtenPitches(xml).map(n => n + 1));
  expect(serializeProject(original)).toBe(before);
});

it('keeps transposing-instrument playback unsupported rather than rewriting concert and written pitches differently', () => {
  const source = study(note(pitch()) + note(pitch('D'), '<cue/>'), '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>');
  const original = { ...parseMusicXml(xml).song, scoreXml: source };
  const before = serializeProject(original);
  expect(() => transposeScore(original, 1)).toThrow('transposing-instrument scores are not supported');
  expect(serializeProject(original)).toBe(before);
});
