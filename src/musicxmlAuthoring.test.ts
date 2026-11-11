import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './musicxml';
import { editScoreSlot, scoreAuthoringSlots } from './musicxmlAuthoring';
const note = (step = 'C', duration = 4, staff = 1, extra = '') => `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`;
const rest = (duration = 4, staff = 1) => `<note><rest/><duration>${duration}</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`;
const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>';
const wrap = (body: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
const score = (body = `${attrs}${note()}${rest(12)}<backup><duration>16</duration></backup>${note('E', 16, 2)}`) => parseMusicXml(wrap(`<measure number="1">${body}</measure><measure number="2">${note('G', 16)}</measure>`)).song;
describe('fixed-time MusicXML authoring', () => {
  it('lists written rests and source identities', () => {
    expect(scoreAuthoringSlots(score()).map(s => [s.sourceId, s.rest, s.beats])).toEqual([['0:0:0', false, 1], ['0:0:1', true, 3], ['0:0:2', false, 4], ['0:1:0', false, 4]]);
  });
  it('fills and splits an explicit rest while both hands and next measure stay fixed', () => {
    const s = score(), original = JSON.stringify(s);
    const result = editScoreSlot(s, '0:0:1', { action: 'insert', pitch: 61, beats: 1 });
    expect(result.notes.find(n => n.pitch === 61)).toMatchObject({ start: .5, duration: .5, hand: 'right' });
    expect(result.notes.filter(n => n.pitch !== 61).map(n => [n.pitch, n.start, n.duration])).toEqual(s.notes.map(n => [n.pitch, n.start, n.duration]));
    expect(scoreAuthoringSlots(result).filter(s => s.rest).map(s => s.beats)).toEqual([2]);
    expect(JSON.stringify(s)).toBe(original);
    expect(result.id).toBe(s.id);
  });
  it('deletes to silence without moving voices or measures', () => {
    const s = score(), r = editScoreSlot(s, '0:0:0', { action: 'delete' });
    expect(r.notes.map(n => [n.pitch, n.start, n.duration])).toEqual(s.notes.filter(n => n.pitch !== 60).map(n => [n.pitch, n.start, n.duration]));
    expect(scoreAuthoringSlots(r)[0]).toMatchObject({ rest: true, beats: 1 });
  });
  it('shortens to a note plus explicit rest', () => {
    const r = editScoreSlot(score(), '0:0:0', { action: 'duration', beats: .5 });
    expect(r.notes.find(n => n.pitch === 60)?.duration).toBe(.25);
    expect(scoreAuthoringSlots(r).slice(0, 2).map(s => s.beats)).toEqual([.5, .5]);
  });
  it('extends into an adjacent rest, preserving its remainder', () => {
    const r = editScoreSlot(score(), '0:0:0', { action: 'duration', beats: 2 });
    expect(r.notes.find(n => n.pitch === 60)?.duration).toBe(1);
    expect(scoreAuthoringSlots(r)[1]).toMatchObject({ rest: true, beats: 2 });
  });
  it('can consume the complete following rest', () => {
    const r = editScoreSlot(score(), '0:0:0', { action: 'duration', beats: 4 });
    expect(scoreAuthoringSlots(r)).toHaveLength(3);
    expect(r.notes.find(n => n.pitch === 64)?.start).toBe(0);
  });
  it('preserves tempo changes inside held notes and later directions', () => {
    const s = score(`${attrs}<direction><sound tempo="90"/></direction>${note()}${rest(12)}<direction><offset>-8</offset><sound tempo="60"/></direction>`);
    const r = editScoreSlot(s, '0:0:0', { action: 'duration', beats: 4 });
    expect(r.duration).toBe(s.duration);
    expect(r.notes[0].duration).toBeCloseTo(2 * 60 / 90 + 2);
    expect(r.notes[1].start).toBe(s.notes[1].start);
  });
  it('refuses deleting the only sounding note without mutating the source', () => {
    const s = parseMusicXml(wrap(`<measure number="0" implicit="yes">${attrs}${note()}</measure>`)).song;
    expect(() => editScoreSlot(s, '0:0:0', { action: 'delete' })).toThrow('at least one sounding note');
    expect(s.notes).toHaveLength(1);
  });
  it('preserves an emptied pickup and final measure when other notes remain', () => {
    const s = parseMusicXml(wrap(`<measure number="0" implicit="yes">${attrs}${note()}</measure><measure number="1">${note('E',16)}</measure>`)).song;
    const r = editScoreSlot(s, '0:0:0', { action: 'delete' });
    expect(r.notes[0].start).toBe(s.notes[1].start);
    expect(r.duration).toBe(s.duration);
    const last = editScoreSlot(s, '0:1:0', { action: 'delete' });
    expect(last.duration).toBe(s.duration);
  });
  it('preserves provenance and permits repeat edits after remapping', () => {
    const s = { ...score(), folderSource: { folderId: 'f', name: 'piece.xml', digest: 'abc' } };
    const r = editScoreSlot(s, '0:0:1', { action: 'insert', pitch: 62, beats: 1 });
    const second = editScoreSlot(r, '0:0:1', { action: 'delete' });
    expect(second.folderSource).toEqual(s.folderSource);
    expect(second.folderSource).not.toBe(s.folderSource);
  });
  it('uses inherited and updated divisions in their respective measures', () => {
    const s = parseMusicXml(wrap(`<measure number="1">${attrs}${note()}</measure><measure number="2">${rest()}</measure><measure number="3"><attributes><divisions>8</divisions></attributes>${rest(8)}</measure>`)).song;
    const r = editScoreSlot(s, '0:2:0', { action: 'insert', pitch: 67, beats: .5 });
    expect(r.scoreXml).toContain('<duration>4</duration><voice>1</voice><type>eighth</type>');
    expect(scoreAuthoringSlots(r).at(-1)?.beats).toBe(.5);
  });
  it('supports namespaced scores and preserves spelling on duration edits', () => {
    const s = parseMusicXml(wrap(`<measure number="1">${attrs}${note('D').replace('<octave>', '<alter>-1</alter><octave>')}${rest(12)}</measure>`).replace('<score-partwise ', '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" ')).song;
    const r = editScoreSlot(s, '0:0:0', { action: 'duration', beats: 2 });
    expect(r.scoreXml).toContain('<step>D</step><alter>-1</alter>');
    expect(r.notes[0].pitch).toBe(61);
  });
  it.each(['beam', 'lyric', 'time-modification'])('refuses %s on target', tag => {
    const s = score(`${attrs}${note().replace('</note>', `<${tag}/></note>`)}${rest(12)}`);
    expect(() => editScoreSlot(s, '0:0:0', { action: 'delete' })).toThrow('not supported');
  });
  it('refuses resizing chord leaders and followers', () => {
    const s = score(`${attrs}${note()}${note('E', 4, 1, '<chord/>')}${rest(12)}`);
    for (const id of ['0:0:0', '0:0:1']) expect(() => editScoreSlot(s, id, { action: 'duration', beats: 2 })).toThrow('Chord durations');
  });
  it('refuses tied notes while allowing unrelated slots', () => {
    const s = score(`${attrs}${note().replace('</duration>', '</duration><tie type="start"/>')}${note().replace('</duration>', '</duration><tie type="stop"/>')}${rest(8)}`);
    expect(() => editScoreSlot(s, '0:0:0', { action: 'delete' })).toThrow('not supported');
    expect(editScoreSlot(s, '0:0:2', { action: 'insert', pitch: 62, beats: 2 }).notes[0].duration).toBe(1);
  });
  it('refuses moving directions, consuming different voices or crossing backup', () => {
    for (const tail of ['<direction><sound tempo="90"/></direction>' + rest(12), rest(12, 2), '<backup><duration>4</duration></backup>' + rest(12)]) {
      const s = score(attrs + note() + tail);
      expect(() => editScoreSlot(s, '0:0:0', { action: 'duration', beats: 2 })).toThrow('immediately following');
    }
  });
  it('rejects stale playback and invalid source IDs', () => {
    const s = score();
    expect(() => editScoreSlot({ ...s, notes: s.notes.map(n => ({ ...n, start: n.start + 1 })) }, '0:0:0', { action: 'delete' })).toThrow('out of date');
    expect(() => editScoreSlot(s, '999:0:0', { action: 'delete' })).toThrow('existing');
  });
  it('rejects invalid durations, precision, pitches and nonrepresentable rests atomically', () => {
    const s = score(), snapshot = JSON.stringify(s);
    for (const beats of [0, -1, NaN, Infinity, .3, 6]) expect(() => editScoreSlot(s, '0:0:0', { action: 'duration', beats })).toThrow();
    expect(() => editScoreSlot(s, '0:0:0', { action: 'duration', beats: .0625 })).toThrow('divisions');
    expect(() => editScoreSlot(s, '0:0:1', { action: 'insert', pitch: 128, beats: 1 })).toThrow('Pitch');
    expect(() => editScoreSlot(s, '0:0:1', { action: 'insert', pitch: 60, beats: .5 })).toThrow('remaining rest');
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

it('preserves fingering, spelling, explicit accidental and stem when resizing', () => {
  const s = score(`${attrs}${note('D').replace('<octave>', '<alter>-1</alter><octave>').replace('<staff>', '<accidental cautionary="yes">flat</accidental><stem>up</stem><staff>').replace('</note>', '<notations><technical><fingering>3</fingering></technical></notations></note>')}${rest(12)}`);
  const r = editScoreSlot(s, '0:0:0', { action: 'duration', beats: 2 });
  expect(r.notes[0].finger).toBe(3);
  expect(r.scoreXml).toContain('<accidental cautionary="yes">flat</accidental><stem>up</stem>');
  expect(r.scoreXml).toContain('<fingering>3</fingering>');
});
it('refuses stale velocity, tempo and duration rather than resetting saved playback', () => {
  const s = score();
  for (const stale of [{ ...s, tempo: s.tempo + 1 }, { ...s, duration: s.duration! + 1 }, { ...s, notes: s.notes.map(n => ({ ...n, velocity: .1 })) }])
    expect(() => editScoreSlot(stale, '0:0:0', { action: 'delete' })).toThrow('out of date');
});
it('refuses custom note attributes and complex notation', () => {
  for (const body of [note().replace('<note>', '<note print-object="no">'), note().replace('</note>', '<notations><slur type="start"/></notations></note>')]) {
    const s = score(attrs + body + rest(12));
    expect(() => editScoreSlot(s, '0:0:0', { action: 'delete' })).toThrow('not supported');
  }
});
it('refuses a chord leader separated from its follower by a direction', () => {
  const s = score(attrs + note() + '<direction><sound tempo="100"/></direction>' + note('E', 4, 1, '<chord/>') + rest(12));
  expect(() => editScoreSlot(s, '0:0:0', { action: 'duration', beats: 1 })).toThrow('not supported');
});
