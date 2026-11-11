import type { Note, Song } from "./music";

/** Match the project format's limits, so every successful edit can be saved. */
export const NOTE_AUTHORING_LIMITS = {
  minPitch: 0,
  maxPitch: 127,
  maxSeconds: 24 * 60 * 60,
  maxNotes: 100_000,
} as const;

export type NoteInput = Pick<Note, "pitch" | "start" | "duration" | "hand"> &
  Partial<Pick<Note, "velocity" | "finger">>;
export type NotePatch = Partial<Pick<Note, "pitch" | "start" | "duration" | "velocity" | "hand" | "finger">>;
export type NoteAuthoringAvailability = { allowed: boolean; reason?: string; warning?: string };

/** Structural source-score editing needs notation/voice/tie repair, not just MIDI changes. */
export function noteAuthoringAvailability(song: Song): NoteAuthoringAvailability {
  if (song.scoreOrigin === "musicxml" || song.notes.some(note => note.sourceNoteIds?.length)) {
    return {
      allowed: false,
      reason: "Adding, deleting or retiming MusicXML notes is not supported yet. Use the score-linked pitch, hand and finger controls, or edit the original score and import it again. This keeps the score and playback together.",
    };
  }
  return {
    allowed: true,
    ...(song.scoreXml ? { warning: "The attached score is a reference only. Note edits change playback and the Piano project, but do not update that score." } : {}),
  };
}

function validateNote(note: NoteInput) {
  if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127)
    throw Error("Pitch must be a whole MIDI number from 0 to 127 (middle C is 60).");
  if (!Number.isFinite(note.start) || note.start < 0 || note.start > NOTE_AUTHORING_LIMITS.maxSeconds)
    throw Error("Start must be a number from zero to 86,400 seconds.");
  if (!Number.isFinite(note.duration) || note.duration <= 0 || note.start + note.duration > NOTE_AUTHORING_LIMITS.maxSeconds)
    throw Error("Duration must be greater than zero and the note must end within 24 hours.");
  if (!Number.isFinite(note.velocity) || note.velocity! < 0 || note.velocity! > 1)
    throw Error("Velocity must be a number from 0 to 1.");
  if (note.hand !== "left" && note.hand !== "right")
    throw Error("Choose the left or right hand.");
  if (note.finger !== undefined && (!Number.isInteger(note.finger) || note.finger < 1 || note.finger > 5))
    throw Error("Finger must be a whole number from 1 to 5, or unspecified.");
}

function editableNoteIds(song: Song): Set<string> {
  const availability = noteAuthoringAvailability(song);
  if (!availability.allowed) throw Error(availability.reason);
  if (song.notes.length > NOTE_AUTHORING_LIMITS.maxNotes)
    throw Error("A song can contain at most 100,000 notes.");
  if (song.duration !== undefined && (!Number.isFinite(song.duration) || song.duration < 0 || song.duration > NOTE_AUTHORING_LIMITS.maxSeconds))
    throw Error("Song duration must be between zero and 24 hours.");
  const ids = new Set<string>();
  for (const note of song.notes) {
    if (typeof note.id !== "string" || !note.id || note.id.length > 200 || ids.has(note.id))
      throw Error("Note IDs must be unique. Reimport this MIDI or Piano project before editing.");
    ids.add(note.id);
    validateNote(note);
  }
  return ids;
}

function withNotes(song: Song, notes: Note[]): Song {
  // Stable sorting preserves the order of existing unison chord notes.
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const end = notes.reduce((value, note) => Math.max(value, note.start + note.duration), 0);
  return {
    ...song,
    notes,
    // Do not cut away explicitly saved trailing silence when shortening/deleting.
    ...(song.duration === undefined ? {} : { duration: Math.max(song.duration, end) }),
  };
}

/** Insert without shifting existing notes. IDs are deterministic and collision-free. */
export function insertNote(song: Song, input: NoteInput): Song {
  const ids = editableNoteIds(song);
  if (song.notes.length >= NOTE_AUTHORING_LIMITS.maxNotes)
    throw Error("A song can contain at most 100,000 notes. Delete a note before adding another.");
  let suffix = 1;
  while (ids.has(`studio-note-${suffix}`)) suffix++;
  const note: Note = {
    id: `studio-note-${suffix}`,
    pitch: input.pitch,
    start: input.start,
    duration: input.duration,
    hand: input.hand,
    velocity: input.velocity === undefined ? 0.72 : input.velocity,
    ...(input.finger === undefined ? {} : { finger: input.finger }),
  };
  validateNote(note);
  return withNotes(song, [...song.notes, note]);
}

/** Apply an atomic patch. An explicit finger: undefined clears the fingering. */
export function editNote(song: Song, noteId: string, patch: NotePatch): Song {
  const ids = editableNoteIds(song);
  if (!ids.has(noteId)) throw Error("This note no longer exists. Choose a note again.");
  const allowed = ["pitch", "start", "duration", "velocity", "hand", "finger"];
  if (Object.keys(patch).some(key => !allowed.includes(key)))
    throw Error("Only pitch, start, duration, velocity, hand and finger can be edited.");
  if (!Object.keys(patch).length) return song;
  const updated = { ...song.notes.find(note => note.id === noteId)!, ...patch };
  validateNote(updated);
  if (updated.finger === undefined) delete updated.finger;
  return withNotes(song, song.notes.map(note => note.id === noteId ? updated : note));
}

/** The caller must obtain explicit confirmation before calling this from the UI. */
export function deleteNote(song: Song, noteId: string): Song {
  const ids = editableNoteIds(song);
  if (!ids.has(noteId)) throw Error("This note no longer exists. Choose a note again.");
  return withNotes(song, song.notes.filter(note => note.id !== noteId));
}
