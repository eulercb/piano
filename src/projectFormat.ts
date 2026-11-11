import type { Song } from "./music";

export const MAX_PROJECT_BYTES = 10 * 1024 * 1024;

/** Optional MIDI metadata is additive in v1. Older readers retain playable note
 * seconds but can discard that metadata. Keep legacy recovery exports unchanged.
 */
export function serializeProject(song: Song): string {
  const text = JSON.stringify({ version: 1, song });
  if (song.midiTempoMap !== undefined && new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES)
    throw Error("This project with MIDI tempo changes exceeds the 10 MiB import limit. Keep the original MIDI or export a smaller passage.");
  return text;
}
