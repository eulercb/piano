import { expect, it } from 'vitest';
import { parseMusicXml } from './musicxml';
import { editScoreNote, trimScoreMeasures, transposeScore } from './scoreEditing';
import { normalizeSong, parseProject } from './project';
import { serializeProject } from './projectFormat';
const pitch = '<pitch><step>C</step><octave>4</octave></pitch>';
const xml = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note>${pitch}<duration>4</duration><tie type="start"/><type>whole</type><notations><tied type="start"/><technical><fingering>2</fingering></technical></notations></note></measure><measure number="2"><note>${pitch}<duration>4</duration><tie type="stop"/><type>whole</type><notations><tied type="stop"/></notations></note></measure></part></score-partwise>`;
it('retains a printed fingering when a trim starts inside a tie', () => {
 const source = parseMusicXml(xml).song;
 expect(source.notes[0].finger).toBe(2);
 expect(trimScoreMeasures(source, 1, 1).notes[0].finger).toBe(2);
});
it('retains a Studio fingering when a trim starts inside a tie', () => {
 const source = parseMusicXml(xml).song;
 const edited = editScoreNote(source, source.notes[0].id, { finger: 4 });
 expect(edited.notes[0].finger).toBe(4);
 expect(trimScoreMeasures(edited, 1, 1).notes[0].finger).toBe(4);
});

const finger = (value: string, attrs = '') => `<fingering${attrs}>${value}</fingering>`;
const mark = (value: string) => `<notations><technical>${value}</technical></notations>`;
const wrapper = (parts: string, namespace = '') => `<score-partwise${namespace}><part-list><score-part id="P"><part-name>Piano</part-name></score-part><score-part id="Q"><part-name>Piano 2</part-name></score-part></part-list>${parts}</score-partwise>`;
const attributes = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>';
const tie = (types: string[], marks = '', voice = '1', staff = 1, ending = '') => `<note>${pitch}<duration>4</duration>${types.map(type => `<tie type="${type}"/>`).join('')}<voice>${voice}</voice><type>whole</type><staff>${staff}</staff>${marks ? mark(marks) : ''}${ending}</note>`;
const part = (measures: string[], id = 'P') => `<part id="${id}">${measures.map((body, i) => `<measure number="${i + 1}">${i ? '' : attributes}${body}</measure>`).join('')}</part>`;
const chain = (marks: string[], namespace = '', ending = '') => parseMusicXml(wrapper(part(marks.map((mark, i) => tie(i === 0 ? ['start'] : i === marks.length - 1 ? ['stop'] : ['stop', 'start'], mark, '1', 1, ending))), namespace)).song;
const music = (song: ReturnType<typeof chain>) => song.notes.map(({ id: _id, sourceNoteIds: _ids, ...note }) => note);

it('preserves a transitive tie, both-hand timing, silence, tempo, provenance and export recovery', () => {
  const left = '<note><rest/><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff><notations><technical><fingering>5</fingering></technical></notations></note>';
  const input = wrapper(part([
    '<direction><sound tempo="120"/></direction>' + tie(['start'], finger('2')),
    '<direction><sound tempo="60"/></direction><direction><offset>2</offset><sound tempo="90"/></direction>' + tie(['stop', 'start']),
    tie(['stop']),
  ].map(body => body + '<backup><duration>4</duration></backup>' + left)));
  const original = { ...parseMusicXml(input).song, folderSource: { folderId: 'folder', name: 'original.musicxml', digest: 'a'.repeat(64) } };
  const before = JSON.stringify(original);
  const trimmed = trimScoreMeasures(original, 1, 2);
  expect(trimmed.notes.find(n => n.hand === 'right')).toMatchObject({ finger: 2, start: 0, sourceNoteIds: ['0:0:0', '0:1:0'] });
  const originalTimeline = parseMusicXml(input).scoreTimeline;
  const offset = originalTimeline.measures[1].start;
  expect(trimmed.notes.filter(n => n.hand === 'left').map(({ start, duration, finger }) => ({ start, duration, finger }))).toEqual(
    original.notes.filter(n => n.hand === 'left' && n.start >= offset).map(({ start, duration, finger }) => ({ start: start - offset, duration, finger })),
  );
  expect(trimmed.notes.find(n => n.hand === 'left')?.start).toBe(2);
  expect(trimmed.tempo).toBe(60);
  expect(trimmed.duration).toBeCloseTo(original.duration! - offset);
  expect(trimmed.notes.find(n => n.hand === 'right')?.duration).toBeCloseTo(trimmed.duration!);
  expect(trimmed.folderSource).toEqual(original.folderSource);
  expect(trimmed.id).not.toBe(original.id);
  expect(trimmed.scoreXml).toContain('tie type="start"');
  expect(trimmed.scoreXml).toContain('tie type="stop"');
  for (const recovered of [parseMusicXml(trimmed.scoreXml!).song, parseProject(serializeProject(trimmed)), normalizeSong(trimmed)]) {
    expect(music(recovered)).toEqual(music(trimmed));
    expect(recovered.duration).toBe(trimmed.duration);
  }
  const retrimmed = trimScoreMeasures(trimmed, 1, 1);
  expect(retrimmed.notes.find(n => n.hand === 'right')?.finger).toBe(2);
  expect(retrimmed.scoreXml).not.toContain('<tie ');
  expect(transposeScore(retrimmed, 2).notes.find(n => n.hand === 'right')).toMatchObject({ pitch: 62, finger: 2 });
  expect(JSON.stringify(original)).toBe(before);
});

it('keeps simultaneous unison chains distinct by part, voice and staff, ignoring stale playback mappings', () => {
  const backup = '<backup><duration>4</duration></backup>';
  const source = parseMusicXml(wrapper(
    part([
      tie(['start'], finger('1')) + backup + tie(['start'], finger('3'), '2') + backup + tie(['start'], finger('5'), '1', 2),
      tie(['stop']) + backup + tie(['stop'], '', '2') + backup + tie(['stop'], '', '1', 2),
    ]) + part([tie(['start'], finger('4')), tie(['stop'])], 'Q'),
  )).song;
  const stale = { ...source, notes: source.notes.map(n => ({ ...n, finger: 2, sourceNoteIds: ['0:0:0', '0:1:0'] })) };
  const result = trimScoreMeasures(stale, 1, 1);
  expect(result.notes.map(n => [n.sourceNoteIds, n.hand, n.finger])).toEqual([
    [['0:0:0'], 'right', 1], [['0:0:1'], 'right', 3], [['0:0:2'], 'left', 5], [['1:0:0'], 'right', 4],
  ]);
  expect(music(result)).toEqual(music(trimScoreMeasures(source, 1, 1)));
});

it.each([finger('4'), finger('1-2'), finger('3', ' alternate="yes"'), finger('2') + finger('4')])('keeps explicit continuation notation without replacing it: %s', existing => {
  const result = trimScoreMeasures(chain([finger('1'), existing]), 1, 1);
  expect(result.scoreXml).toContain(existing);
  expect(result.scoreXml?.match(/<fingering/g)).toHaveLength(existing.match(/<fingering/g)!.length);
  expect(result.scoreXml).not.toContain('<fingering>1</fingering>');
});

it('does not pull a later retained fingering backward to the new attack', () => {
  const result = trimScoreMeasures(chain(['', '', finger('5')]), 1, 2);
  const firstMeasure = result.scoreXml!.split('</measure>')[0];
  expect(firstMeasure).not.toContain('fingering');
  expect(result.scoreXml).toContain('<fingering>5</fingering>');
});

it('uses the latest unambiguous finger in the removed prefix without overwriting a later retained mark', () => {
  const result = trimScoreMeasures(chain([finger('1'), finger('3'), '', finger('5')]), 2, 3);
  expect(result.notes[0].finger).toBe(3);
  expect(result.scoreXml).toContain('<fingering>3</fingering>');
  expect(result.scoreXml).toContain('<fingering>5</fingering>');
});

it.each(['', '<string>4</string><fret>2</fret>', finger('1-2'), finger('2') + finger('4'), finger('3', ' alternate="yes"'), finger('3', ' substitution="yes"'), finger('3', ' alternate=" yes "'), finger('3', ' substitution=" yes "'), finger('3', ' alternate="unknown"'), finger('<other-technical>2</other-technical>'), '<other-technical><notations><technical><fingering>2</fingering></technical></notations></other-technical>', '<extra:fingering xmlns:extra="urn:extension">2</extra:fingering>'])('does not invent a finger or simplify unsupported removed marks: %s', unsupported => {
  const input = chain([unsupported, '']);
  const result = trimScoreMeasures(input, 1, 1);
  expect(result.notes[0].finger).toBeUndefined();
  expect(result.scoreXml).not.toContain('fingering');
});

it('does not fall back past a later ambiguous marking in the removed prefix', () => {
  expect(trimScoreMeasures(chain([finger('1'), finger('2-3'), '']), 2, 2).notes[0].finger).toBeUndefined();
});

it('inserts namespaced fingering notation before lyrics without copying old layout coordinates', () => {
  const result = trimScoreMeasures(chain([finger('2', ' default-x="30" default-y="12"'), ''], ' xmlns="http://www.musicxml.org/ns/musicxml"', '<lyric><text>Original study</text></lyric>'), 1, 1);
  expect(result.notes[0].finger).toBe(2);
  expect(result.scoreXml).toContain('<fingering>2</fingering>');
  expect(result.scoreXml).not.toContain('default-x');
  expect(result.scoreXml!.indexOf('<notations>')).toBeLessThan(result.scoreXml!.indexOf('<lyric>'));
  expect(parseProject(serializeProject(result)).notes).toEqual(result.notes);
});

it('does not add a redundant finger when trimming only the end of a tie', () => {
  const result = trimScoreMeasures(chain([finger('2'), '', '']), 0, 1);
  expect(result.notes[0].finger).toBe(2);
  expect(result.scoreXml?.match(/<fingering/g)).toHaveLength(1);
});


it.each(['<extra:notations xmlns:extra="urn:extension"/>', '<notations><extra:technical xmlns:extra="urn:extension"/></notations>'])('does not add fingering inside foreign destination containers: %s', extension => {
  const source = chain([finger('2'), '']);
  const withExtension = parseMusicXml(source.scoreXml!.replace('</staff></note></measure></part>', `</staff>${extension}</note></measure></part>`)).song;
  const result = trimScoreMeasures(withExtension, 1, 1);
  expect(result.notes[0].finger).toBe(2);
  expect(result.scoreXml).toContain(extension.match(/<extra:[^>]*\/>/)![0]);
  expect(result.scoreXml).toContain('<technical><fingering>2</fingering></technical>');
});


it('accepts explicit no contextual flags without copying them or their layout', () => {
  const result = trimScoreMeasures(chain([finger('2', ' alternate=" no " substitution="no"'), '']), 1, 1);
  expect(result.notes[0].finger).toBe(2);
  expect(result.scoreXml).toContain('<fingering>2</fingering>');
});
