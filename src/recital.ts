import type { Note } from "./music";
import type { TimingGrade } from "./session";

const EPSILON = 1e-8;
type Target = { id: string; pitch: number; time: number };
type Press = { pitch: number; time: number };

/**
 * Assess a completed attempt, using active real seconds rather than song time.
 * Match presses in performance order to the closest still-unanswered pitch
 * within the beginner window. Equal-distance ties prefer the earlier onset.
 * One press satisfies a doubled unison, never a later repetition. This grades
 * pitch/onset only: note duration, release, velocity and pedal are not inputs.
 */
export function assessRecital(
  targets: readonly Target[],
  presses: readonly Press[],
  window: number,
  onTimeWindow: number,
): { grades: Map<string, TimingGrade>; extra: number } {
  type Onset = { time: number; ids: string[]; matched: boolean };
  const byPitch = new Map<number, Onset[]>();
  for (const target of [...targets].sort((a, b) => a.time - b.time)) {
    const onsets = byPitch.get(target.pitch) ?? [];
    const previous = onsets.at(-1);
    if (previous && Math.abs(previous.time - target.time) < EPSILON)
      previous.ids.push(target.id);
    else onsets.push({ time: target.time, ids: [target.id], matched: false });
    byPitch.set(target.pitch, onsets);
  }
  const grades = new Map<string, TimingGrade>();
  let extra = 0;
  for (const press of [...presses].sort((a, b) => a.time - b.time)) {
    const onsets = byPitch.get(press.pitch) ?? [];
    // Only inspect onsets in the timing window, not the whole piece per press.
    let low = 0, high = onsets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (onsets[middle].time < press.time - window - EPSILON) low = middle + 1;
      else high = middle;
    }
    let candidate: Onset | undefined;
    for (let index = low; index < onsets.length; index++) {
      const onset = onsets[index];
      if (onset.time > press.time + window + EPSILON) break;
      if (!onset.matched && (!candidate ||
        Math.abs(onset.time - press.time) < Math.abs(candidate.time - press.time) - EPSILON))
        candidate = onset;
    }
    if (!candidate) { extra++; continue; }
    candidate.matched = true;
    const offset = press.time - candidate.time;
    const grade: TimingGrade = Math.abs(offset) <= onTimeWindow + EPSILON
      ? "on-time" : offset < 0 ? "early" : "late";
    for (const id of candidate.ids) grades.set(id, grade);
  }
  for (const target of targets) {
    if (!grades.has(target.id)) grades.set(target.id, "missed");
  }
  return { grades, extra };
}

/**
 * Private per-pass recording. Expected onset times are learned as the transport
 * crosses them, so an early press is assessed against the speed actually used
 * before the onset, even when speed changes after that press. Paused/count-in
 * time never reaches this clock. Discard this object on seek, restart or loop.
 */
export class RecitalAttempt {
  private readonly notes: Note[];
  private readonly targets: Target[] = [];
  private readonly presses: Press[] = [];
  private next = 0;
  private elapsed = 0;
  private position: number;

  constructor(
    notes: readonly Note[],
    startAt: number,
    private readonly window: number,
    private readonly onTimeWindow: number,
  ) {
    this.notes = notes.filter((note) => note.start >= startAt).sort((a, b) => a.start - b.start);
    this.position = startAt;
    this.advance(0, 1);
  }

  /** sourceSeconds is the distance advanced in the source piece; scale is speed / 100. */
  advance(sourceSeconds: number, scale: number) {
    const end = this.position + sourceSeconds;
    while (this.next < this.notes.length && this.notes[this.next].start <= end) {
      const note = this.notes[this.next++];
      this.targets.push({
        id: note.id, pitch: note.pitch,
        time: this.elapsed + (note.start - this.position) / scale,
      });
    }
    this.elapsed += sourceSeconds / scale;
    this.position = end;
  }

  press(pitch: number) {
    this.presses.push({ pitch, time: this.elapsed });
  }

  /** Full real-time late window, including when speed changes after the final onset. */
  endPosition(scale: number) {
    if (this.next < this.notes.length) return Infinity;
    const last = this.targets.at(-1);
    return last
      ? this.position + (last.time + this.window + EPSILON * 2 - this.elapsed) * scale
      : -Infinity;
  }

  finish() {
    return assessRecital(this.targets, this.presses, this.window, this.onTimeWindow);
  }
}
