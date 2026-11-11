import { describe, expect, it } from "vitest";
import { exportMidi, parseMidi, songDuration, type Note, type Song } from "./music";
import { deleteNote, editNote, insertNote, NOTE_AUTHORING_LIMITS, noteAuthoringAvailability, type NoteInput, type NotePatch } from "./noteAuthoring";
import { parseProject } from "./project";

const note = (id = "original", start = 1, pitch = 60): Note => ({ id, start, pitch, duration: 0.5, velocity: 0.6, hand: "right", finger: 2 });
const song = (notes = [note()]): Song => ({ id: "song", title: "Synthetic study", tempo: 120, notes });
const input: NoteInput = { start: 2, pitch: 64, duration: 0.5, hand: "right" };

describe("safe Studio note authoring", () => {
  it("inserts chronological notes and deterministic collision-free IDs without changing originals", () => {
    const original = song([note("studio-note-1"), note("studio-note-3", 2)]);
    original.notes.forEach(Object.freeze); Object.freeze(original.notes); Object.freeze(original);
    const before = JSON.stringify(original);
    const next = insertNote(original, { ...input, start: 0.5, finger: 4, hand: "left" });
    expect(next.notes.map(note => note.id)).toEqual(["studio-note-2", "studio-note-1", "studio-note-3"]);
    expect(next.notes[0]).toMatchObject({ start: 0.5, pitch: 64, duration: 0.5, velocity: 0.72, hand: "left", finger: 4 });
    expect(insertNote(original, { ...input, start: 0.5, finger: 4, hand: "left" })).toEqual(next);
    expect(JSON.stringify(original)).toBe(before);
    expect(next.id).toBe(original.id);
    expect(next.title).toBe(original.title);
    expect(next).not.toBe(original);
  });

  it("edits pitch, time, duration, hand and fingering atomically and reorders by onset", () => {
    const original = song([note("a", 1), note("b", 2)]);
    const next = editNote(original, "a", { pitch: 48, start: 3, duration: 2, hand: "left", finger: 5, velocity: 0.3 });
    expect(next.notes.map(note => note.id)).toEqual(["b", "a"]);
    expect(next.notes[1]).toEqual({ id: "a", pitch: 48, start: 3, duration: 2, hand: "left", finger: 5, velocity: 0.3 });
    expect(original.notes[0]).toEqual(note("a", 1));
    expect(songDuration(next)).toBe(5);
  });

  it("can remove a fingering without changing any other field", () => {
    const original = song();
    const next = editNote(original, "original", { finger: undefined });
    expect(next.notes[0]).not.toHaveProperty("finger");
    expect(next.notes[0].duration).toBe(0.5);
    expect(original.notes[0].finger).toBe(2);
  });

  it("preserves saved trailing silence but extends explicit duration for new or longer notes", () => {
    const original = { ...song(), duration: 10 };
    expect(editNote(original, "original", { duration: 0.1 }).duration).toBe(10);
    expect(deleteNote(original, "original").duration).toBe(10);
    expect(insertNote(original, { ...input, start: 12, duration: 2 }).duration).toBe(14);
    expect(editNote(original, "original", { duration: 20 }).duration).toBe(21);
    expect(original.duration).toBe(10);
  });

  it("deletes only the requested note without shifting any other note and allows an empty song", () => {
    const original = song([note("a", 1), note("b", 4)]);
    const next = deleteNote(original, "a");
    expect(next.notes).toEqual([note("b", 4)]);
    expect(original.notes).toHaveLength(2);
    expect(deleteNote(next, "b").notes).toEqual([]);
    expect(songDuration(deleteNote(next, "b"))).toBe(0);
    expect(insertNote(song([]), input).notes).toHaveLength(1);
  });

  it("retains stable ordering for unison chords", () => {
    const original = song([note("z", 1), note("a", 1)]);
    const next = insertNote(original, { ...input, pitch: 60, start: 1 });
    expect(next.notes.map(note => note.id)).toEqual(["z", "a", "studio-note-1"]);
    expect(editNote(next, "z", { finger: 3 }).notes.map(note => note.id)).toEqual(["z", "a", "studio-note-1"]);
  });

  it("does not overwrite IDs or attach score mappings supplied in insertion data", () => {
    const next = insertNote(song(), { ...input, id: "original", sourceNoteIds: ["0:0:0"] } as NoteInput);
    expect(next.notes[1].id).toBe("studio-note-1");
    expect(next.notes[1]).not.toHaveProperty("sourceNoteIds");
    expect(() => editNote(song(), "original", { id: "replacement" } as NotePatch)).toThrow(/Only pitch/);
  });

  it("rejects missing or duplicate IDs rather than changing the wrong note", () => {
    expect(() => deleteNote(song(), "missing")).toThrow(/no longer exists/);
    expect(() => editNote(song(), "missing", { duration: 2 })).toThrow(/no longer exists/);
    expect(() => insertNote(song([note("same"), note("same")]), input)).toThrow(/unique/);
    expect(() => deleteNote(song([note("")]), "")).toThrow(/unique/);
  });

  it.each<NotePatch>([
    { pitch: -1 }, { pitch: 128 }, { pitch: 60.5 }, { pitch: NaN }, { pitch: Infinity },
    { start: -0.01 }, { start: Infinity }, { start: NaN }, { start: 86400 },
    { duration: 0 }, { duration: -1 }, { duration: Infinity }, { duration: NaN }, { duration: 86400 },
    { velocity: -0.01 }, { velocity: 1.01 }, { velocity: Infinity }, { velocity: NaN },
    { finger: 0 }, { finger: 6 }, { finger: 1.5 }, { finger: NaN }, { finger: Infinity },
    { hand: "both" as Note["hand"] }, { pitch: undefined }, { duration: undefined }, { start: undefined }, { hand: undefined },
  ])("rejects invalid patches atomically: %j", patch => {
    const original = song();
    const before = JSON.stringify(original);
    expect(() => editNote(original, "original", patch)).toThrow();
    expect(JSON.stringify(original)).toBe(before);
  });

  it.each<NoteInput>([
    { ...input, pitch: 200 }, { ...input, pitch: "60" as unknown as number },
    { ...input, start: -1 }, { ...input, duration: 0 }, { ...input, duration: Number.MAX_VALUE },
    { ...input, finger: 3.4 }, { ...input, hand: "none" as Note["hand"] }, { ...input, velocity: -1 },
  ])("rejects invalid insertions: %j", value => expect(() => insertNote(song(), value)).toThrow());

  it("accepts the full MIDI range and the exact 24-hour boundary", () => {
    expect(insertNote(song([]), { ...input, start: 0, duration: 86400, pitch: 0, velocity: 0 }).notes[0].pitch).toBe(0);
    expect(insertNote(song([]), { ...input, start: 86399.5, duration: 0.5, pitch: 127, finger: 5, velocity: 1 }).notes[0].pitch).toBe(127);
  });

  it("bounds note count to the project format maximum", () => {
    const original = song(Array.from({ length: NOTE_AUTHORING_LIMITS.maxNotes }, (_, i) => note(`n${i}`)));
    expect(() => insertNote(original, input)).toThrow(/at most 100,000/);
    expect(deleteNote(original, "n0").notes).toHaveLength(NOTE_AUTHORING_LIMITS.maxNotes - 1);
  });

  it("rejects invalid existing notes and duration metadata instead of saving corrupt edits", () => {
    expect(() => insertNote(song([{ ...note(), duration: NaN }]), input)).toThrow(/Duration/);
    for (const duration of [-1, Infinity, NaN, 86401]) {
      expect(() => editNote({ ...song(), duration }, "original", { pitch: 61 })).toThrow(/Song duration/);
    }
  });

  it("blocks every helper for source-linked MusicXML, including mappings without the origin flag", () => {
    for (const original of [
      { ...song(), scoreOrigin: "musicxml" as const, scoreXml: "<score-partwise/>" },
      song([{ ...note(), sourceNoteIds: ["0:0:0"] }]),
    ]) {
      expect(noteAuthoringAvailability(original)).toMatchObject({ allowed: false, reason: expect.stringContaining("MusicXML") });
      expect(() => insertNote(original, input)).toThrow(/score and playback together/);
      expect(() => editNote(original, "original", { duration: 2 })).toThrow(/MusicXML/);
      expect(() => deleteNote(original, "original")).toThrow(/MusicXML/);
    }
  });

  it("preserves legacy reference XML and warns that it is not changed", () => {
    const original = { ...song(), scoreXml: "<score-partwise/>" };
    expect(noteAuthoringAvailability(original)).toMatchObject({ allowed: true, warning: expect.stringContaining("reference only") });
    expect(insertNote(original, input).scoreXml).toBe(original.scoreXml);
    expect(editNote(original, "original", { duration: 2 }).scoreXml).toBe(original.scoreXml);
    expect(deleteNote(original, "original").scoreXml).toBe(original.scoreXml);
  });

  it("round-trips authored notes through project and MIDI exports", () => {
    const authored = insertNote(editNote(song(), "original", { duration: 1.5, hand: "left", finger: 4 }), { ...input, finger: 3 });
    const restored = parseProject(JSON.stringify({ version: 1, song: authored }));
    expect(restored).toEqual(authored);
    const midi = exportMidi(authored);
    const played = parseMidi(midi.buffer as ArrayBuffer);
    expect(played.notes.map(note => [note.pitch, note.hand])).toEqual([[60, "left"], [64, "right"]]);
    expect(played.notes[0].duration).toBeCloseTo(1.5, 3);
  });
});
