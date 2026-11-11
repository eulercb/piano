import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import type { Song } from './music';
import { parseMusicXml } from './musicxml';
import { editScoreSlot, scoreAuthoringSlots } from './musicxmlAuthoring';
import { parseProject } from './project';

// Purpose-written score, including a tempo change inside a lengthened chord.
const tone = (step: string, alter: number, index: number, beats = 1, type = 'quarter', dots = '') => `<note default-x="20" default-y="${-40 + 10 * index}" relative-x=".5">${index ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>4</octave></pitch><duration>${16 * beats}</duration><voice>1</voice><type size="full">${type}</type>${dots}${alter ? '<accidental cautionary="yes">flat</accidental>' : ''}<stem default-y="-10">up</stem><staff>1</staff><notations><technical><fingering substitution="no">${index + 1}</fingering></technical></notations></note>`;
const chord = (beats = 1, type = 'quarter', dots = '') => tone('D', -1, 0, beats, type, dots) + tone('F', 0, 1, beats, type, dots) + tone('A', -1, 2, beats, type, dots);
const rest = (beats = 3) => `<note default-x="80" relative-y="3"><rest><display-step>D</display-step><display-octave>3</display-octave></rest><duration>${16 * beats}</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>`;
const lower = '<note><pitch><step>C</step><octave>3</octave></pitch><duration>64</duration><voice>2</voice><type>whole</type><staff>2</staff></note>';
const wrap = (body: string, after = rest()) => `<score-partwise version="4.0"><work><work-title>Chord rhythm exercise</work-title></work><identification><creator type="composer">Original test fixture</creator></identification><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>16</divisions><key><fifths>-4</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><direction><sound tempo="120"/></direction>${body}${after}<direction><offset>-32</offset><sound tempo="60"/></direction><backup><duration>64</duration></backup>${lower}</measure><measure number="2">${tone('B', 0, 0, 4, 'whole')}</measure></part></score-partwise>`;
const song = (body = chord(), after = rest()) => parseMusicXml(wrap(body, after)).song;
const nodes = (s: Song) => Array.from(new DOMParser().parseFromString(s.scoreXml!, 'application/xml').getElementsByTagName('*')).filter(n => n.localName === 'note');
const children = (e: Element) => Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1);
const serialize = (e: Element) => new XMLSerializer().serializeToString(e);
const toneDetails = (node: Element) => {
  const copy = node.cloneNode(true) as Element;
  for (const child of children(copy)) if (['duration', 'type', 'dot'].includes(child.localName ?? '')) copy.removeChild(child);
  return serialize(copy);
};
const music = (s: Song) => s.notes.map(({ id: _id, sourceNoteIds: _ids, ...n }) => n);
const chordNotes = (s: Song) => s.notes.filter(n => n.start === 0 && n.hand === 'right');
function fixedTimeline(before: Song, after: Song) {
  const oldScore = parseMusicXml(before.scoreXml!), newScore = parseMusicXml(after.scoreXml!);
  expect(newScore.scoreTimeline.measures).toEqual(oldScore.scoreTimeline.measures);
  expect(newScore.measureStartTempos).toEqual(oldScore.measureStartTempos);
  expect(after.duration).toBe(before.duration);
  expect(after.tempo).toBe(before.tempo);
  expect(music(after).filter(n => n.start > 0 || n.hand === 'left')).toEqual(music(before).filter(n => n.start > 0 || n.hand === 'left'));
  expect(nodes(after).slice(-2).map(serialize)).toEqual(nodes(before).slice(-2).map(serialize));
  expect(music(newScore.song)).toEqual(music(after));
}

describe('whole-chord duration edits', () => {
  it.each([.5, .75, 1, 2, 3, 4])('resizes every tone to %s beats identically from leader, middle or final selection', beats => {
    const input = song(), snapshot = JSON.stringify(input);
    const outputs = [0, 1, 2].map(i => editScoreSlot(input, `0:0:${i}`, { action: 'duration', beats }));
    expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0]);
    const output = outputs[0];
    expect(chordNotes(output).map(n => [n.pitch, n.duration, n.finger])).toEqual([61, 65, 68].map((p, i) => [p, Math.min(beats, 2) * .5 + Math.max(0, beats - 2), i + 1]));
    expect(scoreAuthoringSlots(output).slice(0, 3).map(s => [s.beats, s.chordSize, s.reason])).toEqual([[beats, 3, undefined], [beats, 3, undefined], [beats, 3, undefined]]);
    expect(nodes(output).slice(0, 3).map(toneDetails)).toEqual(nodes(input).slice(0, 3).map(toneDetails));
    const rests = scoreAuthoringSlots(output).filter(s => s.rest);
    expect(rests.map(s => s.beats)).toEqual(beats < 1 ? [1 - beats, 3] : beats < 4 ? [4 - beats] : []);
    if (beats < 1) {
      expect(nodes(output)[3].attributes.length).toBe(0);
      expect(nodes(output)[4].getAttribute('default-x')).toBe('80');
    } else if (beats < 4) {
      expect(nodes(output)[3].getAttribute('default-x')).toBe('80');
      expect(nodes(output)[3].getElementsByTagName('display-step')[0].textContent).toBe('D');
    }
    expect(chordNotes(output).map(n => n.sourceNoteIds)).toEqual([['0:0:0'], ['0:0:1'], ['0:0:2']]);
    fixedTimeline(input, output);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it.each([
    { beats: .0625, type: '32nd' }, { beats: .125, type: '16th' },
    { beats: .25, type: 'eighth' }, { beats: .5, type: 'quarter' },
    { beats: .75, type: 'quarter', dot: true }, { beats: 1, type: 'half' },
    { beats: 1.5, type: 'half', dot: true }, { beats: 2, type: 'whole' },
  ])('supports representable $beats-beat chords and matching remainders', ({ beats, type, dot }) => {
    const input = song(chord(2 * beats, type, dot ? '<dot/>' : ''), beats < 2 ? rest(4 - 2 * beats) : '');
    const output = editScoreSlot(input, '0:0:1', { action: 'duration', beats });
    expect(scoreAuthoringSlots(output).slice(0, 4).map(s => s.beats)).toEqual([beats, beats, beats, beats]);
    fixedTimeline(input, output);
  });

  it('preserves each tone’s existing type and retained dot attributes, then removes dots as a group', () => {
    const input = song(chord(1.5, 'quarter', '<dot relative-y="2"/>'), rest(2.5));
    const shorter = editScoreSlot(input, '0:0:2', { action: 'duration', beats: .75 });
    for (const node of nodes(shorter).slice(0, 3)) {
      expect(serialize(node)).toContain('<type size="full">eighth</type><dot relative-y="2"/>');
    }
    // Consume precisely the newly split rest. No other rest is merged or moved.
    const restored = editScoreSlot(shorter, '0:0:0', { action: 'duration', beats: 1.5 });
    expect(music(restored)).toEqual(music(input));
    expect(nodes(restored).map(serialize)).toEqual(nodes(input).map(serialize));
    const undotted = editScoreSlot(input, '0:0:1', { action: 'duration', beats: 1 });
    expect(nodes(undotted).slice(0, 3).every(n => !n.getElementsByTagName('dot').length)).toBe(true);
    fixedTimeline(input, shorter); fixedTimeline(input, restored); fixedTimeline(input, undotted);
  });

  it('adds unpositioned dots while keeping each tone’s original positions and missing-type ordering', () => {
    const input = song(chord().replaceAll('<type size="full">quarter</type>', ''));
    const output = editScoreSlot(input, '0:0:1', { action: 'duration', beats: .75 });
    for (const node of nodes(output).slice(0, 3)) {
      const dot = node.getElementsByTagName('dot')[0];
      expect(dot.attributes.length).toBe(0);
      expect(serialize(node)).toContain('<type>eighth</type><dot/>');
      const names = children(node).map(n => n.localName);
      expect(names.indexOf('type')).toBeLessThan(names.indexOf('stem'));
    }
    expect(nodes(output).slice(0, 3).map(toneDetails)).toEqual(nodes(input).slice(0, 3).map(toneDetails));
    fixedTimeline(input, output);
  });

  it.each(['plain', 'default', 'prefixed'])('round trips %s namespaces, provenance, project and repeated structural edits', namespace => {
    let raw = wrap(chord());
    if (namespace === 'default') raw = raw.replace('<score-partwise ', '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" ');
    if (namespace === 'prefixed') raw = raw.replace(/<(\/?)([\w-]+)/g, '<$1m:$2').replace('<m:score-partwise ', '<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml" ');
    const input: Song = { ...parseMusicXml(raw).song, folderSource: { folderId: 'folder', name: 'exercise.musicxml', digest: 'a'.repeat(64) } };
    const output = editScoreSlot(input, '0:0:1', { action: 'duration', beats: .5 });
    const restored = parseProject(JSON.stringify({ version: 1, song: output }));
    expect(restored).toEqual(output);
    expect(output.id).toBe(input.id); expect(output.title).toBe(input.title);
    expect(output.folderSource).toEqual(input.folderSource); expect(output.folderSource).not.toBe(input.folderSource);
    expect(output.scoreXml).toContain('Original test fixture');
    const filled = editScoreSlot(restored, '0:0:3', { action: 'insert', pitch: 72, beats: .5 });
    expect(filled.notes.find(n => n.pitch === 72)).toMatchObject({ start: .25, duration: .25 });
    // Deleting the leader still promotes its follower; a subsequent resize
    // applies to the smaller chord and not the unrelated newly inserted note.
    const removed = editScoreSlot(filled, '0:0:0', { action: 'delete' });
    const final = editScoreSlot(removed, '0:0:1', { action: 'duration', beats: .25 });
    expect(chordNotes(final).map(n => [n.pitch, n.duration, n.finger])).toEqual([[65, .125, 2], [68, .125, 3]]);
    expect(final.notes.find(n => n.pitch === 72)).toMatchObject({ start: .25, duration: .25 });
    expect(final.notes.find(n => n.pitch === 48)).toMatchObject({ start: 0, duration: 3, hand: 'left' });
    expect(final.duration).toBe(input.duration);
    expect(music(parseMusicXml(final.scoreXml!).song)).toEqual(music(final));
  });

  it('preserves a later voice, an independent part, pickup and final extent', () => {
    const part2 = '<part id="Q"><measure number="0" implicit="yes"><attributes><divisions>16</divisions></attributes>' + tone('E', 0, 0) + '</measure><measure number="1">' + tone('G', 0, 0) + '</measure></part>';
    const raw = wrap(chord(), '').replace('<direction><offset>-32</offset><sound tempo="60"/></direction>', '').replace('<backup><duration>64</duration></backup>', '<backup><duration>16</duration></backup>').replace(lower, lower.replace('<duration>64', '<duration>16')).replace('</score-partwise>', part2 + '</score-partwise>');
    const input = parseMusicXml(raw).song;
    const output = editScoreSlot(input, '0:0:2', { action: 'duration', beats: .5 });
    expect(output.notes.filter(n => n.sourceNoteIds?.some(id => id.startsWith('1:')))).toEqual(input.notes.filter(n => n.sourceNoteIds?.some(id => id.startsWith('1:'))));
    expect(parseMusicXml(output.scoreXml!).scoreTimeline.measures).toEqual(parseMusicXml(input.scoreXml!).scoreTimeline.measures);
    expect(output.notes.find(n => n.pitch === 71)?.start).toBe(.5);
    const lastChord = editScoreSlot(output, '0:1:0', { action: 'addChordTone', pitch: 74 });
    const shortened = editScoreSlot(lastChord, '0:1:1', { action: 'duration', beats: 2 });
    expect(shortened.duration).toBe(input.duration);
    expect(scoreAuthoringSlots(shortened).filter(s => s.sourceId.startsWith('0:1:')).map(s => s.beats)).toEqual([2, 2, 2]);
  });
});

describe('chord duration safety boundaries', () => {
  it.each([NaN, Infinity, 0, -1, 1 / 3, .01, 1.25, 8, .0625])('rejects unrepresentable duration/remainder/precision or excess capacity: %s', beats => {
    // Divisions 4 makes a 64th note unavailable, even though the notation exists.
    const input = parseMusicXml(wrap(chord()).replaceAll('<divisions>16', '<divisions>4').replaceAll('<duration>16', '<duration>4').replaceAll('<duration>48', '<duration>12').replaceAll('<duration>64', '<duration>16').replaceAll('<offset>-32', '<offset>-8')).song;
    const snapshot = JSON.stringify(input);
    expect(() => editScoreSlot(input, '0:0:1', { action: 'duration', beats })).toThrow();
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it.each([
    rest().replace('<voice>1', '<voice>2'), rest().replace('<staff>1', '<staff>2'),
    '<direction><sound tempo="100"/></direction>' + rest(),
    '<attributes><divisions>16</divisions></attributes>' + rest(),
    '<forward><duration>4</duration></forward>' + rest(),
    '<backup><duration>4</duration></backup>' + rest(3.25),
    tone('B', 0, 0, 3, 'half'),
    rest().replace('</note>', '<beam>begin</beam></note>'),
    rest().replace('<note ', '<note print-object="no" '),
  ])('does not borrow unavailable or unsupported silence (%#)', after => {
    const input = song(chord(), after), snapshot = JSON.stringify(input);
    for (const index of [0, 1, 2]) expect(() => editScoreSlot(input, `0:0:${index}`, { action: 'duration', beats: 2 })).toThrow(/immediately following/);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('does not cross the barline or combine multiple following rests to gain capacity', () => {
    const input = song(chord(), rest(.5) + rest(2.5)), snapshot = JSON.stringify(input);
    expect(() => editScoreSlot(input, '0:0:2', { action: 'duration', beats: 2 })).toThrow(/exceeds/);
    expect(() => editScoreSlot(input, '0:1:0', { action: 'duration', beats: 6 })).toThrow(/immediately following/);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('rejects stale or missing mappings on any tone, not only the selected leader', () => {
    const input = song();
    for (const patch of [{ sourceNoteIds: [] }, { sourceNoteIds: ['0:0:0'] }, { sourceNoteIds: ['0:0:1', '0:0:2'] }, { pitch: 62 }, { finger: 5 }, { start: .1 }, { duration: 1 }, { velocity: .2 }, { hand: 'left' as const }]) {
      const stale = { ...input, notes: input.notes.map(n => n.sourceNoteIds?.includes('0:0:2') ? { ...n, ...patch } : n) };
      const snapshot = JSON.stringify(stale);
      expect(() => editScoreSlot(stale, '0:0:0', { action: 'duration', beats: .5 })).toThrow(/out of date/);
      expect(JSON.stringify(stale)).toBe(snapshot);
    }
    expect(() => editScoreSlot(input, '9:0:0', { action: 'duration', beats: .5 })).toThrow(/existing/);
  });

  it.each([
    chord().replace('<stem default-y="-10">up</stem>', '<stem>up</stem><beam>begin</beam>'),
    chord().replace('<fingering substitution="no">1</fingering>', '<fingering><slur/></fingering>'),
    chord().replace('<chord/>', '<chord custom="yes"/>'),
    chord().replace('<chord/>', '<ext:chord xmlns:ext="urn:extension"/>'),
    chord().replace('<chord/>', '<chord/><cue/>'),
    chord().replace('<chord/>', '<chord/><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'),
    chord().replace('<note default-x="20"', '<note print-object="no" default-x="20"'),
  ])('keeps unsupported content blocked on the entire chord (%#)', body => {
    const input = song(body), snapshot = JSON.stringify(input);
    for (const index of [0, 1, 2]) expect(() => editScoreSlot(input, `0:0:${index}`, { action: 'duration', beats: .5 })).toThrow(/not supported/);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('does not permit tied chord tones or perturb a preceding grace note', () => {
    const tied = chord().replaceAll('</duration>', '</duration><tie type="start"/>');
    const stops = chord().replaceAll('</duration>', '</duration><tie type="stop"/>');
    const input = song(tied + stops, rest(2));
    expect(() => editScoreSlot(input, '0:0:1', { action: 'duration', beats: .5 })).toThrow(/not supported/);
    const grace = '<note><grace/><pitch><step>C</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>';
    const withGrace = song(tone('B', 0, 0) + grace + chord(), rest(2)), snapshot = JSON.stringify(withGrace);
    expect(() => editScoreSlot(withGrace, '0:0:1', { action: 'duration', beats: .5 })).toThrow(/not supported/);
    const output = editScoreSlot(withGrace, '0:0:2', { action: 'duration', beats: .5 });
    expect(output.notes.find(n => n.pitch === 60)).toEqual(withGrace.notes.find(n => n.pitch === 60));
    expect(output.notes.filter(n => [61, 65, 68].includes(n.pitch)).map(n => n.duration)).toEqual([.25, .25, .25]);
    expect(parseMusicXml(output.scoreXml!).scoreTimeline.measures).toEqual(parseMusicXml(withGrace.scoreXml!).scoreTimeline.measures);
    expect(JSON.stringify(withGrace)).toBe(snapshot);
  });
});
