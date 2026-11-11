import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './musicxml';
import { editScoreSlot } from './musicxmlAuthoring';
const note = (pitch = 'C', extra = '', duration = 4) => `<note><pitch><step>${pitch}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>quarter</type>${extra}<staff>1</staff></note>`;
const rest = (duration = 4, staff = 1, voice = 1) => `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff></note>`;
const song = (body: string) => parseMusicXml(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>${body}</measure></part></score-partwise>`).song;

describe('independent fixed-slot review regressions', () => {
  it('keeps explicit accidental and stem when resizing a note', () => {
    const input = song(note('C', '<accidental cautionary="yes">natural</accidental><stem>up</stem>') + rest() + note('E'));
    const next = editScoreSlot(input, '0:0:0', { action: 'duration', beats: 2 });
    expect(next.scoreXml).toContain('<accidental cautionary="yes">natural</accidental>');
    expect(next.scoreXml).toContain('<stem>up</stem>');
  });
  it('does not silently reset existing playback velocity overrides', () => {
    const input = song(rest() + note('E'));
    input.notes[0].velocity = 0.23;
    let next;
    try {
      next = editScoreSlot(input, '0:0:0', { action: 'insert', pitch: 60, beats: 0.5 });
    } catch (error) {
      expect(String(error)).toMatch(/mapping|velocity|out of date/i);
      return;
    }
    expect(next.notes.find(n => n.pitch === 64)?.velocity).toBe(0.23);
  });
  it('preserves pickup, last-bar extent, both hands, tempo offset and shifted source IDs', () => {
    const input = song(rest() + note('E') + '<direction><offset>-2</offset><sound tempo="60"/></direction><backup><duration>8</duration></backup>' + note('G').replace('<staff>1', '<staff>2') + rest(4, 2));
    const before = parseMusicXml(input.scoreXml!);
    const next = editScoreSlot(input, '0:0:0', { action: 'insert', pitch: 60, beats: .5 });
    const after = parseMusicXml(next.scoreXml!);
    expect(after.scoreTimeline.measures).toEqual(before.scoreTimeline.measures);
    for (const original of input.notes) {
      const actual = next.notes.find(n => n.pitch === original.pitch)!;
      expect([actual.start, actual.duration, actual.hand, actual.finger]).toEqual([original.start, original.duration, original.hand, original.finger]);
      expect(actual.sourceNoteIds).not.toEqual(original.sourceNoteIds);
    }
  });
  it('refuses to borrow a rest from another voice or staff', () => {
    for (const silence of [rest(4, 2), rest(4, 1, 2)]) {
      expect(() => editScoreSlot(song(note() + silence), '0:0:0', { action: 'duration', beats: 2 })).toThrow(/same voice and staff/i);
    }
  });
  it('preserves untouched fingerings and provenance while reindexing', () => {
    const input = song(rest() + note('E', '<notations><technical><fingering>3</fingering></technical></notations>'));
    const next = editScoreSlot(input, '0:0:0', { action: 'insert', pitch: 60, beats: .5 });
    expect(next.id).toBe(input.id);
    expect(next.title).toBe(input.title);
    expect(next.notes.find(n => n.pitch === 64)).toMatchObject({ finger: 3, sourceNoteIds: ['0:0:2'] });
    expect(next.scoreXml).toContain('<fingering>3</fingering>');
  });
});

it('refuses stale tempo and duration metadata rather than resetting it', () => {
  const input = song(rest() + note());
  for (const changed of [{...input, tempo: 75}, {...input, duration: 100}]) {
    expect(() => editScoreSlot(changed, '0:0:0', {action: 'insert', pitch: 64, beats: 1})).toThrow(/out of date/);
  }
});
it('resizing a fingered note preserves its fingering', () => {
  const input = song(note('C', '<notations><technical><fingering>2</fingering></technical></notations>') + rest());
  const next = editScoreSlot(input, '0:0:0', {action: 'duration', beats: .5});
  expect(next.notes[0].finger).toBe(2);
  expect(next.notes[0].duration).toBe(.25);
  expect(next.scoreXml).toContain('<fingering>2</fingering>');
});
it('refuses deleting a chord leader separated from its follower by a direction', () => {
  const input = song(note() + '<direction><direction-type><words>dolce</words></direction-type></direction>' + note('E').replace('<note>', '<note><chord/>') + rest());
  expect(() => editScoreSlot(input, '0:0:0', {action: 'delete'})).toThrow(/chord|not supported/);
});
