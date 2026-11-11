import { useMemo, useRef, useState } from 'react';
import type { Song } from './music';
import type { NoteAuthoringChange } from './StudioNoteAuthoring';
import { editScoreSlot, scoreAuthoringSlots, type ScoreSlotEdit } from './musicxmlAuthoring';

export function StudioScoreAuthoring({ song, onChange }: { song: Song; onChange: (song: Song, change: NoteAuthoringChange) => void }) {
  const { slots, unavailable } = useMemo(() => {
    try { return { slots: scoreAuthoringSlots(song), unavailable: '' }; }
    catch (e) { return { slots: [], unavailable: e instanceof Error ? e.message : 'Source cannot be edited.' }; }
  }, [song]);
  const [source, setSource] = useState(song);
  const [selected, setSelected] = useState(slots[0]?.sourceId ?? '');
  const [beats, setBeats] = useState(String(slots[0]?.beats ?? 1));
  const [pitch, setPitch] = useState(String(song.notes.find(n => n.sourceNoteIds?.includes(slots[0]?.sourceId))?.pitch ?? 60));
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const deleted = useRef<Song | null>(null);
  const [message, setMessage] = useState('');
  const slot = slots.find(s => s.sourceId === selected);
  const [draftSlot, setDraftSlot] = useState(selected);
  if (source !== song || draftSlot !== selected) {
    setSource(song); setDraftSlot(selected); setConfirm(false); setError('');
    if (!slot && slots[0]) setSelected(slots[0].sourceId);
    setBeats(String(slot?.beats ?? slots[0]?.beats ?? 1));
    setPitch(String(song.notes.find(n => n.sourceNoteIds?.includes(slot?.sourceId ?? ''))?.pitch ?? 60));
  }
  function apply(edit: ScoreSlotEdit) {
    if (edit.action === 'delete') {
      if (!confirm || deleted.current === song) return;
      deleted.current = song;
    }
    try {
      const next = editScoreSlot(song, selected, edit);
      onChange(next, { action: edit.action === 'duration' ? 'edit' : edit.action, noteId: null });
      setConfirm(false); setError(''); setMessage('Score and playback updated. Other notes stay in place. Save the song to keep changes.');
    } catch (e) { setConfirm(false); setError(e instanceof Error ? e.message : 'Unable to edit this slot.'); }
  }
  return <section className="studio-note-authoring" aria-label="MusicXML structural authoring">
    <h3>Add, delete & resize written notes</h3>
    {unavailable && <p role="alert">{unavailable}</p>}
    <p>Fill an explicit rest, replace a note with a rest, or change its duration using adjacent silence. Times stay fixed across both hands. Durations are quarter-note beats, not seconds.</p>
    <p>Plain independent notes only: chords, ties, grace/cue notes, beams, tuplets and complex attached notation or note attributes cannot be changed here. Simple fingerings are supported. Keep at least one sounding note. Use a notation editor for other passages.</p>
    <label>Written slot<select value={selected} onChange={e => { setSelected(e.target.value); setConfirm(false); setError(''); setMessage(''); }}>
      {slots.map(s => <option key={s.sourceId} value={s.sourceId}>Part {Number(s.sourceId.split(':')[0]) + 1}, measure {s.measure}, slot {Number(s.sourceId.split(':')[2]) + 1} · staff {s.staff}, voice {s.voice} · {s.rest ? 'rest' : 'note'} · {s.beats} beats</option>)}
    </select></label>
    {slot?.reason && <p>{slot.reason}</p>}
    <fieldset disabled={!slot || !!slot.reason || confirm}>
      <legend>{slot?.rest ? 'Fill selected rest' : 'Change selected note'}</legend>
      {slot?.rest && <label>New pitch (MIDI)<input type="number" min="0" max="127" step="1" value={pitch} onChange={e => setPitch(e.target.value)} /></label>}
      <label>Duration (quarter-note beats)<input type="number" min="0.0625" step="any" value={beats} onChange={e => setBeats(e.target.value)} /></label>
      <button type="button" className="button" onClick={() => apply(slot?.rest ? { action: 'insert', pitch: pitch.trim() ? Number(pitch) : NaN, beats: Number(beats) } : { action: 'duration', beats: Number(beats) })}>{slot?.rest ? 'Insert into rest' : 'Apply written duration'}</button>
      {!slot?.rest && <button type="button" className="button light" onClick={() => { deleted.current = null; setConfirm(true); setMessage(''); }}>Replace note with rest</button>}
    </fieldset>
    {confirm && <div role="alertdialog" aria-label="Replace note confirmation"><p>Replace this note with an equal-duration rest? Other notes will stay in place.</p><button type="button" className="button light" autoFocus onClick={() => setConfirm(false)}>Keep written note</button><button type="button" className="button" onClick={() => apply({ action: 'delete' })}>Confirm replace with rest</button></div>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
