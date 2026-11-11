import { expect, it } from "vitest";
import { parseMusicXml } from "./musicxml";
import { parseProject } from "./project";
import { trimScoreMeasures, transposeScore } from "./scoreEditing";
import { scoreTempoMap } from "./scoreTempo";
import { SongLibrary } from "./songLibrary";

const attrs = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>';
const note = (staff = 1) => `<note><pitch><step>C</step><octave>${staff === 1 ? 4 : 3}</octave></pitch><duration>16</duration><voice>${staff}</voice><staff>${staff}</staff></note>`;
const part = (body: string, id = "P1") => `<part id="${id}">${body}</part>`;
const score = (body: string) => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>${body}</score-partwise>`;
const xml = score(part(`<measure number="1">${attrs}<sound tempo="120"/><direction><offset>8</offset><sound tempo="60"><offset>4</offset></sound></direction>${note()}<backup><duration>16</duration></backup>${note(2)}</measure><measure number="2"><direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>${note()}</measure>`));

it("exposes quarter-note beat/second segments from actual numeric source tempo", () => {
  const parsed = parseMusicXml(xml);
  expect(parsed.tempoMap).toEqual([
    { beat: 0, seconds: 0, bpm: 120 },
    { beat: 1, seconds: .5, bpm: 60 },
    { beat: 4, seconds: 3.5, bpm: 180 },
  ]);
  expect(parsed.song.notes.slice(0, 2).map(n => n.duration)).toEqual([3.5, 3.5]);
  expect(scoreTempoMap(parsed.song)).toEqual(parsed.tempoMap);
  expect(parsed.song).not.toHaveProperty("tempoMap");
});

it("uses a shared map across parts, a source default, and duplicate matching tempo marks", () => {
  const both = score(part(`<measure>${attrs}<sound tempo="60"/>${note()}</measure>`)
    + part(`<measure>${attrs}<sound tempo="60"/>${note(2)}</measure>`, "P2"));
  expect(parseMusicXml(both).tempoMap).toEqual([{ beat: 0, seconds: 0, bpm: 60 }]);
  expect(parseMusicXml(score(part(`<measure>${attrs}${note()}</measure>`))).tempoMap)
    .toEqual([{ beat: 0, seconds: 0, bpm: 120 }]);
});

it("retains fractional source beats and ignores tempo marks beyond playback", () => {
  const fractional = score(part(`<measure>${attrs}<sound tempo="120"/><direction><offset>1</offset><sound tempo="60"/></direction><direction><offset>100</offset><sound tempo="90"/></direction>${note()}</measure>`));
  const parsed = parseMusicXml(fractional);
  expect(parsed.tempoMap[1]).toEqual({ beat: .25, seconds: .125, bpm: 60 });
  expect(scoreTempoMap(parsed.song)).toEqual(parsed.tempoMap.slice(0, 2));
});

it.each([
  { scoreOrigin: undefined },
  { scoreXml: undefined },
  { scoreXml: '<score-partwise/>' },
  { scoreXml: '<score-partwise><image source="https://example.invalid/private.png"/></score-partwise>' },
  { tempo: 40 },
  { duration: 100 },
])("leaves reference, missing, blocked and stale source inert: %j", patch => {
  const song = { ...parseMusicXml(xml).song, ...patch };
  const before = JSON.stringify(song);
  expect(scoreTempoMap(song)).toBeUndefined();
  expect(JSON.stringify(song)).toBe(before);
});

it("does not infer source tempo from changed note timing or lost source correspondence", () => {
  const song = parseMusicXml(xml).song;
  expect(scoreTempoMap({ ...song, notes: song.notes.map(n => ({ ...n, start: n.start + .1 })) })).toBeUndefined();
  expect(scoreTempoMap({ ...song, notes: song.notes.map(({ sourceNoteIds: _source, ...n }) => n) })).toBeUndefined();
  expect(scoreTempoMap({ id: "legacy", title: "MIDI", tempo: 60, notes: song.notes })).toBeUndefined();
});

it("rederives source tempo after legacy project/library backup round trips without rewriting schema", async () => {
  const song = parseMusicXml(xml).song;
  const backup = JSON.stringify({ version: 1, song });
  const restored = parseProject(backup);
  expect(scoreTempoMap(restored)).toEqual(scoreTempoMap(song));
  let stored = JSON.stringify([song]);
  const original = stored;
  const library = new SongLibrary(() => ({ getItem: () => stored, setItem: (_key, value) => { stored = value; } }));
  expect(scoreTempoMap(library.getSnapshot().songs[0])).toEqual(scoreTempoMap(song));
  expect(stored).toBe(original);
  expect(await library.save(restored, song)).toMatchObject({ ok: true });
  expect(JSON.parse(stored)[0]).not.toHaveProperty("tempoMap");
  expect(parseProject(backup).scoreXml).toBe(xml);
});

it("rederives trimmed measure tempo and preserves transposition, hands and source", () => {
  const song = parseMusicXml(xml).song, before = JSON.stringify(song);
  expect(scoreTempoMap(transposeScore(song, 1))).toEqual(scoreTempoMap(song));
  const passage = trimScoreMeasures(song, 1, 1);
  expect(passage.tempo).toBe(180);
  expect(scoreTempoMap(passage)).toEqual([{ beat: 0, seconds: 0, bpm: 180 }]);
  expect(JSON.stringify(song)).toBe(before);
});
