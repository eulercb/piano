import type { Song } from "./music";
import { normalizeSong } from "./project";

export const SONGS_KEY = "piano-songs";
type LibraryStorage = Pick<Storage, "getItem" | "setItem">;
type Snapshot = { songs: Song[]; message: string };
export type SaveResult = { ok: true; song: Song } | { ok: false; error: string };
const fingerprint = (song: Song | null) => song === null ? null : JSON.stringify(normalizeSong(song));

/** A bad entry must not silently disappear on the next save. */
function parseLibrary(source: string | null): Song[] {
  if (source === null) return [];
  const value: unknown = JSON.parse(source);
  if (!Array.isArray(value)) throw Error("Invalid library");
  if (value.some(item => !item || typeof item.id !== "string" || !item.id || item.id.length > 200))
    throw Error("Missing song identifier");
  const songs = value.map(normalizeSong);
  if (new Set(songs.map(song => song.id)).size !== songs.length) throw Error("Duplicate song identifiers");
  return songs;
}

/** Read fresh before each write, and reject same-piece edits from a stale tab.
 * Web Locks serialize cooperating tabs where supported. No storage repair or
 * clearing is automatic: unreadable data is kept byte-for-byte for recovery.
 */
export class SongLibrary {
  private snapshot: Snapshot = { songs: [], message: "" };
  private listeners = new Set<() => void>();
  constructor(private readonly storage: () => LibraryStorage = () => localStorage) { this.refresh(); }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  refresh = () => {
    try { this.update({ songs: parseLibrary(this.storage().getItem(SONGS_KEY)), message: "" }); }
    catch { this.update({ message: "Saved library could not be read and has not been overwritten. Export your current project to keep a copy." }); }
  };
  listen() {
    const changed = (event: StorageEvent) => { if (event.key === SONGS_KEY || event.key === null) this.refresh(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }
  async save(song: Song, expected: Song | null, isCurrent = () => true): Promise<SaveResult> {
    const fail = (error: string): SaveResult => { this.update({ message: error }); return { ok: false, error }; };
    const write = (): SaveResult => {
      if (!isCurrent()) return { ok: false, error: "Import canceled." };
      let source: string | null, songs: Song[];
      try { source = this.storage().getItem(SONGS_KEY); songs = parseLibrary(source); }
      catch { return fail("Saved library could not be read and has not been overwritten. Export your current project to keep a copy."); }
      try {
        const current = songs.find(item => item.id === song.id) ?? null;
        const valid = normalizeSong(song);
        // Repeated Save is harmless, even if its first lock just completed.
        if (fingerprint(current) !== fingerprint(expected) && fingerprint(current) !== fingerprint(valid)) {
          this.update({ songs });
          return fail("This piece changed in another tab. Your edits are still open, but were not saved. Export your project before reopening the saved piece.");
        }
        const next = [valid, ...songs.filter(item => item.id !== valid.id)];
        this.storage().setItem(SONGS_KEY, JSON.stringify(next));
        this.update({ songs: next, message: "" });
        return { ok: true, song: valid };
      } catch { return fail("Device storage is full or unavailable. Your current project is not saved. Export it to keep a copy."); }
    };
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks?.request) return write();
    try { return await locks.request("piano-song-library-write", write); }
    catch { return fail("The library could not be updated safely. Export your current project, then try saving again in one app tab."); }
  }
}
