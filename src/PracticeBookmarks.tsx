import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { exportBookmarks, MAX_BOOKMARK_BYTES, parseBookmarks, PracticeBookmarksStore, type PracticeBookmark } from "./practiceBookmarks";
import { practiceHandName, practiceModeName } from "./practiceNextSteps";
import "./practiceBookmarks.css";
export function PracticeBookmarks({ store, onSave, onRestore, canSave, cannotSaveReason }: {
  store: PracticeBookmarksStore; onSave?: (name: string) => Promise<boolean>;
  onRestore: (bookmark: PracticeBookmark) => void; canSave?: boolean; cannotSaveReason?: string;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [name, setName] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PracticeBookmark | null>(null);
  const [incoming, setIncoming] = useState<PracticeBookmark[] | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  function backup() {
    try {
      const url = URL.createObjectURL(new Blob([exportBookmarks(state.bookmarks)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "piano-practice-bookmarks.json"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Backup download requested. Keep it private: it includes bookmark and piece titles, not music. Export song projects separately to restore missing library pieces.");
    } catch { setMessage("Could not download the backup. Bookmarks are unchanged."); }
  }
  return <section className="practice-bookmarks" aria-label="Practice bookmarks">
    <h3>Practice bookmarks</h3>
    <p>Return to a saved piece or prepared passage with its settings. Opens at the beginning, paused.</p>
    {onSave && <div>
      <label>Bookmark name <input maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <button className="button light" disabled={busy || !canSave || !name.trim() || state.blocked} onClick={async () => {
        setBusy(true); try { if (await onSave(name.trim())) setName(""); } finally { setBusy(false); }
      }}>Save practice bookmark</button>
      {!canSave && <p>{cannotSaveReason ?? "Save this piece in Studio before bookmarking its settings."}</p>}
    </div>}
    {state.message && <p role="status">{state.message}</p>}{message && <p role="status">{message}</p>}
    {!state.bookmarks.length && <p>No bookmarks yet. Save one in Practice setup.</p>}
    <ul>{state.bookmarks.map(b => <li key={b.id}>
      <b>{b.name}</b><p>{b.title} · {practiceHandName(b.hand)} · {practiceModeName(b.mode)} · {b.speed}% · Count-in {b.countIn ? "on" : "off"} · Repeat {b.repeat ? "on" : "off"}</p>
      <button className="button light" disabled={busy || state.blocked} onClick={() => onRestore(b)}>Open {b.name}</button>{" "}
      <button className="text-button" disabled={busy || state.blocked} onClick={() => { setIncoming(null); setPending(b); }}>Delete {b.name}</button>
    </li>)}</ul>
    {pending && <div role="group" aria-label="Confirm bookmark deletion">
      <p>Delete “{pending.name}”? Export bookmarks first to keep a copy. This cannot be undone here. Songs, history and exported backups stay unchanged.</p>
      <button className="button light" disabled={busy} onClick={async () => { setBusy(true); try { if (await store.change([], pending)) setPending(null); } finally { setBusy(false); } }}>Yes, delete bookmark</button>
      <button className="text-button" disabled={busy} onClick={() => setPending(null)}>Cancel deletion</button>
    </div>}
    <button className="button light" disabled={!state.bookmarks.length} onClick={backup}>Export bookmarks</button>
    <label>Import bookmark backup <input type="file" accept=".json,application/json" disabled={busy || state.blocked} onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      const version = ++generation.current; setBusy(true); setIncoming(null); setPending(null);
      try {
        if (file.size > MAX_BOOKMARK_BYTES) throw Error("Choose a bookmark backup no larger than 128 KiB.");
        const data = parseBookmarks(await file.text()); if (version === generation.current) setIncoming(data);
      } catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : "Could not read backup."); }
      finally { if (version === generation.current) setBusy(false); }
    }} /></label>
    {incoming && <div role="group" aria-label="Confirm bookmark import">
      <p>Merge {incoming.length} bookmarks? Identical duplicates are skipped; conflicts are rejected. This does not import songs or start playback.</p>
      <button className="button light" disabled={busy} onClick={async () => { setBusy(true); try { if (await store.change(incoming)) setIncoming(null); } finally { setBusy(false); } }}>Merge bookmarks</button>
      <button className="text-button" disabled={busy} onClick={() => setIncoming(null)}>Cancel import</button>
    </div>}
    <p>Local to this browser, up to 50 bookmarks and 128 KiB. Backups include titles and settings, not notes or scores; keep them private. Export bookmark and song backups before clearing browser data. Use one app tab if tab coordination is unavailable.</p>
  </section>;
}
