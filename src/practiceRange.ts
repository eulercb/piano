import type { Note } from "./music";

/** Temporary source-time window, inclusive at the start and exclusive at the end. */
export type PracticeRange = { start: number; end: number };

export function practiceRangeError(range: PracticeRange, duration: number): string | undefined {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end))
    return "Enter both a start and an end time in seconds.";
  if (range.start >= range.end) return "The end must be after the start.";
  if (!Number.isFinite(duration) || range.start < 0 || range.end > duration)
    return "Choose start and end times within this piece.";
}

export function isPracticeRange(range: PracticeRange, duration: number): boolean {
  return practiceRangeError(range, duration) === undefined;
}

/** A held note that started before this window is not a new attack. */
export function noteStartsInRange(note: Pick<Note, "start">, range?: PracticeRange): boolean {
  return !range || (note.start >= range.start && note.start < range.end);
}

/** Show source-time endpoints precisely enough to distinguish short intervals. */
export function formatPracticeInterval(start: number, end: number): string {
  const from = Math.round(start * 1000), to = Math.round(end * 1000);
  if (start < end && from === to) return `${start} s–${end} s`;
  const format = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const fraction = milliseconds % 1000;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${
      fraction ? `.${String(fraction).padStart(3, "0")}` : ""
    }`;
  };
  return `${format(from)}–${format(to)}`;
}
