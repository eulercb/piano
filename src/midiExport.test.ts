import { describe, expect, it } from "vitest";
import { exportMidi, parseMidi, trimSong, type Note, type Song } from "./music";
import { normalizeSong, parseProject } from "./project";
import { serializeProject } from "./projectFormat";

const PPQN = 32767;
const note = (patch: Partial<Note> = {}): Note => ({ id: "n", pitch: 60, start: 0, duration: 1, velocity: .8, hand: "right", ...patch });
const song = (patch: Partial<Song> = {}): Song => ({ id: "mapped", title: "Synthetic étude", tempo: 120, duration: 3,
  midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: .123456789, microsecondsPerQuarter: 750001 }],
  notes: [note()], ...patch });
const read = (bytes: Uint8Array) => parseMidi(bytes.buffer as ArrayBuffer);
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
// Independently integrate the bytes using an integer BigInt numerator. This
// checks physical MIDI time as well as the production parser's floating clock.
function byteTimeline(bytes: Uint8Array) {
  const division = bytes[12] * 256 + bytes[13], timeline: number[] = [];
  let pos = 22, weighted = 0n, us = 500000;
  const variable = () => {
    let value = 0, byte: number;
    do { byte = bytes[pos++]; value = value * 128 + (byte & 127); } while (byte & 128);
    return value;
  };
  while (pos < bytes.length) {
    weighted += BigInt(variable()) * BigInt(us);
    const seconds = Number(weighted) / (division * 1000000), status = bytes[pos++];
    if (status === 255) {
      const type = bytes[pos++], length = variable();
      if (type === 81) { us = bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2]; timeline.push(seconds); }
      if (type === 47) timeline.push(seconds);
      pos += length;
    } else {
      expect([8, 9]).toContain(status >> 4); pos += 2; timeline.push(seconds);
    }
  }
  return timeline;
}
function roundTrip(source: Song) {
  const before = JSON.stringify(source), bytes = exportMidi(frozen(source)), restored = read(bytes);
  const halfTick = source.midiTempoMap![0].microsecondsPerQuarter / 480000000 / 2 + 1e-9;
  expect(JSON.stringify(source)).toBe(before);
  expect(bytes[12] * 256 + bytes[13]).toBe(PPQN);
  const targets = [...source.midiTempoMap!.map(entry => entry.seconds), ...source.notes.flatMap(value => [value.start, value.start + value.duration]), source.duration!].sort((a, b) => a - b);
  const physicalTimes = byteTimeline(bytes);
  expect(physicalTimes).toHaveLength(targets.length);
  physicalTimes.forEach((time, i) => expect(Math.abs(time - targets[i])).toBeLessThanOrEqual(halfTick));
  expect(restored.title).toBe(source.title);
  expect(restored.tempo).toBe(source.tempo);
  expect(restored.midiTempoMap).toHaveLength(source.midiTempoMap!.length);
  restored.midiTempoMap!.forEach((entry, i) => {
    expect(entry.microsecondsPerQuarter).toBe(source.midiTempoMap![i].microsecondsPerQuarter);
    expect(Math.abs(entry.seconds - source.midiTempoMap![i].seconds)).toBeLessThanOrEqual(halfTick);
    if (i) expect(entry.seconds).toBeGreaterThan(restored.midiTempoMap![i - 1].seconds);
  });
  expect(Math.abs(restored.duration! - source.duration!)).toBeLessThanOrEqual(halfTick);
  const originals = [...source.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  expect(restored.notes).toHaveLength(originals.length);
  restored.notes.forEach((value, i) => {
    const original = originals[i];
    expect(value.pitch).toBe(original.pitch); expect(value.hand).toBe(original.hand);
    expect(value.velocity).toBe(Math.max(1, Math.round(original.velocity * 127)) / 127);
    expect(Math.abs(value.start - original.start)).toBeLessThanOrEqual(halfTick);
    expect(Math.abs(value.start + value.duration - original.start - original.duration)).toBeLessThanOrEqual(halfTick);
    expect(Math.abs(value.duration - original.duration)).toBeLessThanOrEqual(2 * halfTick);
    expect(value).not.toHaveProperty("finger");
  });
  expect(parseProject(serializeProject(restored))).toEqual(restored);
  return restored;
}

describe("guarded MIDI tempo export", () => {
  it("leaves the legacy exporter byte-identical, including its PPQN and trailing silence", () => {
    const legacy: Song = { id: "legacy", title: "Legacy", tempo: 120, duration: 2,
      notes: [note({ hand: "left" })] };
    // Captured directly from the unchanged exporter at retention head 7a70995.
    expect([...exportMidi(legacy)].map(byte => byte.toString(16).padStart(2, "0")).join("")).toBe(
      "4d546864000000060000000101e04d54726b0000003900ff03064c656761637900ff01165069616e6f50726163746963653a48616e64733a763100ff510307a12000913c668740813c008740ff2f00");
    const short = read(exportMidi({ ...legacy, notes: [note({ start: .00052, duration: 1e-10 })] }));
    expect(short.notes).toHaveLength(1); expect(short.notes[0].duration).toBeCloseTo(1 / 960, 12);
  });

  it("preserves exact tempo values, held-note endpoints, both hands, chords and final silence", () => {
    const source = song({ duration: 4, notes: [note({ duration: 2.5, finger: 4, sourceNoteIds: ["original"] }),
      note({ id: "left", start: .2, pitch: 48, duration: 1.7, hand: "left", finger: 2 }),
      note({ id: "chord", start: .2, pitch: 67, duration: 1.7, velocity: 0 })],
    midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 500000 },
      { seconds: .123456789, microsecondsPerQuarter: 750001 },
      { seconds: 1.333333333, microsecondsPerQuarter: 333333 },
      { seconds: 4, microsecondsPerQuarter: 1000000 }],
    scoreXml: "<reference-score/>", folderSource: { folderId: "folder", name: "original.mid", digest: "a".repeat(64) } });
    const restored = roundTrip(source);
    expect(restored.midiTempoMap!.at(-1)!.seconds).toBe(restored.duration);
    expect(restored.notes[1].start).toBe(restored.notes[2].start);
    expect(restored.notes[1].start + restored.notes[1].duration).toBe(restored.notes[2].start + restored.notes[2].duration);
    expect(restored.duration! - Math.max(...restored.notes.map(n => n.start + n.duration))).toBeGreaterThan(1.49);
    expect(source.notes[0].sourceNoteIds).toEqual(["original"]);
    expect(source.notes[0].finger).toBe(4); expect(source.scoreXml).toBe("<reference-score/>");
  });

  it("keeps notes exactly on tempo boundaries together, including terminal releases and repeated pitches", () => {
    const source = song({ duration: 2, midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 500000 },
      { seconds: .123456789, microsecondsPerQuarter: 750000 }, { seconds: 2, microsecondsPerQuarter: 6000 }],
    notes: [note({ duration: .123456789 }), note({ id: "repeat", start: .123456789, duration: 2 - .123456789 }),
      note({ id: "left", hand: "left", start: .123456789, duration: 2 - .123456789 })] });
    const restored = roundTrip(source);
    expect(restored.notes[0].duration).toBe(restored.midiTempoMap![1].seconds);
    expect(restored.notes[1].start).toBe(restored.midiTempoMap![1].seconds);
    expect(restored.notes[2].start).toBe(restored.midiTempoMap![1].seconds);
    expect(restored.notes[1].start + restored.notes[1].duration).toBe(restored.duration);
  });

  it("round trips trimmed maps with inherited initial tempo and interior changes", () => {
    const source = song({ duration: 4, notes: [note({ duration: 3 })], midiTempoMap: [
      { seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: .5, microsecondsPerQuarter: 800000 },
      { seconds: 2, microsecondsPerQuarter: 350000 }, { seconds: 4, microsecondsPerQuarter: 6000 }] });
    const before = JSON.stringify(source), trimmed = trimSong(source, 1, 4);
    roundTrip(trimmed); expect(JSON.stringify(source)).toBe(before);
    expect(trimmed.midiTempoMap).toEqual([{ seconds: 0, microsecondsPerQuarter: 800000 }, { seconds: 1, microsecondsPerQuarter: 350000 }]);
  });

  it("compensates the accumulated drift of 10,000 fractional alternating tempo boundaries", () => {
    const map = [{ seconds: 0, microsecondsPerQuarter: 500000 }];
    let seconds = 0, floatTick = 0, us = 500000, naiveSeconds = 0, roundedTick = 0;
    for (let i = 1; i < 10000; i++) {
      const next = i * 10 + (i % 2 ? .49 : -.49);
      seconds += (next - floatTick) * us / (PPQN * 1000000);
      naiveSeconds += (Math.round(next) - roundedTick) * us / (PPQN * 1000000);
      floatTick = next; roundedTick = Math.round(next); us = i % 2 ? 1000000 : 500000;
      map.push({ seconds, microsecondsPerQuarter: us });
    }
    expect(naiveSeconds - seconds).toBeGreaterThan(.074);
    const source = song({ duration: seconds + .01, midiTempoMap: map, notes: [note({ duration: seconds + .005 }),
      note({ id: "late", pitch: 64, start: seconds - .01, duration: .015 })] });
    const restored = roundTrip(source);
    expect(Math.abs(restored.midiTempoMap!.at(-1)!.seconds - seconds)).toBeLessThan(.00002);
  });

  it("retains compatible overlapping same-pitch notes and rejects nested FIFO-incompatible voices", () => {
    roundTrip(song({ notes: [note({ duration: 1 }), note({ id: "overlap", start: .5, duration: 1 })] }));
    const nested = song({ notes: [note({ duration: 3 }), note({ id: "nested", start: 1, duration: 1 })] });
    const before = JSON.stringify(nested);
    expect(() => exportMidi(frozen(nested))).toThrow(/overlapping notes.*individual durations/);
    expect(JSON.stringify(nested)).toBe(before);
  });

  it("rejects impossible short slow-tempo notes after a fast initial tempo without altering the map", () => {
    const source = song({ tempo: 10000, midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 6000 },
      { seconds: 1, microsecondsPerQuarter: 0xffffff }], notes: [note({ start: 1.1, duration: .000256 })] });
    expect(normalizeSong(source)).toEqual(source);
    const before = JSON.stringify(source);
    expect(() => exportMidi(frozen(source))).toThrow(/resolution/);
    expect(JSON.stringify(source)).toBe(before);
    expect(parseProject(serializeProject(source))).toEqual(source);
  });

  it("rejects distinct tempo changes that collide rather than flattening or repairing them", () => {
    const source = song({ tempo: 10000, midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 6000 },
      { seconds: 1, microsecondsPerQuarter: 0xffffff }, { seconds: 1.000001, microsecondsPerQuarter: 6000 }] });
    expect(normalizeSong(source)).toEqual(source);
    expect(() => exportMidi(frozen(source))).toThrow(/tempo changes are too close/);
  });

  it("audits tempo-boundary seconds against initial resolution, not the much larger later tick", () => {
    const firstRealized = Math.round(PPQN / .006) * .006 / PPQN;
    const later = firstRealized + 100.25 * (0xffffff / 1000000 / PPQN);
    expect(() => exportMidi(song({ tempo: 10000, midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 6000 },
      { seconds: 1, microsecondsPerQuarter: 0xffffff }, { seconds: later, microsecondsPerQuarter: 6000 }],
      notes: [note({ duration: .5 })] }))).toThrow(/A tempo change cannot retain its seconds/);
  });

  it("refuses notes displaced across a tempo boundary instead of silently clamping their ticks", () => {
    const boundary = 10.51 * .5 / PPQN;
    expect(() => exportMidi(song({ midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 500000 },
      { seconds: boundary, microsecondsPerQuarter: 6000 }], notes: [note({ start: boundary + 1e-8 })] })))
      .toThrow(/too close to a tempo change/);
  });

  it("rejects new mapped zero-tick notes instead of invoking the legacy one-tick extension", () => {
    expect(() => exportMidi(song({ notes: [note({ duration: 1e-12 })] }))).toThrow(/shorter/);
  });

  it.each([null, [], [{ seconds: 0, microsecondsPerQuarter: 0 }],
    [{ seconds: 0, microsecondsPerQuarter: 500000.1 }], [{ seconds: 0, microsecondsPerQuarter: 0x1000000 }],
    [{ seconds: NaN, microsecondsPerQuarter: 500000 }], [{ seconds: Infinity, microsecondsPerQuarter: 500000 }],
    [{ seconds: .1, microsecondsPerQuarter: 500000 }],
    [{ seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: 0, microsecondsPerQuarter: 600000 }],
    [{ seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: 4, microsecondsPerQuarter: 600000 }],
  ])("rejects malformed map %# without a single-tempo fallback", midiTempoMap => {
    expect(() => exportMidi(song({ midiTempoMap: midiTempoMap as Song["midiTempoMap"] }))).toThrow(/MIDI tempo map/);
  });

  it.each([{ duration: undefined }, { duration: Infinity }, { duration: 86401 }, { tempo: 121 }, { scoreOrigin: "musicxml" as const }])
    ("rejects inconsistent mapped song %#", patch => expect(() => exportMidi(song(patch))).toThrow());
  it.each([{ start: -1 }, { start: Infinity }, { duration: 0 }, { duration: 4 }, { pitch: 128 },
    { velocity: NaN }, { velocity: -1 }, { velocity: 2 }, { hand: "other" }])
    ("rejects invalid note %#", patch => expect(() => exportMidi(song({ notes: [note(patch as Partial<Note>)] }))).toThrow(/invalid note/));

  it("checks total event count, including tempo and metadata events", () => {
    expect(() => exportMidi(song({ notes: Array.from({ length: 100000 }, (_, i) => note({ id: `n${i}` })) }))).toThrow(/200,000-event/);
  });
  it("rejects excessive same-pitch overlap before producing an unreadable file", () => {
    expect(() => exportMidi(song({ notes: Array.from({ length: 1025 }, (_, i) => note({ id: `n${i}` })) }))).toThrow(/too many notes overlap/);
  });
  it("rejects oversized event gaps at high PPQN without 32-bit truncation", () => {
    expect(() => exportMidi(song({ tempo: 10000, duration: 100,
      midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 6000 }], notes: [note({ start: 80 })] }))).toThrow(/event gap/);
  });
  it("rejects rounding beyond 24 hours even when the source duration is valid", () => {
    const us = 16000001, source = song({ tempo: 60000000 / us, duration: 86400,
      midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: us }], notes: [note({ start: 86399 })] });
    expect(normalizeSong(source)).toEqual(source);
    expect(() => exportMidi(source)).toThrow(/24-hour import limit/);
  });
  it("refuses an export whose quantized reimport would exceed the project backup size limit", () => {
    const source = song({ duration: 811, midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 500000 }],
      notes: Array.from({ length: 81000 }, (_, i) => note({ id: `n${i}`, start: i / 100, duration: .001 })) });
    expect(new TextEncoder().encode(serializeProject(source)).byteLength).toBeLessThan(10 * 1024 * 1024);
    expect(() => exportMidi(source)).toThrow(/10 MiB import limit/);
  });
  it("keeps intentionally empty passages recoverable as projects but refuses an unreadable MIDI", () => {
    const empty = song({ notes: [] });
    expect(() => exportMidi(empty)).toThrow(/playable notes/);
    expect(parseProject(serializeProject(empty))).toEqual(empty);
  });
});
