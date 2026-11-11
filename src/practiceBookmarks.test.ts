import { expect, it, vi } from "vitest";
import { demoSong } from "./music";
import { BOOKMARKS_KEY, exportBookmarks, parseBookmarks, PracticeBookmarksStore, songRevision, type PracticeBookmark } from "./practiceBookmarks";
const revision = await songRevision(demoSong);
const bookmark = (id = "one"): PracticeBookmark => ({ id, name: "Slow hands", songId: demoSong.id, title: demoSong.title, revision, hand: "right", mode: "recital", speed: 50, countIn: true, repeat: false });
function storage() { let raw: string | null = null; return { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } }; }
it("round trips exact revisions and all settings", () => { expect(parseBookmarks(exportBookmarks([bookmark()]))).toEqual([bookmark()]); });
it.each(["speed", "mode", "hand", "countIn", "revision", "songId", "title", "name"])("rejects invalid %s", key => {
  expect(() => parseBookmarks(exportBookmarks([{ ...bookmark(), [key]: null }]))).toThrow();
});
it("rejects changed revisions, duplicates, oversized data and unsupported versions", () => {
  expect(() => parseBookmarks(exportBookmarks([{ ...bookmark(), revision: JSON.stringify({ ...demoSong, title: "other" }) }]))).toThrow();
  expect(() => parseBookmarks(exportBookmarks([bookmark(), bookmark()]))).toThrow();
  expect(() => parseBookmarks(" ".repeat(128 * 1024 + 1))).toThrow();
  expect(() => parseBookmarks('{"version":2,"bookmarks":[]}')).toThrow();
});
it("fresh writes merge stale tabs and preserve concurrent additions on delete", async () => {
  const db = storage(), a = new PracticeBookmarksStore(() => db), b = new PracticeBookmarksStore(() => db);
  await a.change([bookmark()]); await b.change([bookmark("two")]); await a.change([], bookmark());
  expect(parseBookmarks(db.getItem()).map(b => b.id)).toEqual(["two"]);
});
it("preserves corrupt storage and failed quota writes", async () => {
  const db = storage(); db.setItem(BOOKMARKS_KEY, "broken"); const store = new PracticeBookmarksStore(() => db);
  expect(store.getSnapshot().blocked).toBe(true); expect(await store.change([bookmark()])).toBe(false); expect(db.getItem()).toBe("broken");
  const unavailable = new PracticeBookmarksStore(() => ({ getItem: () => null, setItem: () => { throw Error("Quota exceeded"); } }));
  expect(await unavailable.change([bookmark()])).toBe(false); expect(unavailable.getSnapshot().bookmarks).toEqual([]);
});
it("refuses stale deletion and import conflicts without overwriting", async () => {
  const db = storage(), store = new PracticeBookmarksStore(() => db); await store.change([bookmark()]);
  db.setItem(BOOKMARKS_KEY, exportBookmarks([{ ...bookmark(), name: "changed" }])); const bytes = db.getItem();
  expect(await store.change([], bookmark())).toBe(false); expect(await store.change([bookmark()])).toBe(false); expect(db.getItem()).toBe(bytes);
});
it("enforces count limits without dropping bookmarks", async () => {
  const db = storage(), store = new PracticeBookmarksStore(() => db);
  expect(await store.change(Array.from({ length: 50 }, (_, i) => bookmark(String(i))))).toBe(true);
  const before = db.getItem(); expect(await store.change([bookmark("extra")])).toBe(false); expect(db.getItem()).toBe(before);
});
it("rejects lock failure without writes", async () => {
  const db = storage(); vi.stubGlobal("navigator", { locks: { request: () => Promise.reject(Error("lock")) } });
  try { expect(await new PracticeBookmarksStore(() => db).change([bookmark()])).toBe(false); expect(db.getItem()).toBeNull(); } finally { vi.unstubAllGlobals(); }
});
it("exports metadata only and changes the digest for notes, fingers and tempo", async () => {
  const source = exportBookmarks([bookmark()]);
  expect(source).not.toContain('"notes"'); expect(source).not.toContain('"scoreXml"');
  expect(bookmark().revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await songRevision({ ...demoSong, tempo: demoSong.tempo + 1 })).not.toBe(revision);
  expect(await songRevision({ ...demoSong, notes: demoSong.notes.map((n, i) => i ? n : { ...n, finger: n.finger === 1 ? 2 : 1 }) })).not.toBe(revision);
});
it("matches reimported music despite changed library identifiers and title", async () => {
  expect(await songRevision({ ...demoSong, id: "reimport", title: "Renamed backup", notes: demoSong.notes.map(n => ({ ...n, id: "copy-" + n.id })) })).toBe(revision);
});
it("checks the commit guard inside a delayed lock and preserves another tab's bookmarks", async () => {
  const db = storage(), store = new PracticeBookmarksStore(() => db);
  let run!: () => boolean, release!: (value: boolean) => void;
  vi.stubGlobal("navigator", { locks: { request: (_: string, callback: () => boolean) => { run = callback; return new Promise<boolean>(resolve => { release = resolve; }); } } });
  try {
    let current = true;
    const pending = store.change([bookmark()], undefined, () => current);
    db.setItem(BOOKMARKS_KEY, exportBookmarks([bookmark("another-tab")]));
    current = false; release(run());
    expect(await pending).toBe(false);
    expect(parseBookmarks(db.getItem()).map(b => b.id)).toEqual(["another-tab"]);
  } finally { vi.unstubAllGlobals(); }
});
