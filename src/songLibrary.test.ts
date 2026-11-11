// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { SongLibrary, SONGS_KEY } from "./songLibrary";
import type { Song } from "./music";

const song = (id: string): Song => ({ id, title: id, tempo: 120,
  notes: [{ id: "note", start: 0, duration: 1, pitch: 60, hand: "right", velocity: .7 }] });
function storage(initial: Song[] = []) {
  let source = JSON.stringify(initial);
  return { getItem: vi.fn(() => source), setItem: vi.fn((_key: string, value: string) => { source = value; }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("merges saves with the latest stored library even when another tab's event was missed", async () => {
  const disk = storage([song("first")]), left = new SongLibrary(() => disk), right = new SongLibrary(() => disk);
  expect((await left.save(song("second"), null)).ok).toBe(true);
  expect((await right.save(song("third"), null)).ok).toBe(true);
  expect(JSON.parse(disk.getItem()).map((s: Song) => s.id)).toEqual(["third", "second", "first"]);
});
it("rejects a stale same-piece edit, keeping both the newer saved version and the caller's draft", async () => {
  const original = song("first"), disk = storage([original]);
  const left = new SongLibrary(() => disk), right = new SongLibrary(() => disk);
  await left.save({ ...original, title: "Newer saved edit" }, original);
  const draft = { ...original, title: "Unsaved other edit" }, result = await right.save(draft, original);
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("another tab") });
  expect(JSON.parse(disk.getItem())[0].title).toBe("Newer saved edit");
  expect(draft.title).toBe("Unsaved other edit");
});
it("does not restore a piece removed in another tab", async () => {
  const original = song("first"), disk = storage([original]), library = new SongLibrary(() => disk);
  disk.setItem(SONGS_KEY, "[]");
  expect((await library.save({ ...original, title: "Edit" }, original)).ok).toBe(false);
  expect(disk.getItem()).toBe("[]");
});
it.each(["{broken", "{}", JSON.stringify([song("good"), { id: "bad" }]), JSON.stringify([song("same"), song("same")]), JSON.stringify([{ ...song("missing"), id: undefined }])])(
  "never overwrites an unreadable or ambiguous library: %s", async source => {
    const disk = storage(); disk.setItem(SONGS_KEY, source); disk.setItem.mockClear();
    const library = new SongLibrary(() => disk);
    expect(library.getSnapshot().message).toContain("has not been overwritten");
    expect((await library.save(song("incoming"), null)).ok).toBe(false);
    expect(disk.setItem).not.toHaveBeenCalled(); expect(disk.getItem()).toBe(source);
  },
);
it("does not replace a previously readable library when storage becomes unreadable", async () => {
  const original = song("first"), disk = storage([original]), library = new SongLibrary(() => disk);
  disk.setItem(SONGS_KEY, "bad");
  expect((await library.save(song("incoming"), null)).ok).toBe(false);
  expect(library.getSnapshot().songs).toEqual([original]); expect(disk.getItem()).toBe("bad");
});
it("reports quota failures without adding an unsaved song to the persisted library", async () => {
  const disk = storage([song("first")]), library = new SongLibrary(() => disk);
  disk.setItem.mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  expect((await library.save(song("incoming"), null)).ok).toBe(false);
  expect(library.getSnapshot().message).toContain("not saved");
  expect(library.getSnapshot().songs.map(s => s.id)).toEqual(["first"]);
});
it("allows retrying exactly the same save without treating it as a conflict", async () => {
  const original = song("first"), disk = storage([original]), library = new SongLibrary(() => disk), edited = { ...original, title: "Edited" };
  expect((await library.save(edited, original)).ok).toBe(true);
  expect((await library.save(edited, original)).ok).toBe(true);
  expect(JSON.parse(disk.getItem())).toHaveLength(1);
});
it("refreshes on library and clear storage events and stops listening after cleanup", () => {
  const disk = storage(), library = new SongLibrary(() => disk), stop = library.listen();
  disk.setItem(SONGS_KEY, JSON.stringify([song("new")]));
  window.dispatchEvent(new StorageEvent("storage", { key: SONGS_KEY }));
  expect(library.getSnapshot().songs).toHaveLength(1);
  disk.setItem(SONGS_KEY, "[]"); window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(library.getSnapshot().songs).toHaveLength(0);
  stop(); disk.setItem(SONGS_KEY, JSON.stringify([song("new")]));
  window.dispatchEvent(new StorageEvent("storage", { key: SONGS_KEY }));
  expect(library.getSnapshot().songs).toHaveLength(0);
});
it("uses a shared Web Lock and rechecks cancellation after the lock becomes available", async () => {
  let write!: () => unknown, release!: () => void;
  const request = vi.fn((_key, action) => new Promise<void>(resolve => { write = action; release = resolve; }));
  vi.stubGlobal("navigator", { locks: { request } });
  const disk = storage(), library = new SongLibrary(() => disk); let current = true;
  const saving = library.save(song("incoming"), null, () => current);
  expect(request).toHaveBeenCalledWith("piano-song-library-write", expect.any(Function));
  current = false; expect(write()).toMatchObject({ ok: false }); release(); await saving;
  expect(disk.setItem).not.toHaveBeenCalled();
});
it("does not fall back to an uncoordinated write when locking fails", async () => {
  vi.stubGlobal("navigator", { locks: { request: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
  const disk = storage(), library = new SongLibrary(() => disk);
  expect((await library.save(song("incoming"), null)).ok).toBe(false);
  expect(disk.setItem).not.toHaveBeenCalled();
});
