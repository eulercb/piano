import { songDuration, type Song } from "./music";
import { parseMusicXml } from "./musicxml";
import { scorePlaybackMatches } from "./scoreCursor";
import type { TempoSegment } from "./metronome";

/** Runtime-only source metadata. Reference-only, stale or blocked XML is inert.
 * Older MIDI/projects have no recoverable tempo map and keep their starting BPM.
 * Re-deriving from source avoids changing project/library/bookmark formats.
 */
export function scoreTempoMap(song: Song): TempoSegment[] | undefined {
  if (song.scoreOrigin !== "musicxml" || !song.scoreXml) return;
  try {
    const parsed = parseMusicXml(song.scoreXml);
    const duration = songDuration(parsed.song);
    if (song.tempo !== parsed.song.tempo
      || Math.abs(songDuration(song) - duration) > 1e-7
      || !scorePlaybackMatches(parsed.song.notes, song.notes)) return;
    return parsed.tempoMap.filter(segment => segment.seconds <= duration);
  } catch {
    // Source failures must not disable otherwise valid, recoverable playback.
    return;
  }
}
