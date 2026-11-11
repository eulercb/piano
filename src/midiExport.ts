import type { Note, Song } from "./music";
import { normalizeMidiTempoMap } from "./midiTempo";
import { serializeProject } from "./projectFormat";

const PPQN = 32767; // Largest legal PPQN division, not SMPTE timing.
const MAX_SECONDS = 86400;
const MAX_EVENTS = 200000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DELTA = 0x0fffffff;
// One nanosecond only accommodates floating-point arithmetic, not MIDI drift.
const ROUNDING_ALLOWANCE = 1e-9;
const fail = (reason: string): never => { throw Error(`Cannot export MIDI with tempo changes: ${reason}`); };

type Boundary = { seconds: number; microsecondsPerQuarter: number; tick: number; realized: number };
type Event =
  | { kind: "tempo"; tick: number; target: number; microseconds: number }
  | { kind: "on" | "off"; tick: number; target: number; index: number }
  | { kind: "end"; tick: number; target: number };
const priority = (event: Event) => event.kind === "tempo" ? 0 : event.kind === "off" ? 1 : event.kind === "on" ? 2 : 3;

/** New mapped songs only. The legacy exporter deliberately keeps its old bytes.
 * Tempo values are exact; every emitted boundary/end point must be within half
 * the legacy starting-tempo tick of its authoritative seconds. Note durations
 * are consequently within one such tick. Unrepresentable inputs fail without
 * changing the song, flattening its map, or extending/collapsing its notes.
 */
export function exportMappedMidi(song: Song): Uint8Array {
  if (song.scoreOrigin === "musicxml") fail("a source MusicXML score cannot also have a MIDI tempo map.");
  const map = normalizeMidiTempoMap(song.midiTempoMap, song.tempo, song.duration);
  const duration = song.duration!;
  if (typeof song.title !== "string" || !song.title.trim() || song.title.length > 500)
    fail("choose a title of 1–500 characters.");
  if (!Array.isArray(song.notes) || !song.notes.length || song.notes.length > 100000)
    fail("a reimportable MIDI needs 1–100,000 playable notes.");
  if (map.length + 2 * song.notes.length + 3 > MAX_EVENTS)
    fail("the file would exceed the 200,000-event import limit.");
  for (const note of song.notes) {
    if (!note || ![note.start, note.duration, note.pitch, note.velocity].every(Number.isFinite)
      || note.start < 0 || note.duration <= 0 || !Number.isFinite(note.start + note.duration)
      || note.start + note.duration > duration || !Number.isInteger(note.pitch)
      || note.pitch < 0 || note.pitch > 127 || note.velocity < 0 || note.velocity > 1
      || (note.hand !== "left" && note.hand !== "right")) fail("the song contains an invalid note or duration.");
  }
  const tolerance = map[0].microsecondsPerQuarter / (480 * 1000000) / 2;
  const audit = (actual: number, target: number, subject: string) => {
    if (!Number.isFinite(actual) || Math.abs(actual - target) > tolerance + ROUNDING_ALLOWANCE)
      fail(`${subject} cannot retain its seconds within the starting-tempo MIDI resolution.`);
  };
  const denominator = PPQN * 1000000;
  const boundaries: Boundary[] = [{ ...map[0], tick: 0, realized: 0 }];
  let weightedTicks = 0;
  for (let i = 1; i < map.length; i++) {
    const previous = boundaries[i - 1], source = map[i];
    // Anchor to desired absolute seconds, not rounded source beat positions.
    // Subtracting the realized time compensates previous boundary rounding;
    // independent beat rounding would accumulate errors at tempo transitions.
    const delta = Math.round((source.seconds - previous.realized) * denominator / previous.microsecondsPerQuarter);
    const tick = previous.tick + delta;
    if (!Number.isSafeInteger(tick) || delta <= 0) fail("tempo changes are too close together for distinct MIDI ticks.");
    weightedTicks += delta * previous.microsecondsPerQuarter;
    // Within 24 hours this integer sum is below 2^53. Divide once per anchor
    // instead of accumulating floating-point segment durations here.
    if (!Number.isSafeInteger(weightedTicks)) fail("the tempo map exceeds MIDI timing limits.");
    const realized = weightedTicks / denominator;
    audit(realized, source.seconds, "A tempo change");
    boundaries.push({ ...source, tick, realized });
  }
  const tickAt = (seconds: number) => {
    let low = 0, high = boundaries.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (boundaries[middle].seconds <= seconds) low = middle;
      else high = middle;
    }
    const segment = boundaries[low], next = boundaries[low + 1];
    if (seconds === segment.seconds) return segment.tick;
    const tick = segment.tick + Math.round((seconds - segment.realized) * denominator / segment.microsecondsPerQuarter);
    // Do not move an endpoint across a source tempo boundary to hide rounding
    // error. Exact shared times use one tick; other unsupported cases fail.
    if (!Number.isSafeInteger(tick) || tick < segment.tick || (next && tick > next.tick))
      fail("a note or ending is too close to a tempo change for MIDI timing.");
    return tick;
  };
  const events: Event[] = boundaries.map(entry => ({ kind: "tempo", tick: entry.tick, target: entry.seconds, microseconds: entry.microsecondsPerQuarter }));
  for (let index = 0; index < song.notes.length; index++) {
    const note = song.notes[index], start = tickAt(note.start), end = tickAt(note.start + note.duration);
    if (end <= start) fail("a note is shorter than the available MIDI timing resolution.");
    events.push({ kind: "on", tick: start, target: note.start, index },
      { kind: "off", tick: end, target: note.start + note.duration, index });
  }
  const endTick = tickAt(duration);
  events.push({ kind: "end", tick: endTick, target: duration });
  events.sort((a, b) => a.tick - b.tick || priority(a) - priority(b)
    || ("index" in a && "index" in b ? song.notes[a.index].start - song.notes[b.index].start || a.index - b.index : 0));
  if (events.at(-1)?.kind !== "end") fail("the explicit ending precedes an exported event.");

  const track: number[] = [];
  const variable = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DELTA)
      fail("an event gap exceeds the MIDI timing limit; export a shorter passage or a Piano project.");
    const result = [value & 127];
    while ((value = Math.floor(value / 128))) result.unshift((value & 127) | 128);
    return result;
  };
  const text = (type: number, value: string) => {
    const bytes = new TextEncoder().encode(value);
    track.push(0, 255, type, ...variable(bytes.length));
    for (const byte of bytes) track.push(byte);
  };
  text(3, song.title); text(1, "PianoPractice:Hands:v1");

  // Audit the emitted order with the importer's actual floating-point clock
  // and FIFO pairing rules, not just independently rounded note positions.
  const active = new Map<string, { index: number; start: number }[]>();
  const restored: Note[] = [];
  const restoredMap: { seconds: number; microsecondsPerQuarter: number }[] = [];
  let previousTick = 0, seconds = 0, microseconds = 500000, emittedWeightedTicks = 0;
  for (const event of events) {
    const delta = event.tick - previousTick;
    track.push(...variable(delta));
    emittedWeightedTicks += delta * microseconds;
    if (!Number.isSafeInteger(emittedWeightedTicks)) fail("the output exceeds MIDI timing limits.");
    const exactSeconds = emittedWeightedTicks / denominator;
    seconds += delta * microseconds / denominator;
    previousTick = event.tick;
    const subject = event.kind === "tempo" ? "A tempo change" : event.kind === "end" ? "The song ending" : "A note endpoint";
    // Check both the MIDI's rational clock and our importer's accumulated clock.
    // Many note events can otherwise introduce floating-point integration drift.
    audit(exactSeconds, event.target, subject);
    audit(seconds, event.target, subject);
    if (event.kind === "tempo") {
      microseconds = event.microseconds;
      restoredMap.push({ seconds, microsecondsPerQuarter: microseconds });
      track.push(255, 81, 3, (microseconds >> 16) & 255, (microseconds >> 8) & 255, microseconds & 255);
    } else if (event.kind === "end") {
      if (seconds > MAX_SECONDS || exactSeconds > MAX_SECONDS) fail("the exported ending would exceed the 24-hour import limit.");
      track.push(255, 47, 0);
    } else {
      const note = song.notes[event.index], channel = note.hand === "left" ? 1 : 0;
      const key = `${channel}:${note.pitch}`, queue = active.get(key) ?? [];
      if (event.kind === "on") {
        if (queue.length >= 1024) fail("too many notes overlap at one hand and pitch.");
        queue.push({ index: event.index, start: seconds }); active.set(key, queue);
        track.push(144 | channel, note.pitch, Math.max(1, Math.round(note.velocity * 127)));
      } else {
        const pending = queue.shift();
        if (!pending || pending.index !== event.index)
          return fail("overlapping notes at the same hand and pitch would change individual durations.");
        const length = seconds - pending.start;
        if (!(length > 0) || Math.abs(length - note.duration) > 2 * (tolerance + ROUNDING_ALLOWANCE))
          fail("a note duration cannot retain the starting-tempo MIDI resolution.");
        restored.push({ id: `n${restored.length}`, pitch: note.pitch, start: pending.start,
          duration: length, velocity: Math.max(1, Math.round(note.velocity * 127)) / 127, hand: note.hand });
        track.push(128 | channel, note.pitch, 0);
      }
    }
    if (track.length + 22 > MAX_BYTES) fail("the output exceeds the 8 MiB MIDI import limit.");
  }
  if (restored.length !== song.notes.length || [...active.values()].some(queue => queue.length))
    fail("not every note could be retained.");
  restored.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  // The importer requires every newly mapped song to have a readable backup.
  // Its random UUID always has this length; no user song fields are rewritten.
  serializeProject({ id: "midi-00000000-0000-0000-0000-000000000000", title: song.title.trim(),
    tempo: song.tempo, notes: restored, duration: seconds, midiTempoMap: restoredMap });
  const length = track.length, output = new Uint8Array(22 + length);
  output.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, PPQN >> 8, PPQN & 255,
    77, 84, 114, 107, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255]);
  output.set(track, 22);
  return output;
}
