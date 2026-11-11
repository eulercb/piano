import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, Hand, Library, Settings2, Piano, X } from "lucide-react";
import type { PracticeHand, PracticeMode } from "./session";
import "./practiceRoom.css";

/** The native modal keeps keyboard focus in the panel and makes the guide inert.
 * Children remain mounted while closed so MIDI permissions and input survive. */
export function PracticePanel({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);
  return <dialog ref={dialog} className="practice-panel" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="practice-panel-heading">
      <h2 id={heading}>{title}</h2>
      <button type="button" className="room-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={20} /></button>
    </div>
    <div className="practice-panel-body">{children}</div>
    <div className="practice-panel-footer"><button type="button" className="button" onClick={onClose}>Done</button></div>
  </dialog>;
}

export function PracticeRoom({ title, hand, mode, speed, guide, settings, results, showScore,
  hasScore, showFingers, onScore, onFingers, onNavigate, onConnection, onSetup }: {
  title: string; hand: PracticeHand; mode: PracticeMode; speed: number;
  guide: ReactNode; settings: ReactNode; results?: (onClose: () => void) => ReactNode;
  showScore: boolean; hasScore: boolean; showFingers: boolean;
  onScore: () => void; onFingers: () => void; onNavigate: (page: string) => void;
  onConnection: () => void; onSetup: () => void;
}) {
  const [panel, setPanel] = useState<"setup" | "results" | null>(null);
  const modeLabel = mode === "melody" ? "Wait for notes" : mode === "rhythm" ? "Rhythm" : "Listen";
  return <section className="practice-room" aria-label="Practice room">
    <div className="room-heading">
      <button className="room-button" aria-label="My library" onClick={() => onNavigate("library")}><Library size={18} /><span>Library</span></button>
      <div className="room-piece"><h1 title={title}>{title}</h1><p>{hand === "both" ? "Both hands" : `${hand === "left" ? "Left" : "Right"} hand`} · {speed}% · {modeLabel}</p></div>
      <button className="room-button" aria-label="Piano connection" onClick={onConnection}><Piano size={18} /><span>Piano</span></button>
    </div>
    <div className="room-tools" aria-label="Practice view">
      <button className="room-button" aria-label="Practice setup" onClick={() => { onSetup(); setPanel("setup"); }}><Settings2 size={18} /><span>Setup</span></button>
      <button className="room-button" aria-label={showScore ? "Falling notes" : "Reading score"} aria-pressed={showScore} onClick={onScore}><BookOpen size={18} /><span>{showScore ? "Falling notes" : "Reading score"}</span></button>
      <button className="room-button" aria-label="Finger hints on falling notes" aria-pressed={showFingers} disabled={showScore} onClick={onFingers}><Hand size={18} /><span>Fingers</span></button>
      {results && <button className="room-button" onClick={() => { onSetup(); setPanel("results"); }}>Results</button>}
    </div>
    {showScore && !hasScore && <p className="room-score-hint">No reading score attached. Import MusicXML or a project with a score in the Library.</p>}
    {guide}
    <PracticePanel open={panel === "setup"} title="Practice setup" onClose={() => setPanel(null)}>
      {settings}
      <p className="room-hint">Finger hints use saved or printed fingerings: 1 is thumb, 5 is little finger. They are suggestions, not detected or graded by MIDI. The Fingers toggle affects falling notes; printed score fingerings stay visible.</p>
      <div className="room-destinations">
        <button className="button light" onClick={() => onNavigate("prepare")}>Prepare a song</button>
        <button className="button light" onClick={() => onNavigate("history")}>Practice history</button>
      </div>
      <p className="room-hint">Touch keys and A–; are a demo. Connect your piano for the full passage. Close this panel, then press Play to continue.</p>
    </PracticePanel>
    <PracticePanel open={panel === "results"} title="Practice results" onClose={() => setPanel(null)}>{results?.(() => setPanel(null))}</PracticePanel>
  </section>;
}
