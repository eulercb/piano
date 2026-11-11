import { expect, it } from "vitest";
import { normalizeSong, parseProject } from "./project";
import { MAX_PROJECT_BYTES, serializeProject } from "./projectFormat";
import { SongLibrary, SONGS_KEY } from "./songLibrary";
import { exportBookmarks, parseBookmarks, songRevision, type PracticeBookmark } from "./practiceBookmarks";
import { exportPracticeHistory, parsePracticeHistory, practicePieceRevision, PracticePassRecorder } from "./practiceHistory";
import { PracticeSession } from "./session";
import { songDuration, trimSong, type Song } from "./music";
import { passageTitle } from "./songTitle";
import { songTempoMap } from "./songTempo";

const legacy: Song = { id: "legacy", title: "Legacy", tempo: 120, duration: 3,
  notes: [{ id: "n0", pitch: 60, start: 0, duration: 2, velocity: .8, hand: "right" }] };
const mapped: Song = { ...legacy, id: "mapped", title: "Mapped", midiTempoMap: [
  { seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: 1, microsecondsPerQuarter: 1000000 },
] };
function storage(initial = JSON.stringify([legacy, mapped])) {
  let bytes = initial;
  return { getItem: () => bytes, setItem: (_key: string, next: string) => { bytes = next; } };
}

it("retains exact pre-metadata bookmark and history hashes for map-less music", async () => {
  expect(await songRevision(legacy)).toBe("0ce76c9147eb5f55eb16e31e7087c8b8486413bb3a54a620a7ad0ac988832e51");
  expect(practicePieceRevision(legacy)).toBe("v1-1-5c0b0a94");
  const restored = parseProject(serializeProject(legacy));
  expect(await songRevision(restored)).toBe(await songRevision(legacy));
  expect(practicePieceRevision(restored)).toBe(practicePieceRevision(legacy));
  expect(restored).not.toHaveProperty("midiTempoMap");
});

it("includes maps in exact revisions but not library IDs, names or folder identity", async () => {
  const revision = await songRevision(mapped), history = practicePieceRevision(mapped);
  const changed = { ...mapped, midiTempoMap: mapped.midiTempoMap!.map((entry, i) => i ? { ...entry, seconds: 1.25 } : entry) };
  expect(await songRevision(changed)).not.toBe(revision); expect(practicePieceRevision(changed)).not.toBe(history);
  expect(await songRevision(legacy)).not.toBe(revision); expect(practicePieceRevision(legacy)).not.toBe(history);
  const copy = { ...parseProject(serializeProject(mapped)), id: "new-id", title: "New title",
    notes: mapped.notes.map(n => ({ ...n, id: "new-note" })), folderSource: { folderId: "new-folder", name: "backup.json", digest: "b".repeat(64) } };
  expect(await songRevision(copy)).toBe(revision); expect(practicePieceRevision(copy)).toBe(history);
  const bookmark: PracticeBookmark = { id: "bookmark", name: "Mapped study", songId: mapped.id, title: mapped.title,
    revision, hand: "both", mode: "listen", speed: 100, countIn: false, repeat: false };
  const bytes = exportBookmarks([bookmark]);
  expect(parseBookmarks(bytes)).toEqual([bookmark]); expect(bytes).not.toContain("midiTempoMap");
});

it("retains raw untouched legacy entries, survives reload and detects map-only cross-tab conflicts", async () => {
  const rawLegacy = { ...legacy, legacyRecoveryMetadata: "keep unchanged" }, db = storage(JSON.stringify([rawLegacy, mapped]));
  const first = new SongLibrary(() => db), stale = new SongLibrary(() => db), bytes = db.getItem();
  expect(first.getSnapshot().songs[1]).toEqual(mapped); expect(db.getItem()).toBe(bytes);
  const changed = { ...mapped, midiTempoMap: [mapped.midiTempoMap![0], { seconds: .75, microsecondsPerQuarter: 750000 }] };
  expect(await first.save(changed, mapped)).toMatchObject({ ok: true });
  const saved = db.getItem();
  expect(JSON.parse(saved).find((song: Song) => song.id === legacy.id)).toEqual(rawLegacy);
  expect(await stale.save({ ...mapped, title: "Stale edit" }, mapped)).toMatchObject({ ok: false, error: expect.stringContaining("another tab") });
  expect(db.getItem()).toBe(saved);
  const reloaded = new SongLibrary(() => db).getSnapshot();
  expect(reloaded.blocked).toBe(false); expect(reloaded.songs[0]).toEqual(changed);
  expect(reloaded.songs.find(song => song.id === legacy.id)).not.toHaveProperty("midiTempoMap");
});

it("preserves corrupt map storage and quota failures without replacing existing bytes", async () => {
  const corrupt = storage(JSON.stringify([{ ...mapped, midiTempoMap: [] }])), before = corrupt.getItem();
  const library = new SongLibrary(() => corrupt);
  expect(library.getSnapshot().blocked).toBe(true);
  expect(await library.save(legacy, null)).toMatchObject({ ok: false }); expect(corrupt.getItem()).toBe(before);
  const quota = new SongLibrary(() => ({ getItem: () => JSON.stringify([legacy]), setItem() { throw Error("Quota"); } }));
  expect(await quota.save(mapped, null)).toMatchObject({ ok: false }); expect(quota.getSnapshot().songs).toEqual([legacy]);
});

it.each([490, 491, 500])("keeps %i-character titles, provenance, maps and revision recovery after repeated trims", async size => {
  const original = { ...mapped, title: "T".repeat(size), scoreXml: "<score-partwise/>",
    folderSource: { folderId: "original", name: "song.mid", digest: "a".repeat(64) } };
  const before = serializeProject(original), db = storage(JSON.stringify([original])), library = new SongLibrary(() => db);
  let passage = original;
  for (let i = 0; i < 2; i++) {
    passage = { ...passage, ...trimSong(passage, .25, songDuration(passage)), id: `passage-${i}`, title: passageTitle(passage.title) };
    expect(passage.title.length).toBeLessThanOrEqual(500);
    expect(await library.save(passage, null)).toMatchObject({ ok: true });
    const restored = parseProject(serializeProject(passage));
    expect(restored).toEqual(passage); expect(restored.folderSource).toEqual(original.folderSource);
    expect(await songRevision({ ...restored, id: "reimport" })).toBe(await songRevision(passage));
    expect(restored.midiTempoMap![1].seconds).toBe(1 - (i + 1) * .25);
    const session = new PracticeSession({ notes: passage.notes, tempo: passage.tempo, duration: songDuration(passage),
      tempoMap: songTempoMap(passage), hand: "both", mode: "listen", countIn: false, metronome: true });
    const recorder = new PracticePassRecorder(session, passage, () => "2026-11-11T12:00:00.000Z", () => "mapped-pass");
    session.start(); let completed;
    for (let frame = 0; frame < 20 && !completed; frame++) completed = recorder.advanceFrame(.2, 100, false).completedPass;
    expect(completed?.pieceRevision).toBe(practicePieceRevision(passage));
    expect(parsePracticeHistory(exportPracticeHistory([completed!]))).toEqual([completed]);
    expect(exportPracticeHistory([completed!])).not.toContain("midiTempoMap");
  }
  expect(serializeProject(original)).toBe(before); expect(JSON.parse(db.getItem()).at(-1)).toEqual(original);
});

it("keeps note seconds/playability if an older v1 reader drops optional metadata", async () => {
  const exported = JSON.parse(serializeProject(mapped));
  expect(exported.version).toBe(1);
  // Models the pre-feature reader's explicit Song allowlist, not a migration.
  const { midiTempoMap: _lostMetadata, ...olderSong } = exported.song;
  const reopened = parseProject(JSON.stringify({ version: 1, song: olderSong }));
  expect(reopened.notes).toEqual(mapped.notes); expect(reopened.duration).toBe(mapped.duration); expect(reopened.tempo).toBe(mapped.tempo);
  expect(reopened).not.toHaveProperty("midiTempoMap");
  expect(await songRevision(reopened)).not.toBe(await songRevision(mapped));
});

it("rejects newly mapped projects too large to restore without changing legacy recovery export", async () => {
  const large = { ...mapped, notes: Array.from({ length: 50000 }, (_, i) => ({ ...mapped.notes[0], id: `${i}-` + "n".repeat(190) })) };
  expect(() => serializeProject(large)).toThrow(/10 MiB import limit/);
  expect(() => normalizeSong(large)).toThrow(/10 MiB import limit/);
  const db = storage(JSON.stringify([legacy])), before = db.getItem();
  expect(await new SongLibrary(() => db).save(large, null)).toMatchObject({ ok: false }); expect(db.getItem()).toBe(before);
  const { midiTempoMap: _map, ...legacyRecovery } = large;
  const bytes = serializeProject(legacyRecovery);
  expect(new TextEncoder().encode(bytes).byteLength).toBeGreaterThan(MAX_PROJECT_BYTES);
  expect(() => parseProject(bytes)).toThrow(/10 MiB/);
  const unsafe = { ...legacy, scoreXml: '<score-partwise><image source="https://example.invalid/private"/></score-partwise>' };
  expect(JSON.parse(serializeProject(unsafe)).song).toEqual(unsafe);
});

it("keeps a valid mapped project below the exact existing file-size limit", () => {
  const bytes = serializeProject(mapped);
  expect(parseProject(bytes + " ".repeat(MAX_PROJECT_BYTES - new TextEncoder().encode(bytes).byteLength))).toEqual(mapped);
  expect(() => parseProject(bytes + " ".repeat(MAX_PROJECT_BYTES))).toThrow(/10 MiB/);
});
