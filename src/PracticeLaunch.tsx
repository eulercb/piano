import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, BookOpen, Hand, Headphones, Music2, Play, Volume2 } from "lucide-react";
import type { Song } from "./music";
import { formatTime, songDuration } from "./music";
import type { PracticeHand, PracticeMode } from "./session";
import { noteStartsInRange, practiceRangeError, type PracticeRange } from "./practiceRange";
import "./practiceLaunch.css";

type RangeDraft = {
  song: Song;
  expectedRange?: PracticeRange;
  start: string;
  end: string;
};

const equalRange = (a?: PracticeRange, b?: PracticeRange) =>
  a === b || (!!a && !!b && a.start === b.start && a.end === b.end);
const readSeconds = (value: string) => value.trim() === "" ? NaN : Number(value);

export function PracticeLaunch({ song, dirty, hand, mode, speed, countIn, muted, repeat, metronome, range, onRange, onHand, onMode, onSpeed, onCountIn, onMute, onStart, onLibrary, onPrepare }: {
  song: Song; dirty: boolean; hand: PracticeHand; mode: PracticeMode; speed: number; countIn: boolean; muted: boolean; repeat: boolean; metronome: boolean;
  range?: PracticeRange; onRange?: (range?: PracticeRange) => void;
  onHand: (hand: PracticeHand) => void; onMode: (mode: PracticeMode) => void; onSpeed: (speed: number) => void;
  onCountIn: (value: boolean) => void; onMute: () => void; onStart: () => void; onLibrary: () => void; onPrepare: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const modeName = mode === "listen" ? "Listen" : mode === "melody" ? "Wait for notes" : mode === "rhythm" ? "Rhythm" : "Recital";
  const duration = songDuration(song);
  const half = { start: 0, end: duration / 2 };
  const helpId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<RangeDraft | null>(null);
  // Keep in-progress text only while editing the same source and committed range.
  // The expected range includes this editor's last accepted change.
  const currentDraft = draft && draft.song === song && equalRange(draft.expectedRange, range) ? draft : null;
  if (draft && !currentDraft) setDraft(null);
  const rangeMode = currentDraft ? "custom" : !range ? "whole" : equalRange(range, half) ? "half" : "custom";
  const start = currentDraft?.start ?? String(range?.start ?? 0);
  const end = currentDraft?.end ?? String(range?.end ?? duration);
  const customRange = { start: readSeconds(start), end: readSeconds(end) };
  const rangeError = onRange && rangeMode === "custom" ? practiceRangeError(customRange, duration) : undefined;
  const selectedRange = onRange ? range : undefined;
  const displayedRange = rangeMode === "custom" ? customRange : selectedRange;
  const rangeNotes = song.notes.filter(note => noteStartsInRange(note, selectedRange));
  const selectedCount = rangeNotes.filter(note => hand === "both" || note.hand === hand).length;
  const hasNotes = selectedCount > 0;
  function updateDraft(nextStart: string, nextEnd: string) {
    const next = { start: readSeconds(nextStart), end: readSeconds(nextEnd) };
    const valid = !practiceRangeError(next, duration);
    const committed = valid ? (next.start === 0 && next.end === duration ? undefined : next) : range;
    setDraft({ song, expectedRange: committed, start: nextStart, end: nextEnd });
    if (valid && !equalRange(committed, range)) onRange?.(committed);
  }
  return <section className="practice-launch" aria-labelledby="launch-title">
    <div className="launch-intro"><span className="eyebrow">YOUR NEXT SMALL STEP</span><h1 id="launch-title" ref={titleRef} tabIndex={-1}>Let’s play a little.</h1><p>Choose your challenge. Take your time. Make it yours.</p></div>
    <div className="launch-layout">
      <section className="launch-piece" aria-label="Selected practice piece">
        <div className="launch-art" aria-hidden="true"><Music2 size={54} /><span>♪</span><i>♩</i></div>
        <span className="launch-step">01 · YOUR PIECE</span><h2>{song.title}</h2>
        <p>{song.notes.length} notes · {formatTime(songDuration(song))} at original speed</p>
        {dirty && <p className="launch-draft">Practising your unsaved draft. Your original stays unchanged.</p>}
        <button className="button light" onClick={onLibrary}>Choose another piece</button>
        <button className="launch-text-button" onClick={onPrepare}><BookOpen size={16} /> Prepare a shorter passage</button>
        <p className="launch-tip">{onRange ? "Open Studio to edit the piece. A practice range is temporary." : "A few comfortable notes are a good place to begin."}</p>
      </section>
      <div className="launch-choices">
        {onRange && <fieldset className="launch-range" aria-describedby={helpId}>
          <legend><span className="launch-step">02 · YOUR PASSAGE</span>What will you practise?</legend>
          <div className="launch-range-options">
            <button type="button" aria-pressed={rangeMode === "whole"} onClick={() => { setDraft(null); onRange(undefined); }}>Whole piece</button>
            <button type="button" aria-pressed={rangeMode === "half"} disabled={!!practiceRangeError(half, duration)} onClick={() => { setDraft(null); onRange(half); }}>First half</button>
            <button type="button" aria-pressed={rangeMode === "custom"} disabled={duration <= 0} onClick={() => {
              if (rangeMode !== "custom") setDraft({ song, expectedRange: range, start, end });
            }}>Custom time range</button>
          </div>
          <p id={helpId} className="launch-range-help">Times are in seconds at original speed. This does not trim or change the piece.</p>
          {rangeMode === "custom" && <div className="launch-range-fields">
            <label>Start (seconds)
              <input type="number" inputMode="decimal" step="any" min={0} max={duration} value={start}
                aria-invalid={rangeError ? true : undefined} aria-describedby={rangeError ? `${helpId} ${errorId}` : helpId}
                onChange={event => updateDraft(event.target.value, end)} />
            </label>
            <label>End (seconds)
              <input type="number" inputMode="decimal" step="any" min={0} max={duration} value={end}
                aria-invalid={rangeError ? true : undefined} aria-describedby={rangeError ? `${helpId} ${errorId}` : helpId}
                onChange={event => updateDraft(start, event.target.value)} />
            </label>
          </div>}
          <p id={errorId} className={rangeError ? "launch-range-error" : "launch-range-summary"} role="status">
            {rangeError || <>{displayedRange ? `${displayedRange.start}–${displayedRange.end} seconds` : "Whole piece"} · {selectedCount} {selectedCount === 1 ? "note" : "notes"} for the selected hand</>}
          </p>
        </fieldset>}
        <fieldset><legend><span className="launch-step">{onRange ? "03" : "02"} · YOUR FIRST HAND</span>Which hand will you practise?</legend>
          <div className="launch-hand-options">{([['left', 'Left hand'], ['right', 'Right hand'], ['both', 'Both hands']] as const).map(([id, label]) => {
            const available = rangeNotes.some(note => id === 'both' || note.hand === id);
            return <button key={id} className="launch-choice" aria-pressed={hand === id} disabled={!available} onClick={() => onHand(id)}><Hand size={22} /><strong>{label}</strong><small>{available ? id === 'both' ? 'Bring them together' : 'One part at a time' : 'No notes in this part'}</small></button>;
          })}</div>
        </fieldset>
        <fieldset><legend><span className="launch-step">{onRange ? "04" : "03"} · YOUR CHALLENGE</span>How would you like to play?</legend>
          <div className="launch-mode-options">{([
            ['listen', 'Listen & explore', 'Hear your chosen part before you try.'],
            ['melody', 'Wait for notes', 'The music waits while you find each note.'],
            ['rhythm', 'Find the rhythm', 'Keep moving with gentle timing feedback.'],
            ['recital', 'Play a recital', 'Play through, then review your timing.'],
          ] as const).map(([id, label, detail]) => <button key={id} className="launch-choice" aria-pressed={mode === id} onClick={() => onMode(id)}>{id === 'listen' ? <Headphones size={20} /> : <Music2 size={20} />}<span><strong>{label}</strong><small>{detail}</small></span></button>)}</div>
        </fieldset>
        <fieldset className="launch-pace"><legend><span className="launch-step">{onRange ? "05" : "04"} · YOUR PACE</span>Slow is a great start.</legend>
          <label htmlFor="launch-speed">Practice speed <strong>{speed}%</strong></label><input id="launch-speed" aria-label="Practice speed" type="range" min="25" max="125" step="5" value={speed} onChange={event => onSpeed(Number(event.target.value))} />
          <div className="launch-speeds">{[25, 50, 75, 100].map(value => <button key={value} aria-pressed={speed === value} onClick={() => onSpeed(value)}>{value}%{value === 50 && <small>Gentle start</small>}</button>)}</div>
          <label className="launch-count"><input type="checkbox" checked={countIn} onChange={event => onCountIn(event.target.checked)} /> Count in 4 beats</label>
        </fieldset>
      </div>
    </div>
    <div className="launch-start"><div><strong>{hand === 'both' ? 'Both hands' : hand === 'left' ? 'Left hand' : 'Right hand'} · {speed}% speed · {modeName}</strong><p>{mode === 'listen' ? 'Listen to your chosen part.' : 'No piano nearby? Try the on-screen keys or A–; demo.'} {countIn ? 'Four beats to get ready.' : selectedRange ? 'Starts at the selected time.' : 'Starts from the beginning.'}</p>{(repeat || metronome) && <p>{repeat ? "Repeat is on. " : ""}{metronome ? "Metronome is on. " : ""}Change these in the room’s Setup.</p>}{!rangeError && !hasNotes && <p role="status">{selectedRange
      ? rangeNotes.length ? "No notes for this hand in the range. Choose another hand or range." : "No notes start in this range. Choose another range."
      : "No notes for this hand. Choose another hand or piece."}</p>}</div><button className="room-button" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={onMute}><Volume2 size={20} />{muted ? 'Sound off' : 'Sound on'}</button><button className="button launch-start-button" disabled={!hasNotes || !!rangeError} onClick={onStart}><Play size={20} /> Start practice <ArrowRight size={18} /></button></div>
  </section>;
}
