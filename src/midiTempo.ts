import type { Song } from "./music";
import type { TempoSegment } from "./metronome";

/** MIDI quarter-note tempo anchored to the same seconds timeline as the notes.
 * Beats are derived, not persisted. Absence means the original map is unknown.
 */
export type MidiTempoChange = { seconds: number; microsecondsPerQuarter: number };
export const MAX_MIDI_TEMPO_CHANGES = 10000;
export const MIN_MIDI_MICROSECONDS = 6000; // Existing project limit: 10,000 BPM.
export const MAX_MIDI_MICROSECONDS = 0xffffff;
const MAX_SECONDS = 86400;
const invalid = (reason: string): never => { throw Error(`Invalid MIDI tempo map: ${reason}`); };

/** Strict, linear validation of untrusted optional project/library metadata. */
export function normalizeMidiTempoMap(value: unknown, tempo: number, duration: unknown): MidiTempoChange[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MIDI_TEMPO_CHANGES)
    return invalid("provide 1–10,000 changes.");
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > MAX_SECONDS)
    return invalid("an explicit duration within 24 hours is required.");
  const result: MidiTempoChange[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid("each change must be an object.");
    const { seconds, microsecondsPerQuarter } = entry;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > duration)
      return invalid("change times must be finite and within the song duration.");
    if (!Number.isInteger(microsecondsPerQuarter) || microsecondsPerQuarter < MIN_MIDI_MICROSECONDS || microsecondsPerQuarter > MAX_MIDI_MICROSECONDS)
      return invalid("quarter-note tempo must be an integer from 6,000 to 16,777,215 microseconds.");
    const previous = result.at(-1);
    if (previous ? seconds <= previous.seconds : seconds !== 0)
      return invalid("start at zero with strictly increasing change times.");
    if (previous?.microsecondsPerQuarter === microsecondsPerQuarter)
      return invalid("consecutive identical tempos are not canonical.");
    result.push({ seconds, microsecondsPerQuarter });
  }
  if (tempo !== 60000000 / result[0].microsecondsPerQuarter)
    return invalid("the first change must match the song's starting tempo.");
  return result;
}

/** Retiming a note does not retime the piece's tempo schedule. */
export function midiTempoSegments(song: Song): TempoSegment[] | undefined {
  if (song.scoreOrigin === "musicxml" || song.midiTempoMap === undefined) return;
  const map = normalizeMidiTempoMap(song.midiTempoMap, song.tempo, song.duration);
  let beat = 0;
  return map.map((entry, i) => {
    if (i) beat += (entry.seconds - map[i - 1].seconds) * 1000000 / map[i - 1].microsecondsPerQuarter;
    return { beat, seconds: entry.seconds, bpm: 60000000 / entry.microsecondsPerQuarter };
  });
}

/** Half-open trim: inherit tempo at start, retain interior changes, rebase. */
export function trimMidiTempoMap(song: Song, start: number, end: number): MidiTempoChange[] | undefined {
  if (song.midiTempoMap === undefined) return;
  const map = normalizeMidiTempoMap(song.midiTempoMap, song.tempo, song.duration);
  let active = map[0];
  for (const entry of map) {
    if (entry.seconds > start) break;
    active = entry;
  }
  return [{ seconds: 0, microsecondsPerQuarter: active.microsecondsPerQuarter },
    ...map.filter(entry => entry.seconds > start && entry.seconds < end)
      .map(entry => ({ ...entry, seconds: entry.seconds - start }))];
}
