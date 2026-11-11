import type { Song } from "./music";
import { normalizeSong } from "./project";
import type { PracticeHand, PracticeMode } from "./session";
export const BOOKMARKS_KEY = "piano-practice-bookmarks-v1";
export const MAX_BOOKMARK_BYTES = 128 * 1024;
export type PracticeBookmark = { id: string; name: string; songId: string; title: string; revision: string; hand: PracticeHand; mode: PracticeMode; speed: number; countIn: boolean; repeat: boolean };
/** Content-based revision survives project reimport with a new library id/title. */
export async function songRevision(song: Song): Promise<string> {
  if (!globalThis.crypto?.subtle) throw Error("Secure bookmark revision checking is unavailable in this browser. Use HTTPS or localhost.");
  const normalized = normalizeSong(song);
  const music = { tempo: normalized.tempo, notes: normalized.notes.map(({ id: _id, ...note }) => note),
    duration: normalized.duration, scoreXml: normalized.scoreXml, scoreOrigin: normalized.scoreOrigin,
    ...(normalized.midiTempoMap === undefined ? {} : { midiTempoMap: normalized.midiTempoMap }) };
  const bytes = new TextEncoder().encode(JSON.stringify(music));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export const exportBookmarks = (bookmarks: PracticeBookmark[]) => JSON.stringify({ version: 1, bookmarks });
export function parseBookmarks(source: string | null): PracticeBookmark[] {
  if (source === null) return [];
  if (new TextEncoder().encode(source).length > MAX_BOOKMARK_BYTES) throw Error("Bookmarks exceed the 128 KiB limit.");
  const data = JSON.parse(source);
  const invalid = (): never => { throw Error("Invalid bookmark backup."); };
  if (data?.version !== 1 || !Array.isArray(data.bookmarks) || data.bookmarks.length > 50) return invalid();
  const ids = new Set<string>();
  return data.bookmarks.map((b: PracticeBookmark) => {
    if (!b || typeof b.id !== "string" || !b.id || b.id.length > 200 || ids.has(b.id) ||
      typeof b.name !== "string" || !b.name.trim() || b.name.length > 100 ||
      typeof b.songId !== "string" || !b.songId || b.songId.length > 200 ||
      typeof b.title !== "string" || !b.title || b.title.length > 500 ||
      typeof b.revision !== "string" || !/^[a-f0-9]{64}$/.test(b.revision) || !["left", "right", "both"].includes(b.hand) ||
      !["listen", "melody", "rhythm", "recital"].includes(b.mode) ||
      !Number.isInteger(b.speed) || b.speed < 25 || b.speed > 125 || b.speed % 5 !== 0 ||
      typeof b.countIn !== "boolean" || typeof b.repeat !== "boolean") return invalid();
    ids.add(b.id);
    return { id: b.id, name: b.name.trim(), songId: b.songId, title: b.title, revision: b.revision,
      hand: b.hand, mode: b.mode, speed: b.speed, countIn: b.countIn, repeat: b.repeat };
  });
}
export class PracticeBookmarksStore {
  private snapshot = { bookmarks: [] as PracticeBookmark[], message: "", blocked: false };
  private listeners = new Set<() => void>();
  constructor(private storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage) { this.refresh(); }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<typeof this.snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  refresh = () => {
    try { this.update({ bookmarks: parseBookmarks(this.storage().getItem(BOOKMARKS_KEY)), blocked: false, message: "" }); }
    catch { this.update({ blocked: true, message: "Bookmarks could not be read. Saved bytes have not been overwritten. Keep your backups." }); }
  };
  listen() {
    const changed = (e: StorageEvent) => { if (e.key === BOOKMARKS_KEY || e.key === null) this.refresh(); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }
  async change(incoming: PracticeBookmark[], remove?: PracticeBookmark, beforeWrite: () => boolean = () => true): Promise<boolean> {
    const write = () => {
      try {
        const current = parseBookmarks(this.storage().getItem(BOOKMARKS_KEY));
        const found = remove && current.find(b => b.id === remove.id);
        if (found && JSON.stringify(found) !== JSON.stringify(remove)) throw Error("This bookmark changed in another tab. Refresh before deleting it.");
        const next = current.filter(b => b.id !== remove?.id);
        for (const b of incoming) {
          const existing = next.find(item => item.id === b.id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(b)) throw Error("Backup conflicts with a saved bookmark.");
          if (!existing) next.push(b);
        }
        if (next.length > 50) throw Error("Keep at most 50 bookmarks. Export a backup and delete an unused bookmark first.");
        const source = exportBookmarks(next), valid = parseBookmarks(source);
        // Run synchronously inside the lock, after reading/merging fresh bookmarks.
        // An async revision check or a queued lock must not commit an obsolete selection.
        if (!beforeWrite()) return false;
        this.storage().setItem(BOOKMARKS_KEY, source);
        this.update({ bookmarks: valid, message: "", blocked: false }); return true;
      } catch (error) {
        this.update({ message: `${error instanceof Error ? error.message : "Storage is unavailable."} Bookmarks were not saved. Existing storage is unchanged.` }); return false;
      }
    };
    try { return typeof navigator !== "undefined" && navigator.locks?.request ? await navigator.locks.request("piano-practice-bookmarks-write", write) : write(); }
    catch { this.update({ message: "Bookmarks could not be updated safely. Try again using one app tab." }); return false; }
  }
}
