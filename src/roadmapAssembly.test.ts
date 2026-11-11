import { afterEach, expect, it, vi } from "vitest";
import { exportMidi, parseMidi, songDuration, type Song } from "./music";
import { parseMusicXml } from "./musicxml";
import { editScoreSlot } from "./musicxmlAuthoring";
import { parseProject } from "./project";
import { trimScoreMeasures } from "./scoreEditing";
import { scoreTempoMap } from "./scoreTempo";
import { songTempoMap } from "./songTempo";
import { PracticeSession } from "./session";
import { SongLibrary } from "./songLibrary";

// Purpose-written integration fixture: the first tempo change lies inside
// the chord when it is lengthened, and later measures retain their timing.
const tone = (step: string, chord = false) => `<note>${chord ? "<chord/>" : ""}<pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`;
const source = `<score-partwise><work><work-title>Assembly exercise</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>${tone("C")}${tone("E", true)}${tone("G", true)}<note><rest/><duration>12</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note><direction><offset>-8</offset><sound tempo="60"/></direction></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note></measure><measure number="3"><direction><sound tempo="90"/></direction><note><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note></measure></part></score-partwise>`;
const map = [
  { beat: 0, seconds: 0, bpm: 120 },
  { beat: 2, seconds: 1, bpm: 60 },
  { beat: 8, seconds: 7, bpm: 90 },
];
const roundTrip = (song: Song) => parseProject(JSON.stringify({ version: 1, song }));

afterEach(() => vi.restoreAllMocks());

it.each([
  ["0:0:0", .5], ["0:0:1", .5], ["0:0:2", .5],
  ["0:0:0", 3], ["0:0:1", 3], ["0:0:2", 3],
] as const)("keeps source tempo and metronome aligned after resizing chord tone %s to %s beats", (sourceId, beats) => {
  const original = parseMusicXml(source).song, before = JSON.stringify(original);
  const edited = editScoreSlot(original, sourceId, { action: "duration", beats });
  const restored = roundTrip(edited);
  expect(restored).toEqual(edited);
  expect(edited.id).toBe(original.id);
  expect(scoreTempoMap(original)).toEqual(map);
  expect(scoreTempoMap(restored)).toEqual(map);
  expect(restored.notes.filter(n => n.start === 0).map(n => n.duration))
    .toEqual(Array(3).fill(beats === .5 ? .25 : 2));
  expect(restored.notes.filter(n => n.start > 0)).toEqual(original.notes.filter(n => n.start > 0));
  expect(songDuration(restored)).toBe(songDuration(original));
  expect(restored).not.toHaveProperty("midiTempoMap");
  const session = new PracticeSession({ notes: restored.notes, duration: songDuration(restored),
    tempo: restored.tempo, tempoMap: scoreTempoMap(restored), hand: "both", mode: "listen",
    countIn: false, metronome: true });
  session.start();
  for (const [delta, click] of [[0, true], [.5, true], [.5, true], [.5, false], [.5, true]] as const)
    expect(session.advance(delta, 100, false).metronomeBeat).toBe(click);
  expect(JSON.stringify(original)).toBe(before);
});

it.each(["T".repeat(490), "T".repeat(491), "𝄞".repeat(249) + "終章"])(
  "retains edited source timing and distinct recoverable passage identities at the title boundary (%#)", async title => {
    const original = { ...parseMusicXml(source).song, title,
      folderSource: { folderId: "assembly-folder", name: "assembly.musicxml", digest: "b".repeat(64) } };
    const before = JSON.stringify(original);
    const edited = editScoreSlot(original, "0:0:1", { action: "duration", beats: 3 });
    const passage = trimScoreMeasures(edited, 0, 1);
    const shorter = trimScoreMeasures(passage, 0, 0);
    expect(new Set([original.id, passage.id, shorter.id]).size).toBe(3);
    expect(edited.id).toBe(original.id);
    expect(passage.title).toBe(title.length === 490 ? title + " · passage" : title);
    expect(shorter.title).toBe(passage.title);
    let bytes = JSON.stringify([original]);
    const library = new SongLibrary(() => ({ getItem: () => bytes, setItem: (_key, value) => { bytes = value; } }));
    for (const song of [passage, shorter]) {
      const restored = roundTrip(song);
      expect(restored).toEqual(song);
      expect(restored.title.length).toBeLessThanOrEqual(500);
      expect(restored.folderSource).toEqual(original.folderSource);
      expect(scoreTempoMap(restored)).toEqual(map.slice(0, 2));
      expect(restored.notes.filter(n => n.start === 0).map(n => n.duration)).toEqual([2, 2, 2]);
      expect(await library.save(restored, null)).toMatchObject({ ok: true });
    }
    const reloaded = new SongLibrary(() => ({ getItem: () => bytes, setItem() {} })).getSnapshot();
    expect(reloaded.blocked).toBe(false);
    expect(reloaded.songs).toHaveLength(3);
    expect(reloaded.songs.find(song => song.id === original.id)).toEqual(original);
    for (const song of reloaded.songs.filter(song => song.id !== original.id))
      expect(scoreTempoMap(song)).toEqual(map.slice(0, 2));
    expect(JSON.stringify(original)).toBe(before);
  },
);

it("keeps same-tick passage copies distinct through legacy MIDI export, retained-map import and guarded re-export", () => {
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  const original = { ...parseMusicXml(source).song, title: "T".repeat(500) };
  const passage = trimScoreMeasures(editScoreSlot(original, "0:0:2", { action: "duration", beats: 3 }), 0, 1);
  const before = JSON.stringify(passage), midi = new Uint8Array(exportMidi(passage)).buffer;
  const first = roundTrip(parseMidi(midi)), second = roundTrip(parseMidi(midi));
  expect(new Set([original.id, passage.id, first.id, second.id]).size).toBe(4);
  expect({ ...first, id: second.id }).toEqual(second);
  expect(first.title).toBe(passage.title);
  expect(scoreTempoMap(first)).toBeUndefined();
  expect(scoreTempoMap(second)).toBeUndefined();
  // MusicXML uses its source map at runtime, but this map-less MIDI exporter
  // writes only the starting BPM. Import retains that actual single tempo;
  // it cannot reconstruct the source's omitted later change.
  expect(passage).not.toHaveProperty("midiTempoMap");
  expect(first.midiTempoMap).toEqual([{ seconds: 0, microsecondsPerQuarter: 500000 }]);
  expect(songTempoMap(first)).toEqual([{ beat: 0, seconds: 0, bpm: 120 }]);
  const { midiTempoMap: _map, ...legacyProject } = first;
  const legacy = roundTrip(legacyProject);
  expect(legacy).not.toHaveProperty("midiTempoMap");
  expect(songTempoMap(legacy)).toBeUndefined();
  // The newly imported copy selects guarded mapped export on its next save.
  const reexported = roundTrip(parseMidi(new Uint8Array(exportMidi(first)).buffer));
  expect(reexported.id).not.toBe(first.id);
  expect(reexported.title).toBe(first.title);
  expect(reexported.midiTempoMap).toEqual(first.midiTempoMap);
  expect(songTempoMap(reexported)).toEqual(songTempoMap(first));
  expect(reexported.notes.map(n => [n.pitch, n.start, n.duration, n.hand]))
    .toEqual(first.notes.map(n => [n.pitch, n.start, n.duration, n.hand]));
  expect(songDuration(reexported)).toBe(songDuration(first));
  expect(scoreTempoMap(passage)).toEqual(map.slice(0, 2));
  expect(JSON.stringify(passage)).toBe(before);
});
