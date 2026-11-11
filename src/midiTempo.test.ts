import { describe, expect, it } from "vitest";
import { exportMidi, parseMidi, songDuration, transposeSong, trimSong, type Song } from "./music";
import { MAX_MIDI_TEMPO_CHANGES, midiTempoSegments, normalizeMidiTempoMap } from "./midiTempo";
import { normalizeSong, parseProject } from "./project";
import { serializeProject } from "./projectFormat";
import { deleteNote, editNote, insertNote } from "./noteAuthoring";
import { songTempoMap } from "./songTempo";
import { parseMusicXml } from "./musicxml";

function vlq(value: number) {
  const result = [value & 127];
  while ((value = Math.floor(value / 128))) result.unshift((value & 127) | 128);
  return result;
}
const tempo = (delta: number, us: number) => [...vlq(delta), 255, 81, 3, us >> 16, (us >> 8) & 255, us & 255];
function midi(tracks: number[][], division = 480) {
  let data = [77,84,104,100,0,0,0,6,0,tracks.length > 1 ? 1 : 0,0,tracks.length,division >> 8,division & 255];
  for (const t of tracks) data = data.concat([77,84,114,107,(t.length >>> 24) & 255,(t.length >>> 16) & 255,(t.length >>> 8) & 255,t.length & 255], t);
  return new Uint8Array(data).buffer;
}
const sourceMidi = () => midi([
  [...tempo(0, 500000), ...tempo(120, 1000000), ...tempo(360, 250000), ...vlq(480),255,47,0],
  [0,176,64,127,0,144,60,100, ...vlq(240),128,60,0, ...vlq(480),176,64,0, ...vlq(240),255,47,0],
]);
const changes = [
  { seconds: 0, microsecondsPerQuarter: 500000 },
  { seconds: .125, microsecondsPerQuarter: 1000000 },
  { seconds: .875, microsecondsPerQuarter: 250000 },
];

describe("retained MIDI tempo", () => {
  it("retains a cross-track fractional tempo map without changing sustain, note seconds or final silence", () => {
    const song = parseMidi(sourceMidi());
    expect(song.midiTempoMap).toEqual(changes);
    expect(song.notes[0]).toMatchObject({ start: 0, duration: 1, pitch: 60, velocity: 100 / 127 });
    expect(songDuration(song)).toBe(1.125);
    expect(midiTempoSegments(song)).toEqual([
      { seconds: 0, beat: 0, bpm: 120 }, { seconds: .125, beat: .25, bpm: 60 }, { seconds: .875, beat: 1, bpm: 240 },
    ]);
    expect(parseProject(serializeProject(song))).toEqual(song);
  });

  it("retains the specified default before a delayed first tempo and for a constant import", () => {
    const buffer = midi([[0,144,60,100, ...tempo(480, 1000000), ...vlq(480),128,60,0,0,255,47,0]]);
    expect(parseMidi(buffer)).toMatchObject({ tempo: 120, duration: 1.5, midiTempoMap: [changes[0], { seconds: .5, microsecondsPerQuarter: 1000000 }] });
    expect(parseMidi(midi([[0,144,60,100, ...vlq(480),128,60,0,0,255,47,0]])).midiTempoMap).toEqual([changes[0]]);
  });

  it("uses deterministic last-event-wins across tracks and coalesces same-tick/redundant changes", () => {
    const parsed = parseMidi(midi([
      [...tempo(0, 1000000), ...tempo(480, 250000),0,255,47,0],
      [...tempo(0, 500000),0,144,60,100, ...tempo(480, 1000000), ...tempo(0, 500000), ...tempo(0, 500000), ...vlq(480),128,60,0,0,255,47,0],
    ]));
    expect(parsed.tempo).toBe(120); expect(parsed.midiTempoMap).toEqual([changes[0]]);
    expect(parsed.notes[0].duration).toBe(1);
  });

  it("preserves terminal tempo metadata at the explicit duration", () => {
    const song = parseMidi(midi([[0,144,60,100, ...vlq(480),128,60,0,...tempo(480, 1000000),0,255,47,0]]));
    expect(song.duration).toBe(1);
    expect(song.midiTempoMap).toEqual([changes[0], { seconds: 1, microsecondsPerQuarter: 1000000 }]);
    expect(trimSong(song, 0, 1).midiTempoMap).toEqual([changes[0]]);
  });

  it("keeps MIDI export byte-identical to legacy flattening and note seconds within tick resolution", () => {
    const song = parseMidi(sourceMidi()), { midiTempoMap: _map, ...legacy } = song;
    expect(exportMidi(song)).toEqual(exportMidi(legacy));
    const restored = parseMidi(exportMidi(song).buffer as ArrayBuffer);
    expect(restored.midiTempoMap).toEqual([changes[0]]);
    expect(restored.duration).toBeCloseTo(song.duration!, 3);
    restored.notes.forEach((n, i) => {
      expect(n.start).toBeCloseTo(song.notes[i].start, 3);
      expect(n.duration).toBeCloseTo(song.notes[i].duration, 3);
      expect(n.pitch).toBe(song.notes[i].pitch); expect(n.hand).toBe(song.notes[i].hand);
      expect(n.velocity).toBeCloseTo(song.notes[i].velocity, 2);
    });
  });

  it("bounds imported map count after same-tick coalescing, without rejecting overwritten extra changes", () => {
    const track = [0,144,60,100];
    for (let i = 1; i < MAX_MIDI_TEMPO_CHANGES; i++) track.push(...tempo(1, i % 2 ? 1000000 : 500000));
    const allowed = [...track, ...tempo(1, 500000), ...tempo(0, 1000000), 1,128,60,0,0,255,47,0];
    expect(parseMidi(midi([allowed])).midiTempoMap).toHaveLength(MAX_MIDI_TEMPO_CHANGES);
    expect(() => parseMidi(midi([[...track, ...tempo(1, 500000), 1,128,60,0,0,255,47,0]]))).toThrow(/10,000/);
  });

  it.each([1, 5999])("rejects unsupported imported tempo %i rather than losing it", us => {
    expect(() => parseMidi(midi([[0,144,60,100, ...tempo(1, us),1,128,60,0,0,255,47,0]]))).toThrow(/10,000 BPM/);
  });
  it("rejects maps beyond the existing 24-hour song bound", () => {
    expect(() => parseMidi(midi([[0,144,60,100,...vlq(0x0fffffff),128,60,0,0,255,47,0]], 1))).toThrow(/24 hours/);
  });
  it("rejects a bounded MIDI whose new mapped project would exceed the backup import limit", () => {
    const track: number[] = [];
    for (let i = 0; i < 90000; i++) track.push(0,144,60,100,1,128,60,0);
    track.push(0,255,47,0);
    const buffer = midi([track]);
    expect(buffer.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(() => parseMidi(buffer)).toThrow(/10 MiB import limit/);
  });
});

describe("optional metadata validation and editing", () => {
  const song = (): Song => ({ id: "mapped", title: "Synthetic", tempo: 120, duration: 4, midiTempoMap: changes,
    notes: [{ id: "n", pitch: 60, start: 0, duration: 2, velocity: .8, hand: "right", finger: 3 }],
    scoreXml: "<score-partwise/>", folderSource: { folderId: "folder", name: "song.mid", digest: "a".repeat(64) } });

  it.each([null, {}, [], [null], [[0, 500000]], [{ seconds: 0, microsecondsPerQuarter: "500000" }],
    [{ seconds: NaN, microsecondsPerQuarter: 500000 }], [{ seconds: Infinity, microsecondsPerQuarter: 500000 }],
    [{ seconds: -1, microsecondsPerQuarter: 500000 }], [{ seconds: .1, microsecondsPerQuarter: 500000 }],
    [{ seconds: 0, microsecondsPerQuarter: 5999 }], [{ seconds: 0, microsecondsPerQuarter: 0x1000000 }],
    [{ seconds: 0, microsecondsPerQuarter: 500000.5 }], [{ seconds: 0, microsecondsPerQuarter: Infinity }],
    [changes[0], { seconds: 0, microsecondsPerQuarter: 1000000 }],
    [changes[0], changes[2], changes[1]], [changes[0], { ...changes[1], seconds: 4.1 }],
    [changes[0], { ...changes[0], seconds: 1 }], Array(MAX_MIDI_TEMPO_CHANGES + 1).fill(changes[0]),
  ].map(midiTempoMap => ({ midiTempoMap })))("rejects malformed or noncanonical map %#", ({ midiTempoMap }) => {
    expect(() => normalizeSong({ ...song(), midiTempoMap })).toThrow(/MIDI tempo map/);
  });
  it.each([{ duration: undefined }, { duration: NaN }, { duration: -1 }, { duration: 86401 }, { tempo: 60 }, { scoreOrigin: "musicxml" }])("rejects inconsistent mapped song %#", patch => {
    expect(() => normalizeSong({ ...song(), ...patch })).toThrow();
  });

  it("clones allowed fields and validates supported tempo endpoints", () => {
    const source = song(), normalized = normalizeSong(source);
    expect(normalized).toEqual(source); expect(normalized.midiTempoMap).not.toBe(source.midiTempoMap);
    expect(normalized.midiTempoMap![0]).not.toBe(source.midiTempoMap![0]);
    for (const us of [6000, 0xffffff]) expect(normalizeMidiTempoMap([{ seconds: 0, microsecondsPerQuarter: us, extra: true }], 60000000 / us, 0))
      .toEqual([{ seconds: 0, microsecondsPerQuarter: us }]);
  });

  it.each([
    [0, .125, 120, [changes[0]]],
    [.125, .875, 60, [{ seconds: 0, microsecondsPerQuarter: 1000000 }]],
    [.5, 1, 60, [{ seconds: 0, microsecondsPerQuarter: 1000000 }, { seconds: .375, microsecondsPerQuarter: 250000 }]],
    [2, 4, 240, [{ seconds: 0, microsecondsPerQuarter: 250000 }]],
  ] as const)("rebases trim [%s, %s) including silence and exact boundaries", (start, end, bpm, map) => {
    const original = song(), before = JSON.stringify(original), result = trimSong(original, start, end);
    expect(result.tempo).toBe(bpm); expect(result.midiTempoMap).toEqual(map); expect(result.duration).toBe(end - start);
    expect(result.folderSource).toEqual(original.folderSource); expect(result.scoreXml).toBe(original.scoreXml);
    expect(normalizeSong(result)).toEqual(result); expect(JSON.stringify(original)).toBe(before);
    if (start === 2) expect(result.notes).toEqual([]);
  });

  it("preserves the timeline through transposition and note edits without shifting unrelated notes", () => {
    const original = song(), before = JSON.stringify(original);
    const inserted = insertNote(original, { pitch: 72, start: 4, duration: 1, hand: "left", finger: 5 });
    const retimed = editNote(inserted, "n", { start: .75, duration: .5, finger: 1 });
    const deleted = deleteNote(retimed, "n"), transposed = transposeSong(deleted, 1);
    for (const edited of [inserted, retimed, deleted, transposed]) {
      expect(edited.midiTempoMap).toEqual(changes); expect(edited.duration).toBe(5);
      expect(parseProject(serializeProject(edited))).toEqual(edited);
      expect(edited.scoreXml).toBe(original.scoreXml); expect(edited.folderSource).toEqual(original.folderSource);
    }
    expect(JSON.stringify(original)).toBe(before);
  });

  it("does not invent a map for legacy songs or an attached reference score", () => {
    const { midiTempoMap: _map, ...legacy } = song();
    for (const value of [legacy, normalizeSong(legacy), parseProject(serializeProject(legacy)), trimSong(legacy, .5, 1), transposeSong(legacy, 1)]) {
      expect(value).not.toHaveProperty("midiTempoMap"); expect(songTempoMap(value)).toBeUndefined();
    }
    expect(songTempoMap(song())).toEqual(midiTempoSegments(song()));
    expect(songTempoMap({ ...song(), midiTempoMap: [] })).toBeUndefined();
  });

  it("keeps MusicXML source authoritative and never falls back to MIDI metadata for blocked or stale source", () => {
    const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><sound tempo="60"/><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
    const source = parseMusicXml(xml).song;
    const mixed = { ...source, midiTempoMap: changes };
    expect(songTempoMap(mixed)).toEqual([{ beat: 0, seconds: 0, bpm: 60 }]);
    expect(() => normalizeSong(mixed)).toThrow(/source-linked MusicXML/);
    expect(songTempoMap({ ...mixed, duration: 5 })).toBeUndefined();
    expect(songTempoMap({ ...mixed, scoreXml: '<score-partwise><image source="https://example.invalid/x"/></score-partwise>' })).toBeUndefined();
    // A reference attachment with a conflicting valid tempo cannot replace MIDI timing.
    expect(songTempoMap({ ...song(), scoreXml: xml })).toEqual(midiTempoSegments(song()));
    expect(normalizeSong(source)).not.toHaveProperty("midiTempoMap");
  });
});
