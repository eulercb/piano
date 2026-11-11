import type { Note } from "./music";
import { matchMelodyPitch, melodyPosition } from "./practice";
import { SteadyMetronome } from "./metronome";
import { RecitalAttempt } from "./recital";

export type PracticeMode = "listen" | "melody" | "rhythm" | "recital";
export type PracticeHand = "left" | "right" | "both";
export type TimingGrade = "on-time" | "early" | "late" | "missed";
export type RhythmFeedback = {
  kind: TimingGrade | "extra";
  pitch: number;
  offsetMs?: number;
};
export type NoteStartCounts = {
  total: number;
  onTime: number;
  early: number;
  late: number;
  missed: number;
};
/** Saved score assignments, never a claim about which physical hand played. */
export type WrittenHandSummary = { left: NoteStartCounts; right: NoteStartCounts };
export type RhythmSummary = NoteStartCounts & {
  extra: number;
};
export type SessionOptions = {
  notes: Note[];
  duration: number;
  tempo: number;
  hand: PracticeHand;
  mode: PracticeMode;
  countIn: boolean;
  metronome?: boolean;
};

// Windows are in real seconds, not source-song time. Slower playback must not
// make the same physical timing error seem more accurate.
export const RHYTHM_WINDOW = 0.3;
export const ON_TIME_WINDOW = 0.1;
export const MAX_FRAME_GAP = 0.25;
const EPSILON = 1e-8;

/** RAF timestamps can precede an input callback already handled in that frame. */
export function frameTime(previousTimestamp: number, now: number) {
  const timestamp = Math.max(previousTimestamp, now);
  return { timestamp, seconds: (timestamp - previousTimestamp) / 1000 };
}

/** Transport and practice state, independent of React, audio, and MIDI hardware. */
export class PracticeSession {
  readonly notes: Note[];
  readonly matched = new Set<string>();
  readonly sounded = new Set<string>();
  readonly grades = new Map<string, TimingGrade>();
  readonly options: SessionOptions;
  position: number;
  running = false;
  completed = false;
  pass = 1;
  extra = 0;
  feedback?: RhythmFeedback;
  previousResult?: RhythmSummary;
  /** Completed written-part counts only; current attempts remain unpublished. */
  writtenHands?: WrittenHandSummary;
  previousWrittenHands?: WrittenHandSummary;
  private startAt: number;
  private countRemaining: number;
  private sentCountBeat = 0;
  private hasStarted = false;
  private recital?: RecitalAttempt;
  private readonly metronome: SteadyMetronome;

  constructor(options: SessionOptions, startAt = 0) {
    this.options = options;
    this.metronome = new SteadyMetronome(options.tempo);
    this.notes = options.notes
      .filter((n) => options.hand === "both" || n.hand === options.hand)
      .sort((a, b) => a.start - b.start);
    this.position = this.startAt = Math.max(0, Math.min(options.duration, startAt));
    this.countRemaining = options.countIn ? this.beatLength * 4 : 0;
    this.skipEarlierNotes();
    this.resetRecital();
  }

  private resetRecital() {
    this.recital = this.options.mode === "recital"
      ? new RecitalAttempt(this.notes, this.startAt, RHYTHM_WINDOW, ON_TIME_WINDOW)
      : undefined;
  }

  private get beatLength() {
    return 60 / this.options.tempo;
  }

  get countingIn() {
    return this.countRemaining > EPSILON;
  }

  get countBeat() {
    return this.countingIn
      ? Math.min(4, 1 + Math.floor(4 - this.countRemaining / this.beatLength + EPSILON))
      : 0;
  }

  get summary(): RhythmSummary {
    const values = [...this.grades.values()];
    return {
      total: this.notes.filter((n) => n.start >= this.startAt).length,
      onTime: values.filter((v) => v === "on-time").length,
      early: values.filter((v) => v === "early").length,
      late: values.filter((v) => v === "late").length,
      missed: values.filter((v) => v === "missed").length,
      extra: this.extra,
    };
  }

  /** Called only at completion, after Recital publishes its end-only grades. */
  private summarizeWrittenHands(): WrittenHandSummary | undefined {
    if (this.options.hand !== "both" || (this.options.mode !== "rhythm" && this.options.mode !== "recital")) return;
    const empty = (): NoteStartCounts => ({ total: 0, onTime: 0, early: 0, late: 0, missed: 0 });
    const result = { left: empty(), right: empty() };
    for (const note of this.notes) {
      if (note.start < this.startAt) continue;
      const counts = result[note.hand], grade = this.grades.get(note.id);
      counts.total++;
      if (grade === "on-time") counts.onTime++;
      else if (grade) counts[grade]++;
    }
    return result;
  }

  start() {
    // A paused final late-hit window is still part of this attempt, even when
    // the visible progress bar has reached the written end of the piece.
    if (this.completed || (!this.hasStarted && this.position >= this.options.duration))
      this.restart();
    this.hasStarted = true;
    this.running = true;
  }

  pause() {
    this.running = false;
  }

  private skipEarlierNotes() {
    for (const note of this.options.notes) {
      if (note.start < this.startAt) {
        this.matched.add(note.id);
        this.sounded.add(note.id);
      }
    }
  }

  /** Restart also clears old chord matches, misses, count-in and pass results. */
  restart(startAt = 0) {
    this.running = false;
    this.completed = false;
    this.position = this.startAt = Math.max(0, Math.min(this.options.duration, startAt));
    this.countRemaining = this.options.countIn ? this.beatLength * 4 : 0;
    this.sentCountBeat = 0;
    this.metronome.reset();
    this.hasStarted = false;
    this.matched.clear();
    this.sounded.clear();
    this.grades.clear();
    this.feedback = undefined;
    this.extra = 0;
    this.pass = 1;
    this.previousResult = undefined;
    this.writtenHands = undefined;
    this.previousWrittenHands = undefined;
    this.skipEarlierNotes();
    this.resetRecital();
  }

  press(pitch: number, speed: number) {
    if (!this.running || this.countingIn || this.completed) return;
    if (this.recital) {
      this.recital.press(pitch);
      return;
    }
    if (this.options.mode === "melody") {
      for (const id of matchMelodyPitch(this.notes, this.matched, pitch, this.position))
        this.matched.add(id);
      return;
    }
    if (this.options.mode !== "rhythm") return;
    const scale = speed / 100;
    const candidate = this.notes
      .filter((n) => !this.matched.has(n.id) && n.pitch === pitch &&
        Math.abs(n.start - this.position) <= RHYTHM_WINDOW * scale + EPSILON)
      .sort((a, b) => Math.abs(a.start - this.position) - Math.abs(b.start - this.position))[0];
    if (!candidate) {
      this.extra++;
      this.feedback = { kind: "extra", pitch };
      return;
    }
    const offset = (this.position - candidate.start) / scale;
    const grade: TimingGrade = Math.abs(offset) <= ON_TIME_WINDOW + EPSILON
      ? "on-time" : offset < 0 ? "early" : "late";
    // One physical press satisfies doubled unisons, but not a later repetition.
    for (const note of this.notes) {
      if (!this.matched.has(note.id) && note.pitch === pitch &&
        Math.abs(note.start - candidate.start) < EPSILON) {
        this.matched.add(note.id);
        this.grades.set(note.id, grade);
      }
    }
    this.feedback = { kind: grade, pitch, offsetMs: Math.round(offset * 1000) };
  }

  private markMissed(speed: number) {
    for (const note of this.notes) {
      if (!this.matched.has(note.id) &&
        this.position > note.start + RHYTHM_WINDOW * speed / 100 + EPSILON) {
        this.matched.add(note.id);
        this.grades.set(note.id, "missed");
        this.feedback = { kind: "missed", pitch: note.pitch };
      }
    }
  }

  /** Do not catch up after a stalled/background UI: preserve the last visible state. */
  advanceFrame(elapsedSeconds: number, speed: number, repeat: boolean) {
    if (this.running && elapsedSeconds > MAX_FRAME_GAP) {
      this.pause();
      return { audioNotes: [] as Note[], countBeats: [] as number[], looped: false, metronomeBeat: false, interrupted: true };
    }
    return { ...this.advance(elapsedSeconds, speed, repeat), interrupted: false };
  }

  /** Advance by actual elapsed time; pause time is never included by the caller. */
  advance(elapsedSeconds: number, speed: number, repeat: boolean) {
    const result: { audioNotes: Note[]; countBeats: number[]; looped: boolean; metronomeBeat: boolean } = {
      audioNotes: [], countBeats: [], looped: false, metronomeBeat: false,
    };
    if (!this.running) return result;
    let delta = Math.max(0, elapsedSeconds) * speed / 100;
    if (this.countingIn) {
      const used = Math.min(delta, this.countRemaining);
      this.countRemaining -= used;
      delta -= used;
      const beat = this.countBeat || 4;
      while (this.sentCountBeat < beat) result.countBeats.push(++this.sentCountBeat);
      if (this.countingIn) return result;
      this.countRemaining = 0;
    }
    this.position += delta;
    this.recital?.advance(delta, speed / 100);
    if (this.options.mode === "melody")
      this.position = melodyPosition(this.notes, this.matched, this.position);
    if (this.options.mode === "rhythm") this.markMissed(speed);
    for (const note of this.options.notes) {
      if (note.start <= this.position && !this.sounded.has(note.id)) {
        this.sounded.add(note.id);
        const selected = this.options.hand === "both" || note.hand === this.options.hand;
        if (this.options.mode === "listen" ? selected : !selected)
          result.audioNotes.push(note);
      }
    }
    // A very short final note still gets its full late-hit window.
    const lastOnset = this.notes.at(-1)?.start ?? 0;
    const end = this.recital
      ? Math.max(this.options.duration, this.recital.endPosition(speed / 100))
      : this.options.mode === "rhythm"
      ? Math.max(this.options.duration, lastOnset + RHYTHM_WINDOW * speed / 100 + EPSILON * 2)
      : this.options.duration;
    if (this.position >= end) {
      this.position = end;
      // Recital has no live grades, misses, matches or feedback. Publish only
      // the completed pass, before a repeat resets the per-pass recording.
      if (this.recital) {
        const result = this.recital.finish();
        for (const [id, grade] of result.grades) {
          this.grades.set(id, grade);
          this.matched.add(id);
        }
        this.extra = result.extra;
      }
      this.writtenHands = this.summarizeWrittenHands();
      if (repeat) {
        const summary = this.summary, writtenHands = this.writtenHands, pass = this.pass;
        this.restart();
        this.pass = pass + 1;
        this.previousResult = this.options.mode === "rhythm" || this.options.mode === "recital"
          ? summary : undefined;
        this.previousWrittenHands = writtenHands;
        this.start();
        result.looped = true;
      } else {
        this.running = false;
        this.completed = true;
      }
    }
    // Use active elapsed time rather than song position: the steady beat keeps
    // going while Melody waits. Count-in consumed its own time above. A repeat
    // starts a fresh clock on its next frame, never a second click in this one.
    if (this.running && !result.looped && this.options.metronome)
      result.metronomeBeat = this.metronome.advance(delta);
    return result;
  }
}
