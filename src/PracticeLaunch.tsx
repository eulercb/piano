import { useEffect, useRef } from "react";
import { ArrowRight, BookOpen, Hand, Headphones, Music2, Play, Volume2 } from "lucide-react";
import type { Song } from "./music";
import { formatTime, songDuration } from "./music";
import type { PracticeHand, PracticeMode } from "./session";
import "./practiceLaunch.css";

export function PracticeLaunch({ song, dirty, hand, mode, speed, countIn, muted, repeat, metronome, onHand, onMode, onSpeed, onCountIn, onMute, onStart, onLibrary, onPrepare }: {
  song: Song; dirty: boolean; hand: PracticeHand; mode: PracticeMode; speed: number; countIn: boolean; muted: boolean; repeat: boolean; metronome: boolean;
  onHand: (hand: PracticeHand) => void; onMode: (mode: PracticeMode) => void; onSpeed: (speed: number) => void;
  onCountIn: (value: boolean) => void; onMute: () => void; onStart: () => void; onLibrary: () => void; onPrepare: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const modeName = mode === "listen" ? "Listen" : mode === "melody" ? "Wait for notes" : mode === "rhythm" ? "Rhythm" : "Recital";
  const hasNotes = song.notes.some(note => hand === "both" || note.hand === hand);
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
        <p className="launch-tip">A few comfortable notes are a good place to begin.</p>
      </section>
      <div className="launch-choices">
        <fieldset><legend><span className="launch-step">02 · YOUR FIRST HAND</span>Which hand will you practise?</legend>
          <div className="launch-hand-options">{([['left', 'Left hand'], ['right', 'Right hand'], ['both', 'Both hands']] as const).map(([id, label]) => {
            const available = song.notes.some(note => id === 'both' || note.hand === id);
            return <button key={id} className="launch-choice" aria-pressed={hand === id} disabled={!available} onClick={() => onHand(id)}><Hand size={22} /><strong>{label}</strong><small>{available ? id === 'both' ? 'Bring them together' : 'One part at a time' : 'No notes in this part'}</small></button>;
          })}</div>
        </fieldset>
        <fieldset><legend><span className="launch-step">03 · YOUR CHALLENGE</span>How would you like to play?</legend>
          <div className="launch-mode-options">{([
            ['listen', 'Listen & explore', 'Hear your chosen part before you try.'],
            ['melody', 'Wait for notes', 'The music waits while you find each note.'],
            ['rhythm', 'Find the rhythm', 'Keep moving with gentle timing feedback.'],
            ['recital', 'Play a recital', 'Play through, then review your timing.'],
          ] as const).map(([id, label, detail]) => <button key={id} className="launch-choice" aria-pressed={mode === id} onClick={() => onMode(id)}>{id === 'listen' ? <Headphones size={20} /> : <Music2 size={20} />}<span><strong>{label}</strong><small>{detail}</small></span></button>)}</div>
        </fieldset>
        <fieldset className="launch-pace"><legend><span className="launch-step">04 · YOUR PACE</span>Slow is a great start.</legend>
          <label htmlFor="launch-speed">Practice speed <strong>{speed}%</strong></label><input id="launch-speed" aria-label="Practice speed" type="range" min="25" max="125" step="5" value={speed} onChange={event => onSpeed(Number(event.target.value))} />
          <div className="launch-speeds">{[25, 50, 75, 100].map(value => <button key={value} aria-pressed={speed === value} onClick={() => onSpeed(value)}>{value}%{value === 50 && <small>Gentle start</small>}</button>)}</div>
          <label className="launch-count"><input type="checkbox" checked={countIn} onChange={event => onCountIn(event.target.checked)} /> Count in 4 beats</label>
        </fieldset>
      </div>
    </div>
    <div className="launch-start"><div><strong>{hand === 'both' ? 'Both hands' : hand === 'left' ? 'Left hand' : 'Right hand'} · {speed}% speed · {modeName}</strong><p>{mode === 'listen' ? 'Listen to your chosen part.' : 'No piano nearby? Try the on-screen keys or A–; demo.'} {countIn ? 'Four beats to get ready.' : 'Starts from the beginning.'}</p>{(repeat || metronome) && <p>{repeat ? "Repeat is on. " : ""}{metronome ? "Metronome is on. " : ""}Change these in the room’s Setup.</p>}{!hasNotes && <p role="status">No notes for this hand. Choose another hand or piece.</p>}</div><button className="room-button" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={onMute}><Volume2 size={20} />{muted ? 'Sound off' : 'Sound on'}</button><button className="button launch-start-button" disabled={!hasNotes} onClick={onStart}><Play size={20} /> Start practice <ArrowRight size={18} /></button></div>
  </section>;
}
