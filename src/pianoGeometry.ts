import type { Note } from "./music";

export type PianoKeyGeometry = {
  pitch: number;
  black: boolean;
  /** Percentages of the same full-width surface for keys, lanes and notes. */
  left: number;
  width: number;
};

const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
const BLACK_KEY_WIDTH = 0.64;
export const ROLL_LOOKAHEAD_SECONDS = 4.1;

/** White keys tile the whole surface. Accidentals overlay their shared edges.
 * Extend accidental endpoints to white keys so neither overlay is clipped.
 * Inputs are inclusive MIDI pitches, in the validated range 0–127. */
export function pianoKeyGeometry(low: number, high: number): PianoKeyGeometry[] {
  const first = isBlack(low) ? low - 1 : low;
  const last = isBlack(high) ? high + 1 : high;
  const pitches = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const whiteCount = pitches.filter(pitch => !isBlack(pitch)).length;
  let whites = 0;
  return pitches.map(pitch => {
    const black = isBlack(pitch);
    const left = black ? whites - BLACK_KEY_WIDTH / 2 : whites++;
    return { pitch, black, left: left / whiteCount * 100,
      width: (black ? BLACK_KEY_WIDTH : 1) / whiteCount * 100 };
  });
}

/** Both onset and duration use the live roll height. At onset the note's lower
 * edge is exactly at its bottom: the shared roll/keyboard boundary. Percentages
 * respond to rotation, browser bars and notices without stale pixel measures. */
export function fallingNoteGeometry(note: Pick<Note, "start" | "duration">, time: number) {
  return {
    bottom: (note.start - time) / ROLL_LOOKAHEAD_SECONDS * 100,
    height: note.duration / ROLL_LOOKAHEAD_SECONDS * 100,
  };
}
