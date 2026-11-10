import type { Note, Song } from "./music";
import { parseMusicXml } from "./musicxml";

const MAX_NOTES = 100000;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_SCORE_BYTES = 5 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
const invalid = (reason: string): never => {
  throw new Error(`Invalid Piano project: ${reason}`);
};

/** Validate untrusted imported or persisted data. Returns fresh, chronological notes.
 * Existing unique IDs, hands, fingerings and source notation are preserved.
 * Missing/duplicate note IDs are regenerated together, before sorting.
 * Empty songs are allowed so a deliberately empty trimmed passage can be saved.
 */
export function normalizeSong(value: unknown): Song {
  if (!record(value)) return invalid("song must be an object.");
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 500
  )
    return invalid("choose a title of 1–500 characters.");
  if (!finite(value.tempo) || value.tempo <= 0 || value.tempo > 10000)
    return invalid("tempo must be positive and at most 10,000 BPM.");
  if (!Array.isArray(value.notes) || value.notes.length > MAX_NOTES)
    return invalid("a song can contain at most 100,000 notes.");
  if (
    value.scoreXml !== undefined &&
    (typeof value.scoreXml !== "string" ||
      new TextEncoder().encode(value.scoreXml).byteLength > MAX_SCORE_BYTES)
  )
    return invalid("score must be a MusicXML string no larger than 5 MiB.");
  if (value.duration !== undefined && (!finite(value.duration) || value.duration < 0 || value.duration > MAX_SECONDS))
    return invalid("song duration must be between zero and 24 hours.");
  const ids = new Set<string>();
  const preserveIds = value.notes.every((note) => {
    if (!record(note) || !validId(note.id) || ids.has(note.id)) return false;
    ids.add(note.id);
    return true;
  });
  const notes: Note[] = value.notes.map((item, index) => {
    if (!record(item)) return invalid(`note ${index + 1} must be an object.`);
    if (
      !finite(item.pitch) ||
      !Number.isInteger(item.pitch) ||
      item.pitch < 0 ||
      item.pitch > 127
    )
      return invalid(
        `note ${index + 1} needs a whole MIDI pitch from 0 to 127.`,
      );
    if (
      !finite(item.start) ||
      item.start < 0 ||
      !finite(item.duration) ||
      item.duration <= 0 ||
      item.start + item.duration > MAX_SECONDS
    )
      return invalid(`note ${index + 1} needs valid timing within 24 hours.`);
    if (!finite(item.velocity) || item.velocity < 0 || item.velocity > 1)
      return invalid(`note ${index + 1} needs velocity from 0 to 1.`);
    if (item.hand !== "left" && item.hand !== "right")
      return invalid(`note ${index + 1} needs a left or right hand.`);
    if (
      item.finger !== undefined &&
      (!finite(item.finger) ||
        !Number.isInteger(item.finger) ||
        item.finger < 1 ||
        item.finger > 5)
    )
      return invalid(
        `note ${index + 1} needs a finger from 1 to 5, or no finger.`,
      );
    return {
      id: preserveIds ? (item.id as string) : `n${index}`,
      pitch: item.pitch,
      start: item.start,
      duration: item.duration,
      velocity: item.velocity,
      hand: item.hand,
      ...(item.finger === undefined ? {} : { finger: item.finger as number }),
    };
  });
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  if (value.scoreOrigin === "musicxml") {
    if (typeof value.scoreXml !== "string")
      return invalid("editable MusicXML source is missing.");
    const parsed = parseMusicXml(value.scoreXml).song;
    return {
      ...parsed,
      id: validId(value.id) ? value.id : crypto.randomUUID(),
      title: value.title.trim(),
    };
  }
  const noteEnd = notes.reduce((end, note) => Math.max(end, note.start + note.duration), 0);
  if (finite(value.duration) && value.duration + 1e-7 < noteEnd)
    return invalid("song duration cannot end before its notes.");
  return {
    id: validId(value.id) ? value.id : crypto.randomUUID(),
    title: value.title.trim(),
    tempo: value.tempo,
    notes,
    ...(value.duration === undefined ? {} : { duration: value.duration as number }),
    ...(value.scoreXml === undefined
      ? {}
      : { scoreXml: value.scoreXml as string }),
  };
}

/** Parse a version-1 .piano.json string; does not mutate library or playback state. */
export function parseProject(text: string): Song {
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024)
    return invalid("project must be smaller than 10 MiB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid("file is not valid JSON.");
  }
  if (!record(value) || value.version !== 1)
    return invalid("unsupported project version.");
  return normalizeSong(value.song);
}
