import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Note, Song } from "./music";
import { deleteNote, editNote, insertNote, NOTE_AUTHORING_LIMITS, noteAuthoringAvailability } from "./noteAuthoring";
import "./studioNoteAuthoring.css";
import { StudioScoreAuthoring } from "./StudioScoreAuthoring";

export type NoteAuthoringChange = { action: "insert" | "edit" | "delete"; noteId: string | null };
type Props = { song: Song; onChange: (song: Song, change: NoteAuthoringChange) => void; timingOnly?: boolean; selectedNoteId?: string; onSelectNote?: (id: string) => void };
type Draft = { pitch: string; start: string; duration: string; hand: Note["hand"]; finger: string; velocity: number };
const pitchName = (pitch: number) => `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const draftFor = (note: Note): Draft => ({
  pitch: String(note.pitch), start: String(note.start), duration: String(note.duration),
  hand: note.hand, finger: note.finger === undefined ? "" : String(note.finger), velocity: note.velocity,
});
const newDraft = (song: Song, after?: Note): Draft => ({
  pitch: String(after?.pitch ?? 60), start: String(after ? after.start + after.duration : 0),
  duration: String(60 / song.tempo), hand: after?.hand ?? "right", finger: "", velocity: 0.72,
});
function numeric(value: string, label: string): number {
  if (!value.trim()) throw Error(`${label} is required.`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw Error(`${label} must be a finite number.`);
  return result;
}

/** The parent applies onChange synchronously and resets playback before using the new song. */
export function StudioNoteAuthoring(props: Props) {
  if (props.song.scoreOrigin === "musicxml") return <StudioScoreAuthoring key={props.song.id} song={props.song} onChange={props.onChange} />;
  const availability = noteAuthoringAvailability(props.song);
  if (!availability.allowed) return (
    <section className="studio-note-authoring" aria-label="Note authoring">
      <h3>Add, delete & retime notes</h3>
      <p>{availability.reason}</p>
    </section>
  );
  return <Editor key={props.song.id} {...props} warning={availability.warning} />;
}

function Editor({ song, onChange, warning, timingOnly = false, selectedNoteId, onSelectNote }: Props & { warning?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(song.notes[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const selected = song.notes.find(note => note.id === (selectedNoteId ?? selectedId)) ?? song.notes[0];
  const selectedIndex = selected ? song.notes.indexOf(selected) : -1;
  const [draft, setDraft] = useState<Draft>(() => selected ? draftFor(selected) : newDraft(song));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ song: Song; noteId: string } | null>(null);
  const usedConfirmation = useRef<typeof pendingDelete>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const helpId = useId(), errorId = useId(), deleteId = useId();
  const confirming = pendingDelete?.song === song && pendingDelete.noteId === selected?.id;

  // Reset against the rendered source before committing interactive controls. A
  // passive effect can run after the first input event and erase the newer draft.
  const [draftSource, setDraftSource] = useState({ song, selected });
  if (draftSource.song !== song || draftSource.selected !== selected) {
    setDraftSource({ song, selected });
    setAdding(false);
    setDraft(selected ? draftFor(selected) : newDraft(song));
    setPendingDelete(null);
    setError("");
  }
  useEffect(() => { if (confirming) cancelDelete.current?.focus(); }, [confirming]);

  function choose(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= song.notes.length) return;
    setSelectedId(song.notes[index].id);
    onSelectNote?.(song.notes[index].id);
    setMessage("");
    setPendingDelete(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (confirming) return;
    try {
      const input = {
        pitch: numeric(draft.pitch, "Pitch"), start: numeric(draft.start, "Start"),
        duration: numeric(draft.duration, "Duration"), hand: draft.hand,
        finger: draft.finger ? numeric(draft.finger, "Finger") : undefined, velocity: draft.velocity,
      };
      if (adding || !selected) {
        const next = insertNote(song, input);
        const oldIds = new Set(song.notes.map(note => note.id));
        const noteId = next.notes.find(note => !oldIds.has(note.id))!.id;
        onChange(next, { action: "insert", noteId });
        setSelectedId(noteId);
        setMessage("Note added.");
      } else {
        const next = editNote(song, selected.id, input);
        onChange(next, { action: "edit", noteId: selected.id });
        setMessage("Note updated.");
      }
      setAdding(false);
      setError("");
    } catch (cause) {
      setMessage("");
      setError(cause instanceof Error ? cause.message : "The note could not be changed.");
    }
  }

  function confirmDelete() {
    // A confirmation is valid for one exact song snapshot and one note only.
    if (!pendingDelete || !confirming || usedConfirmation.current === pendingDelete) return;
    usedConfirmation.current = pendingDelete;
    try {
      const next = deleteNote(song, pendingDelete.noteId);
      const noteId = next.notes[Math.min(selectedIndex, next.notes.length - 1)]?.id ?? null;
      onChange(next, { action: "delete", noteId });
      setSelectedId(noteId);
      setPendingDelete(null);
      setMessage("Note deleted. Other notes have not moved.");
      setError("");
    } catch (cause) {
      setPendingDelete(null);
      setError(cause instanceof Error ? cause.message : "The note could not be deleted.");
    }
  }

  return (
    <section className="studio-note-authoring" aria-label="Note authoring">
      <div className="authoring-heading">
        <div>
          <h3>{timingOnly ? "Add, delete & retime notes" : "Notes & fingerings"}</h3>
          <p id={helpId}>Apply changes here, then save the song or export a project to keep them. Times are in seconds. Adding or deleting a note does not move other notes.</p>
        </div>
        <button type="button" className="button light" disabled={confirming || song.notes.length >= NOTE_AUTHORING_LIMITS.maxNotes} onClick={() => {
          setAdding(true); setDraft(newDraft(song, selected)); setError(""); setMessage("");
        }}>Add a note</button>
      </div>
      {warning && <p className="authoring-warning">{warning}</p>}
      {!adding && selected && (
        <div className="authoring-selection">
          <button type="button" className="button light" disabled={selectedIndex <= 0 || confirming} onClick={() => choose(selectedIndex - 1)}>Previous note</button>
          <label>Note number
            <input type="number" min="1" max={song.notes.length} step="1" value={selectedIndex + 1} disabled={confirming} onChange={event => choose(Number(event.target.value) - 1)} />
          </label>
          <span>of {song.notes.length} · {pitchName(selected.pitch)} · {selected.start.toFixed(3)} s</span>
          <button type="button" className="button light" disabled={selectedIndex >= song.notes.length - 1 || confirming} onClick={() => choose(selectedIndex + 1)}>Next note</button>
        </div>
      )}
      {!selected && !adding && <p>No notes yet. Enter the first note below.</p>}
      <form noValidate onSubmit={submit} aria-label={adding || !selected ? "Add note" : "Edit note"} aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}>
        <fieldset disabled={confirming}>
          <legend>{adding || !selected ? "New note" : `Edit ${pitchName(selected.pitch)}`}</legend>
          <div className="authoring-fields">
            {(!timingOnly || adding || !selected) && <label>{timingOnly ? "New note pitch (MIDI)" : "Pitch (MIDI)"}
              <input type="number" min="0" max="127" step="1" value={draft.pitch} onChange={event => setDraft({ ...draft, pitch: event.target.value })} />
              <small>0–127 · Middle C = 60</small>
            </label>}
            <label>Start (seconds)
              <input type="number" min="0" max={NOTE_AUTHORING_LIMITS.maxSeconds} step="any" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} />
            </label>
            <label>Duration (seconds)
              <input type="number" min="0" max={NOTE_AUTHORING_LIMITS.maxSeconds} step="any" value={draft.duration} onChange={event => setDraft({ ...draft, duration: event.target.value })} />
              <small>Greater than zero</small>
            </label>
            {(!timingOnly || adding || !selected) && <><label>{timingOnly ? "New note hand" : "Hand"}
              <select value={draft.hand} onChange={event => setDraft({ ...draft, hand: event.target.value as Note["hand"] })}>
                <option value="left">Left</option><option value="right">Right</option>
              </select>
            </label>
            <label>{timingOnly ? "New note finger" : "Finger"}
              <select value={draft.finger} onChange={event => setDraft({ ...draft, finger: event.target.value })}>
                <option value="">Unspecified</option>
                <option value="1">1 · Thumb</option><option value="2">2 · Index</option><option value="3">3 · Middle</option><option value="4">4 · Ring</option><option value="5">5 · Little</option>
              </select>
            </label></>}
          </div>
          <div className="authoring-actions">
            <button className="button" type="submit">{adding || !selected ? "Add note" : "Apply note changes"}</button>
            {adding && <button className="button light" type="button" onClick={() => { setAdding(false); setDraft(selected ? draftFor(selected) : newDraft(song)); setError(""); }}>Cancel new note</button>}
            {!adding && selected && <button className="button light authoring-delete" type="button" onClick={() => {
              setPendingDelete({ song, noteId: selected.id }); setError(""); setMessage("");
            }}>Delete note</button>}
          </div>
        </fieldset>
      </form>
      {confirming && selected && (
        <div className="authoring-confirmation" role="alertdialog" aria-label="Delete note confirmation" aria-describedby={deleteId}>
          <p id={deleteId}>Delete {pitchName(selected.pitch)} at {selected.start.toFixed(3)} seconds? Other notes will stay in place.</p>
          <div className="authoring-actions">
            <button type="button" className="button light" ref={cancelDelete} onClick={() => { setPendingDelete(null); setMessage("Deletion canceled."); }}>Keep note</button>
            <button type="button" className="button authoring-delete" onClick={confirmDelete}>Delete this note</button>
          </div>
        </div>
      )}
      {error && <p className="authoring-error" id={errorId} role="alert">{error}</p>}
      {message && <p className="authoring-status" role="status">{message}</p>}
    </section>
  );
}
