import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import recognized from '../fixtures/omr/audiveris-5.11.0.musicxml?raw';
import type { Song } from './music';
import { parseMusicXml } from './musicxml';
import { editScoreSlot, scoreAuthoringSlots } from './musicxmlAuthoring';

const finger = (n: number) => `<notations><technical><fingering>${n}</fingering></technical></notations>`;
const note = (step: string, chord = false, extra = '', attrs = '') => `<note${attrs}>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem default-y="-10">up</stem><staff>1</staff>${extra}</note>`;
const rest = '<note><rest/><duration>12</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>';
const xml = (tones = note('C', false, finger(1)) + note('E', true, finger(3)) + note('G', true, finger(5))) => `<score-partwise version="4.0"><work><work-title>Original chord exercise</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><direction><sound tempo="90"/></direction>${tones}${rest}<direction><offset>-8</offset><sound tempo="60"/></direction><backup><duration>16</duration></backup>${note('F', false, finger(2)).replace('<voice>1', '<voice>2').replace('<staff>1', '<staff>2')}<forward><duration>12</duration></forward></measure><measure number="2">${note('D', false, finger(2))}</measure></part></score-partwise>`;
const song = (tones?: string) => parseMusicXml(xml(tones)).song;
const music = (s: Song) => s.notes.map(({ id: _id, sourceNoteIds: _ids, ...n }) => n);
const nodes = (s: Song) => Array.from(new DOMParser().parseFromString(s.scoreXml!, 'application/xml').getElementsByTagName('*')).filter(n => n.localName === 'note');
function unchangedTiming(before: Song, after: Song) {
  expect(parseMusicXml(after.scoreXml!).scoreTimeline.measures).toEqual(parseMusicXml(before.scoreXml!).scoreTimeline.measures);
  expect(parseMusicXml(after.scoreXml!).measureStartTempos).toEqual(parseMusicXml(before.scoreXml!).measureStartTempos);
  expect(after.duration).toBe(before.duration);
  expect(music(parseMusicXml(after.scoreXml!).song)).toEqual(music(after));
}

describe('safe engraving-position compatibility', () => {
  it('edits the unchanged captured Audiveris output without discarding its positions', () => {
    const input = parseMusicXml(recognized).song, before = JSON.stringify(input);
    expect(scoreAuthoringSlots(input)).toHaveLength(16);
    expect(scoreAuthoringSlots(input).every(s => !s.reason)).toBe(true);
    const deleted = editScoreSlot(input, '0:0:0', { action: 'delete' });
    expect(nodes(deleted)[0].getAttribute('default-x')).toBe('75');
    const restored = editScoreSlot(deleted, '0:0:0', { action: 'insert', pitch: 60, beats: 1 });
    expect(nodes(restored).map(n => n.getAttribute('default-x'))).toEqual(nodes(input).map(n => n.getAttribute('default-x')));
    expect(music(restored)).toEqual(music(input));
    expect(restored.scoreXml).toContain('<software>Audiveris 5.11.0</software>');
    const added = editScoreSlot(input, '0:0:0', { action: 'addChordTone', pitch: 64 });
    expect(added.notes).toHaveLength(17);
    expect(nodes(added)[1].attributes.length).toBe(0);
    expect(nodes(added)[1].getElementsByTagName('stem')[0].attributes.length).toBe(0);
    expect(music(added).filter(n => !(n.pitch === 64 && n.start === 0))).toEqual(music(input));
    unchangedTiming(input, added);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('retains all four coordinates exactly on resize, deletion and rest insertion', () => {
    const positions = ' default-x="+12.50" default-y="-30" relative-x=".5" relative-y="0"';
    const input = song(note('C', false, finger(1), positions));
    for (const result of [editScoreSlot(input, '0:0:0', { action: 'duration', beats: .5 }), editScoreSlot(input, '0:0:0', { action: 'delete' })]) {
      expect(Array.from(nodes(result)[0].attributes).map(a => [a.name, a.value])).toEqual(Array.from(nodes(input)[0].attributes).map(a => [a.name, a.value]));
    }
    const removed = editScoreSlot(input, '0:0:0', { action: 'delete' });
    const filled = editScoreSlot(removed, '0:0:0', { action: 'insert', pitch: 62, beats: .5 });
    expect(nodes(filled)[0].getAttribute('default-x')).toBe('+12.50');
    expect(nodes(filled)[1].attributes.length).toBe(0);
  });
  it('keeps the consumed rest’s own position rather than duplicating the resized note’s', () => {
    const input = parseMusicXml(xml(note('C', false, '', ' default-x="20"')).replace('<note><rest/>', '<note default-x="40" relative-y="3"><rest/>')).song;
    const result = editScoreSlot(input, '0:0:0', { action: 'duration', beats: 2 });
    expect(nodes(result).slice(0, 2).map(n => n.getAttribute('default-x'))).toEqual(['20', '40']);
    expect(nodes(result)[1].getAttribute('relative-y')).toBe('3');
  });
  it.each(['default-x="NaN"', 'default-y="Infinity"', 'relative-x="1e3"', 'relative-y=""', 'default-x="0x10"', 'print-object="no"', 'dynamics="50"', 'attack="1"', 'pizzicato="yes"', 'id="n1"', 'ext:default-x="10"'])('fails closed for %s', attribute => {
    const input = parseMusicXml(xml(note('C', false, '', ` ${attribute}`)).replace('<score-partwise ', '<score-partwise xmlns:ext="urn:extension" ')).song;
    expect(scoreAuthoringSlots(input)[0].reason).toMatch(/not supported/);
    expect(() => editScoreSlot(input, '0:0:0', { action: 'addChordTone', pitch: 64 })).toThrow(/not supported/);
  });
});

describe('bounded same-onset chord authoring', () => {
  it('adds to a single note and then an existing chord while preserving fingers, source IDs and provenance', () => {
    const input = { ...song(note('C', false, finger(1), ' default-x="12" default-y="-40"')), folderSource: { folderId: 'folder', name: 'original.musicxml', digest: 'abc' } };
    const snapshot = JSON.stringify(input);
    const two = editScoreSlot(input, '0:0:0', { action: 'addChordTone', pitch: 64 });
    const three = editScoreSlot(two, '0:0:1', { action: 'addChordTone', pitch: 67 });
    expect(scoreAuthoringSlots(three).slice(0, 3).map(s => [s.chordSize, s.reason])).toEqual([[3, undefined], [3, undefined], [3, undefined]]);
    expect(three.notes.find(n => n.pitch === 67)).toMatchObject({ start: 0, duration: 60 / 90, hand: 'right', sourceNoteIds: ['0:0:2'] });
    expect(three.notes.find(n => n.pitch === 67)?.finger).toBeUndefined();
    expect(three.notes.find(n => n.pitch === 60)?.finger).toBe(1);
    expect(three.notes.find(n => n.pitch === 65)).toMatchObject({ finger: 2, sourceNoteIds: ['0:0:4'] });
    expect(three.notes.find(n => n.pitch === 62)?.sourceNoteIds).toEqual(['0:1:0']);
    expect(three.folderSource).toEqual(input.folderSource);
    expect(three.folderSource).not.toBe(input.folderSource);
    expect(three.id).toBe(input.id); expect(three.title).toBe(input.title);
    expect(nodes(three)[0].getAttribute('default-y')).toBe('-40');
    expect(nodes(three)[1].hasAttribute('default-y')).toBe(false);
    unchangedTiming(input, three);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it.each([0, 1, 2])('deletes chord tone %i without rests or moving any other tone', index => {
    const input = song(), original = JSON.stringify(input), target = input.notes.find(n => n.sourceNoteIds?.includes(`0:0:${index}`))!;
    const result = editScoreSlot(input, `0:0:${index}`, { action: 'delete' });
    expect(music(result)).toEqual(music(input).filter(n => n.pitch !== target.pitch));
    expect(nodes(result).filter(n => n.getElementsByTagName('rest').length)).toHaveLength(1);
    expect(nodes(result)[0].getElementsByTagName('chord')).toHaveLength(0);
    expect(nodes(result)[1].getElementsByTagName('chord')).toHaveLength(1);
    expect(scoreAuthoringSlots(result).slice(0, 2).every(s => s.chordSize === 2 && !s.reason)).toBe(true);
    unchangedTiming(input, result);
    expect(JSON.stringify(input)).toBe(original);
  });
  it.each([0, 1])('leaves a plain independent note after deleting tone %i of a two-tone chord', index => {
    const input = song(note('C') + note('E', true));
    const result = editScoreSlot(input, `0:0:${index}`, { action: 'delete' });
    expect(scoreAuthoringSlots(result)[0]).toMatchObject({ chordSize: 1, rest: false, reason: undefined });
    expect(nodes(result)[0].getElementsByTagName('chord')).toHaveLength(0);
    expect(editScoreSlot(result, '0:0:0', { action: 'duration', beats: 2 }).notes.find(n => n.sourceNoteIds?.includes('0:0:0'))?.duration).toBeCloseTo(2 * 60 / 90);
  });
  it('preserves the promoted tone’s enharmonic spelling, accidental, positions and fingering', () => {
    const spelled = note('D', true, finger(3), ' default-x="50" default-y="-20"').replace('<octave>', '<alter>-1</alter><octave>').replace('<stem ', '<accidental cautionary="yes">flat</accidental><stem ');
    const input = song(note('C') + spelled);
    const result = editScoreSlot(input, '0:0:0', { action: 'delete' });
    expect(result.scoreXml).toContain('<step>D</step><alter>-1</alter>');
    expect(result.scoreXml).toContain('<accidental cautionary="yes">flat</accidental>');
    expect(nodes(result)[0].getAttribute('default-y')).toBe('-20');
    expect(result.notes.find(n => n.pitch === 61)).toMatchObject({ finger: 3, start: 0 });
    unchangedTiming(input, result);
  });
  it.each(['default', 'prefixed'])('round trips %s namespaces, key signature and added chromatic pitch', kind => {
    const uri = 'http://www.musicxml.org/ns/musicxml';
    const raw = kind === 'default' ? xml().replace('<score-partwise ', `<score-partwise xmlns="${uri}" `) : xml().replace(/<(\/?)([a-z][\w-]*)/g, '<$1m:$2').replace('<m:score-partwise ', `<m:score-partwise xmlns:m="${uri}" `);
    const input = parseMusicXml(raw).song;
    const result = editScoreSlot(input, '0:0:1', { action: 'addChordTone', pitch: 66 });
    const added = nodes(result)[3];
    expect(added.namespaceURI).toBe(uri);
    expect(Array.from(added.getElementsByTagName('*')).every(n => n.namespaceURI === uri)).toBe(true);
    expect(result.notes.find(n => n.pitch === 66)).toMatchObject({ start: 0, hand: 'right' });
    expect(result.notes.find(n => n.pitch === 66)?.finger).toBeUndefined();
    expect(result.scoreXml).toMatch(/fifths>-2<\//);
    unchangedTiming(input, result);
  });
  it('allows only the requested tone to be removed when the score contains just a chord', () => {
    const raw = '<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="0" implicit="yes"><attributes><divisions>4</divisions></attributes>' + note('C') + note('E', true) + '</measure></part></score-partwise>';
    const one = editScoreSlot(parseMusicXml(raw).song, '0:0:0', { action: 'delete' });
    expect(one.notes).toHaveLength(1);
    expect(() => editScoreSlot(one, '0:0:0', { action: 'delete' })).toThrow(/at least one/);
  });
  it('rejects duplicate pitches, invalid pitches and chord duration changes atomically', () => {
    const input = song(), original = JSON.stringify(input);
    for (const pitch of [60, 64, 67]) expect(() => editScoreSlot(input, '0:0:1', { action: 'addChordTone', pitch })).toThrow(/already contains/);
    for (const pitch of [NaN, Infinity, -.5, 128, 60.5]) expect(() => editScoreSlot(input, '0:0:1', { action: 'addChordTone', pitch })).toThrow(/Pitch/);
    for (const id of ['0:0:0', '0:0:1', '0:0:2']) expect(() => editScoreSlot(input, id, { action: 'duration', beats: 2 })).toThrow(/Chord durations/);
    expect(() => editScoreSlot(input, '0:0:3', { action: 'addChordTone', pitch: 70 })).toThrow(/sounding note/);
    expect(JSON.stringify(input)).toBe(original);
  });
  it.each([
    note('C') + note('E', true).replace('<duration>4', '<duration>2'),
    note('C') + note('E', true).replace('<staff>1', '<staff>2'),
    note('C') + note('E', true).replace('<type>quarter</type>', '<type>half</type>'),
    note('C') + note('E', true).replace('<type>quarter</type>', '<type>quarter</type><dot/>'),
    note('C') + note('D', true).replace('<octave>', '<alter>-2</alter><octave>'),
    note('C') + '<direction><direction-type><words>dolce</words></direction-type></direction>' + note('E', true),
    note('C') + '<attributes><divisions>4</divisions></attributes>' + note('E', true),
    note('C') + note('E', true).replace('<chord/>', '<chord/><chord/>'),
    note('C') + note('E', true).replace('<chord/>', '<chord custom="yes"/>'),
    note('C') + note('C', true),
    note('C') + note('E', true, '<beam number="1">end</beam>'),
    note('C') + note('E', true, '<notations><slur type="start"/></notations>'),
    note('C') + note('E', true, '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'),
  ])('refuses unsupported or malformed chord groups without stripping notation (%#)', tones => {
    const input = song(tones), original = JSON.stringify(input);
    for (const id of ['0:0:0', '0:0:1']) {
      expect(scoreAuthoringSlots(input).find(s => s.sourceId === id)?.reason).toMatch(/not supported/);
      expect(() => editScoreSlot(input, id, { action: 'delete' })).toThrow(/not supported/);
      expect(() => editScoreSlot(input, id, { action: 'addChordTone', pitch: 70 })).toThrow(/not supported/);
    }
    expect(JSON.stringify(input)).toBe(original);
  });
  it('rejects stale metadata and ambiguous source mappings before chord edits', () => {
    const input = song();
    for (const stale of [{ ...input, tempo: 123 }, { ...input, duration: 99 }, { ...input, notes: input.notes.map(n => ({ ...n, finger: 4 })) }, { ...input, notes: input.notes.map(n => ({ ...n, sourceNoteIds: ['0:0:0'] })) }]) {
      expect(() => editScoreSlot(stale, '0:0:0', { action: 'addChordTone', pitch: 70 })).toThrow(/out of date/);
      expect(() => editScoreSlot(stale, '0:0:0', { action: 'delete' })).toThrow(/out of date/);
    }
  });
});

it('preserves rest display placement when splitting or consuming recognized-style rests', () => {
  const input = parseMusicXml(xml(note('C')).replace('<note><rest/>', '<note default-x="40"><rest><display-step>D</display-step><display-octave>3</display-octave></rest>')).song;
  for (const result of [editScoreSlot(input, '0:0:0', { action: 'duration', beats: 2 }), editScoreSlot(input, '0:0:1', { action: 'insert', pitch: 66, beats: 1 })]) {
    expect(result.scoreXml).toContain('<rest><display-step>D</display-step><display-octave>3</display-octave></rest>');
    unchangedTiming(input, result);
  }
});

it('preserves type and retained dot display details when resizing positioned notes', () => {
  const raw = xml(note('C', false, finger(1), ' default-x="20"')).replace('<duration>4</duration>', '<duration>6</duration>').replace('<type>quarter</type>', '<type size="full">quarter</type><dot relative-y="2"/>').replace('<duration>12</duration>', '<duration>10</duration>');
  const input = parseMusicXml(raw).song;
  const result = editScoreSlot(input, '0:0:0', { action: 'duration', beats: .75 });
  expect(result.scoreXml).toContain('<type size="full">eighth</type><dot relative-y="2"/>');
  expect(result.notes.find(n => n.pitch === 60)?.finger).toBe(1);
  unchangedTiming(input, result);
});

it('rejects a rest-led chord and foreign-namespace chord semantics without mutating input', () => {
  for (const raw of [xml('<note><rest/><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>' + note('E', true)), xml(note('C') + note('E', true).replace('<chord/>', '<ext:chord xmlns:ext="urn:extension"/>'))]) {
    const input = parseMusicXml(raw).song, original = JSON.stringify(input);
    expect(() => editScoreSlot(input, '0:0:0', { action: 'delete' })).toThrow(/not supported/);
    expect(JSON.stringify(input)).toBe(original);
  }
});


it('does not copy pitch-specific dot positions to a newly added chord tone', () => {
  const raw = xml(note('C')).replace('<duration>4</duration>', '<duration>6</duration>').replace('<type>quarter</type>', '<type size="full">quarter</type><dot relative-y="2"/>').replace('<duration>12</duration>', '<duration>10</duration>');
  const input = parseMusicXml(raw).song;
  const result = editScoreSlot(input, '0:0:0', { action: 'addChordTone', pitch: 64 });
  expect(nodes(result)[0].getElementsByTagName('dot')[0].getAttribute('relative-y')).toBe('2');
  expect(nodes(result)[1].getElementsByTagName('dot')[0].attributes.length).toBe(0);
  expect(nodes(result)[1].getElementsByTagName('type')[0].textContent).toBe('quarter');
  unchangedTiming(input, result);
});


it.each([
  note('E', true, '<notations><technical><fingering><slur type="start"/></fingering></technical></notations>'),
  note('E', true).replace('<stem default-y="-10">up</stem>', '<stem>up<beam number="1">begin</beam></stem>'),
  note('E', true).replace('<octave>4</octave>', '<octave>4<time-modification/></octave>'),
  note('E', true).replace('<pitch>', '<pitch><notehead>diamond</notehead>'),
])('refuses complex semantics hidden inside otherwise accepted note containers (%#)', tone => {
  const input = song(note('C') + tone), original = JSON.stringify(input);
  for (const id of ['0:0:0', '0:0:1']) expect(() => editScoreSlot(input, id, { action: 'delete' })).toThrow(/not supported/);
  expect(JSON.stringify(input)).toBe(original);
});


it.each([
  { units: '32', type: 'breve', dots: '' },
  { units: '7', type: 'quarter', dots: '<dot/><dot/>' },
  { units: '.125', type: '128th', dots: '' },
])('refuses adding a tone outside the documented whole–64th/single-dot duration range ($type)', ({ units, type, dots }) => {
  const source = note('C').replace('<duration>4</duration>', `<duration>${units}</duration>`).replace('<type>quarter</type>', `<type>${type}</type>${dots}`);
  const input = parseMusicXml(xml(source).replace('<backup><duration>16</duration></backup>', '')).song, original = JSON.stringify(input);
  expect(() => editScoreSlot(input, '0:0:0', { action: 'addChordTone', pitch: 64 })).toThrow(/whole through 64th/);
  expect(JSON.stringify(input)).toBe(original);
});
