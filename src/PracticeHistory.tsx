import { useRef, useState, useSyncExternalStore } from "react";
import { Download, History, Trash2, Upload } from "lucide-react";
import { formatTime } from "./music";
import {
  exportPracticeHistory, MAX_HISTORY_BYTES, MAX_HISTORY_PASSES,
  parsePracticeHistory, practiceSuggestion, PracticeHistoryStore, type PracticePass,
} from "./practiceHistory";
import "./practiceHistory.css";

const modeNames = { listen: "Listening", melody: "Melody", rhythm: "Rhythm" };
const handNames = { left: "Left hand", right: "Right hand", both: "Both hands" };

function PassSummary({ pass }: { pass: PracticePass }) {
  if (pass.mode === "listen") return <p>Listening pass · {pass.noteCount} selected notes · no performance score</p>;
  if (pass.mode === "melody") return <p>{pass.noteCount} selected notes reached in wait-for-note practice · timing not graded</p>;
  const summary = pass.rhythm!;
  return <dl className="history-counts">
    <div><dt>On time</dt><dd>{summary.onTime} / {summary.total}</dd></div>
    <div><dt>Early</dt><dd>{summary.early}</dd></div>
    <div><dt>Late</dt><dd>{summary.late}</dd></div>
    <div><dt>Missed</dt><dd>{summary.missed}</dd></div>
    <div><dt>Extra presses</dt><dd>{summary.extra}</dd></div>
  </dl>;
}

export function PracticeHistory({ store }: { store: PracticeHistoryStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [pending, setPending] = useState<"clear" | PracticePass | null>(null);
  const [incoming, setIncoming] = useState<PracticePass[] | null>(null);
  const [message, setMessage] = useState("");
  const [limit, setLimit] = useState(10);
  const input = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const [reading, setReading] = useState(false);
  const [changing, setChanging] = useState(false);
  const { passes } = snapshot;
  async function importBackup(file?: File) {
    if (!file) return;
    const version = ++readVersion.current;
    setIncoming(null);
    setMessage("");
    setReading(true);
    try {
      if (file.size > MAX_HISTORY_BYTES) throw new Error("Choose a practice-history backup no larger than 1 MiB.");
      const parsed = parsePracticeHistory(await file.text());
      if (version === readVersion.current) setIncoming(parsed);
    } catch (error) {
      if (version === readVersion.current) setMessage(error instanceof Error ? error.message : "Could not read this backup.");
    } finally {
      if (version === readVersion.current) setReading(false);
      if (input.current) input.current.value = "";
    }
  }
  function exportBackup() {
    try {
      const url = URL.createObjectURL(new Blob([exportPracticeHistory(passes)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `piano-practice-history-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Backup download requested. It includes piece titles and practice summaries, not scores. Keep it somewhere private.");
    } catch { setMessage("The backup could not be downloaded. Your history is unchanged. Try another browser or free device storage."); }
  }
  async function confirmDelete() {
    if (!pending || changing) return;
    setChanging(true);
    try {
      const success = await (pending === "clear" ? store.clear() : store.remove(pending.id));
      if (success) setPending(null);
    } finally { setChanging(false); }
  }
  return <section className="practice-history" aria-labelledby="practice-history-title">
    <div className="history-heading">
      <div><span className="history-eyebrow"><History size={17} /> YOUR PRACTICE, ON THIS DEVICE</span>
        <h2 id="practice-history-title">Small steps, remembered.</h2>
        <p>Completed passes only. Pauses, restarts and unfinished attempts are not achievements or failures.</p>
      </div>
      <div className="history-actions">
        <button className="button light" disabled={!passes.length} onClick={exportBackup}><Download size={16} /> Export history</button>
        <button className="button light" disabled={reading || changing} onClick={() => { setPending(null); input.current?.click(); }}><Upload size={16} /> Import backup</button>
        <button className="text-button" disabled={changing || (!passes.length && !snapshot.blocked)} onClick={() => { ++readVersion.current; setReading(false); setIncoming(null); setMessage(""); setPending("clear"); }}><Trash2 size={16} /> Clear history</button>
      </div>
    </div>
    <input ref={input} hidden type="file" accept=".json,application/json" aria-label="Import practice history backup" onChange={(event) => { void importBackup(event.target.files?.[0]); }} />
    {snapshot.message && <p className="history-message" role="status">{snapshot.message}</p>}
    {message && <p className="history-message" role="status">{message}</p>}
    {reading && <p role="status">Reading backup on this device…</p>}
    {incoming && <div className="history-confirm" role="group" aria-label="Confirm history import">
      <p>Merge {incoming.length} completed {incoming.length === 1 ? "pass" : "passes"} from this backup? Duplicate passes are skipped. Only the newest {MAX_HISTORY_PASSES} passes are kept; export current history first if you need an older copy.</p>
      <button className="button light" disabled={changing} onClick={async () => {
        setChanging(true);
        try { if (await store.restore(incoming)) { setIncoming(null); setMessage(""); } }
        catch (error) { setMessage(error instanceof Error ? error.message : "Backup could not be imported."); }
        finally { setChanging(false); }
      }}>Merge backup</button>
      <button className="text-button" disabled={changing} onClick={() => { ++readVersion.current; setIncoming(null); setMessage(""); }}>Cancel import</button>
    </div>}
    {pending && <div className="history-confirm" role="group" aria-label="Confirm history deletion">
      <p>{pending === "clear" ? "Clear all practice history on this device? This also removes any unreadable saved history. Your songs and exported backups are unchanged. This cannot be undone here." : `Delete this completed pass for “${pending.pieceTitle}”? This cannot be undone here; exported backups are unchanged.`}</p>
      <button className="button light" disabled={changing} onClick={() => { void confirmDelete(); }}>{pending === "clear" ? "Yes, clear history" : "Yes, delete pass"}</button>
      <button className="text-button" disabled={changing} onClick={() => setPending(null)}>Cancel deletion</button>
    </div>}
    <div className="history-suggestion"><b>A gentle next step</b><p>{practiceSuggestion(passes)}</p></div>
    <p className="history-limits">Note-start feedback only: it does not judge note lengths, fingering, touch, pedal, expression or overall musical ability. Listening is not a performance score. Melody mode waits, so finishing does not measure timing. Device latency can affect rhythm counts; doubled unisons count as separate written notes.</p>
    {!passes.length ? <div className="history-empty"><h3>Ready for your first pass.</h3><p>Finish listening to a piece or complete a melody or rhythm passage. It will appear here automatically.</p></div> : <>
      <p className="history-total">{passes.length} completed {passes.length === 1 ? "pass" : "passes"}{snapshot.temporary ? " · temporary, export before closing" : " · saved locally"}</p>
      <ol className="history-list">{passes.slice(0, limit).map((pass) => <li key={pass.id}>
        <div className="history-pass-heading"><div><h3>{pass.pieceTitle}</h3><time dateTime={pass.completedAt}>{new Date(pass.completedAt).toLocaleString()}</time></div>
          <button className="text-button" disabled={changing} aria-label={`Delete ${pass.pieceTitle} pass from ${new Date(pass.completedAt).toLocaleString()}`} onClick={() => { setIncoming(null); setMessage(""); setPending(pass); }}><Trash2 size={16} /> Delete</button>
        </div>
        <p className="history-pass-meta">{modeNames[pass.mode]} · {handNames[pass.hand]} · {pass.speedMin === pass.speedMax ? `${pass.speedMin}% speed` : `${pass.speedMin}–${pass.speedMax}% speed (changed during pass)`} · {pass.tempo} BPM source</p>
        <p className="history-passage">{pass.startSeconds > 0 ? "From partway through the selected piece" : "Selected piece / prepared passage"} · {formatTime(pass.startSeconds)}–{formatTime(pass.endSeconds)}</p>
        <PassSummary pass={pass} />
      </li>)}</ol>
      {passes.length > limit && <button className="button light" onClick={() => setLimit((value) => value + 10)}>Show older passes</button>}
    </>}
    <p className="history-privacy">No account or upload. This browser keeps up to {MAX_HISTORY_PASSES} recent passes, including piece titles. Browser data can be cleared; export history separately from your song projects. If your browser does not support tab coordination, use one app tab at a time.</p>
  </section>;
}
