import type { Song } from "./music";
import { midiTempoSegments } from "./midiTempo";
import { scoreTempoMap } from "./scoreTempo";

/** Source-linked XML is authoritative. Reference XML never supplies timing. */
export function songTempoMap(song: Song) {
  if (song.scoreOrigin === "musicxml") return scoreTempoMap(song);
  try { return midiTempoSegments(song); }
  catch { return undefined; } // Invalid in-memory metadata cannot disable playback.
}
