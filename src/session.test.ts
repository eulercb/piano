import { describe, expect, it } from "vitest";
import type { Note } from "./music";
import { PracticeSession, frameTime, type SessionOptions } from "./session";

const note = (id: string, pitch = 60, start = 1, hand: Note["hand"] = "right"): Note =>
  ({ id, pitch, start, hand, duration: 0.5, velocity: 0.7 });
const make = (overrides: Partial<SessionOptions> = {}, startAt = 0) => new PracticeSession({
  notes: [note("a")], duration: 3, tempo: 120,
  mode: "rhythm", hand: "both", countIn: false, ...overrides,
}, startAt);
const run = (s: PracticeSession, seconds: number, speed = 100, repeat = false) => {
  s.start();
  return s.advance(seconds, speed, repeat);
};

describe("count-in and transport", () => {
  it("counts four quarter-note beats, delaying the first onset at selected speed", () => {
    const s = make({ countIn: true, mode: "listen", notes: [note("a", 60, 0)] });
    expect(run(s, 0, 50).countBeats).toEqual([1]);
    expect(s.countBeat).toBe(1);
    expect(s.position).toBe(0);
    for (const beat of [2, 3, 4]) {
      const result = s.advance(1, 50, false);
      expect(result.countBeats).toEqual([beat]);
      expect(result.audioNotes).toEqual([]);
      expect(s.countBeat).toBe(beat);
    }
    expect(s.advance(1, 50, false).audioNotes.map(n => n.id)).toEqual(["a"]);
    expect(s.countingIn).toBe(false);
    expect(s.position).toBe(0);
  });
  it("carries fractional remaining frame time across the count-in boundary", () => {
    const s = make({ countIn: true });
    run(s, 4.2, 50);
    expect(s.position).toBeCloseTo(0.1);
  });
  it("ignores input during count-in", () => {
    const s = make({ countIn: true, notes: [note("a", 60, 0)] });
    run(s, 0);
    s.press(60, 100);
    s.press(61, 100);
    expect(s.summary).toEqual({ total: 1, onTime: 0, early: 0, late: 0, missed: 0, extra: 0 });
  });
  it("starts immediately with count-in disabled", () => {
    const s = make({ mode: "listen", notes: [note("a", 60, 0)] });
    expect(run(s, 0).audioNotes.map(n => n.id)).toEqual(["a"]);
    expect(s.countingIn).toBe(false);
  });
  it("pauses and resumes a partial count-in without replaying already emitted beats", () => {
    const s = make({ countIn: true });
    run(s, 0.75);
    expect(s.countBeat).toBe(2);
    s.pause();
    expect(s.advance(20, 100, false).countBeats).toEqual([]);
    expect(s.countBeat).toBe(2);
    s.start();
    expect(s.advance(0.25, 100, false).countBeats).toEqual([3]);
    expect(s.position).toBe(0);
  });
  it("pause preserves clock and hits, ignores presses, and resumes without a new lead-in", () => {
    const s = make();
    run(s, 1);
    s.press(60, 100);
    s.pause();
    s.advance(30, 100, false);
    s.press(64, 100);
    expect(s.position).toBe(1);
    expect(s.summary.onTime).toBe(1);
    expect(s.summary.extra).toBe(0);
    s.start();
    s.advance(0.25, 100, false);
    expect(s.position).toBe(1.25);
  });
  it("uses real elapsed time rather than silently slowing long frames", () => {
    const s = make();
    run(s, 1.2, 50);
    expect(s.position).toBeCloseTo(0.6);
  });
  it("supports a speed change without jumping the source-song position", () => {
    const s = make();
    run(s, 1, 50);
    s.advance(0.25, 100, false);
    expect(s.position).toBeCloseTo(0.75);
  });
  it("restart clears feedback, scores and prior chord matches", () => {
    const s = make({ notes: [note("a"), note("b", 64)] });
    run(s, 1);
    s.press(60, 100);
    s.press(61, 100);
    s.restart();
    expect(s.position).toBe(0);
    expect(s.running).toBe(false);
    expect(s.feedback).toBeUndefined();
    expect(s.matched.size).toBe(0);
    expect(s.summary.onTime + s.summary.extra).toBe(0);
    run(s, 1);
    s.press(64, 100);
    expect(s.summary.onTime).toBe(1);
  });
  it("seeking starts a fresh attempt and excludes earlier notes from its denominator", () => {
    const s = make({ notes: [note("a", 60, 0), note("b", 64, 2)] }, 1);
    expect(s.summary.total).toBe(1);
    run(s, 1);
    s.press(64, 100);
    expect(s.summary.onTime).toBe(1);
    expect(s.summary.missed).toBe(0);
  });
});

describe("rhythm feedback", () => {
  it.each([25, 50, 75, 100, 125])("grades the same real timing offset consistently at %s%%", speed => {
    const s = make();
    run(s, 1 / (speed / 100) + 0.2, speed);
    s.press(60, speed);
    expect(s.feedback).toEqual({ kind: "late", pitch: 60, offsetMs: 200 });
  });
  it("marks correct pitches within 100 ms as on time", () => {
    const s = make();
    run(s, 1.1);
    s.press(60, 100);
    expect(s.summary.onTime).toBe(1);
    expect(s.feedback?.kind).toBe("on-time");
  });
  it("reports early notes without stopping the clock", () => {
    const s = make();
    run(s, 0.8);
    s.press(60, 100);
    expect(s.feedback).toEqual({ kind: "early", pitch: 60, offsetMs: -200 });
    s.advance(0.2, 100, false);
    expect(s.position).toBe(1);
  });
  it("counts a wrong pitch as extra, without consuming the expected note", () => {
    const s = make();
    run(s, 1);
    s.press(61, 100);
    expect(s.summary.extra).toBe(1);
    expect(s.matched.size).toBe(0);
    s.press(60, 100);
    expect(s.summary.onTime).toBe(1);
  });
  it("does not credit a correct pitch outside the timing window", () => {
    const s = make();
    run(s, 0.69);
    s.press(60, 100);
    expect(s.summary.extra).toBe(1);
    expect(s.summary.early).toBe(0);
  });
  it("keeps the inclusive late boundary, then marks unanswered notes missed once", () => {
    const s = make();
    run(s, 1.3);
    expect(s.summary.missed).toBe(0);
    s.advance(0.001, 100, false);
    expect(s.summary.missed).toBe(1);
    s.advance(0.2, 100, false);
    expect(s.summary.missed).toBe(1);
    s.press(60, 100);
    expect(s.summary.extra).toBe(1);
  });
  it("grades all chord pitches independently and matches doubled unisons once", () => {
    const s = make({ notes: [note("a"), note("b", 64), note("c")] });
    run(s, 1);
    s.press(60, 100);
    expect(s.summary.onTime).toBe(2);
    s.advance(0.2, 100, false);
    s.press(64, 100);
    expect(s.summary.late).toBe(1);
  });
  it("matches the nearest repeated pitch and never counts a target twice", () => {
    const s = make({ notes: [note("a"), note("b", 60, 1.2)] });
    run(s, 1.19);
    s.press(60, 100);
    expect(s.grades.get("b")).toBe("on-time");
    expect(s.grades.has("a")).toBe(false);
    s.advance(0.2, 100, false);
    s.press(60, 100);
    expect(s.summary).toMatchObject({ onTime: 1, missed: 1, extra: 1 });
  });
  it("scores only the selected hand and plays the other hand as accompaniment", () => {
    const s = make({ hand: "right", notes: [note("l", 48, 1, "left"), note("r")] });
    expect(run(s, 1).audioNotes.map(n => n.id)).toEqual(["l"]);
    expect(s.summary.total).toBe(1);
    s.press(60, 100);
    s.advance(1, 100, false);
    expect(s.summary.missed).toBe(0);
  });
  it("allows the final short note's late window before completing", () => {
    const s = make({ duration: 1.05, notes: [note("a")] });
    run(s, 1.2);
    expect(s.completed).toBe(false);
    s.press(60, 100);
    expect(s.summary.late).toBe(1);
    s.advance(0.11, 100, false);
    expect(s.completed).toBe(true);
    expect(s.running).toBe(false);
    s.press(60, 100);
    expect(s.summary.extra).toBe(0);
  });
  it("finalizes an unplayed last note as missed", () => {
    const s = make({ duration: 1.05 });
    run(s, 1.31);
    expect(s.completed).toBe(true);
    expect(s.summary.missed).toBe(1);
  });
});

describe("repeat and existing approaches", () => {
  it("repeats with a fresh count-in and scores, retaining only the previous pass summary", () => {
    const s = make({ countIn: true });
    run(s, 3);
    s.press(60, 100);
    expect(s.summary.onTime).toBe(1);
    const result = s.advance(2, 100, true);
    expect(result.looped).toBe(true);
    expect(s.running).toBe(true);
    expect(s.pass).toBe(2);
    expect(s.previousResult?.onTime).toBe(1);
    expect(s.summary.onTime).toBe(0);
    expect(s.position).toBe(0);
    expect(s.countBeat).toBe(1);
    expect(s.sounded.size).toBe(0);
    expect(s.matched.size).toBe(0);
    s.press(60, 100);
    expect(s.summary.extra).toBe(0);
    expect(s.advance(0, 100, true).countBeats).toEqual([1]);
    s.advance(3, 100, true);
    s.press(60, 100);
    expect(s.summary.onTime).toBe(1);
  });
  it("restart after a loop removes prior pass results and restores pass one", () => {
    const s = make();
    run(s, 3, 100, true);
    expect(s.previousResult?.missed).toBe(1);
    s.restart();
    expect(s.previousResult).toBeUndefined();
    expect(s.pass).toBe(1);
    expect(s.summary.missed).toBe(0);
  });
  it("turning repeat off completes the current pass normally", () => {
    const s = make();
    run(s, 3, 100, true);
    s.advance(3, 100, false);
    expect(s.completed).toBe(true);
    expect(s.pass).toBe(2);
  });
  it("retains written trailing silence before looping", () => {
    const s = make({ duration: 8, notes: [note("a", 60, 0)] });
    run(s, 2, 100, true);
    expect(s.pass).toBe(1);
    s.advance(6, 100, true);
    expect(s.pass).toBe(2);
  });
  it("melody waits for the full chord and ignores wrong notes", () => {
    const s = make({ mode: "melody", notes: [note("a"), note("b", 64)] });
    run(s, 2);
    expect(s.position).toBe(1);
    s.press(61, 100);
    s.press(64, 100);
    s.advance(1, 100, false);
    expect(s.position).toBe(1);
    s.press(60, 100);
    s.advance(0.5, 100, false);
    expect(s.position).toBe(1.5);
    expect(s.summary.extra).toBe(0);
  });
  it("listen plays selected notes once, resumes silently, then replays after restart", () => {
    const s = make({ mode: "listen", hand: "left", notes: [note("l", 48, 0, "left"), note("r", 60, 0)] });
    expect(run(s, 0).audioNotes.map(n => n.id)).toEqual(["l"]);
    s.pause();
    expect(run(s, 0.5).audioNotes).toEqual([]);
    s.restart();
    expect(run(s, 0).audioNotes.map(n => n.id)).toEqual(["l"]);
  });
});


describe("interrupted animation frames", () => {
  it("auto-pauses without catching up accompaniment or misses after a scheduling stall", () => {
    const s = make({ hand: "right", notes: [note("l", 48, 1, "left"), note("r")] });
    s.start();
    const result = s.advanceFrame(2, 100, false);
    expect(result).toEqual({ audioNotes: [], countBeats: [], looped: false, interrupted: true });
    expect(s.running).toBe(false);
    expect(s.position).toBe(0);
    expect(s.summary.missed).toBe(0);
    s.start();
    expect(s.advanceFrame(0.1, 100, false).interrupted).toBe(false);
    expect(s.position).toBe(0.1);
  });
  it("preserves a partially elapsed count-in through an interruption", () => {
    const s = make({ countIn: true });
    run(s, 0.75);
    expect(s.advanceFrame(10, 100, true).interrupted).toBe(true);
    expect(s.countBeat).toBe(2);
    s.start();
    expect(s.advanceFrame(0.25, 100, true).countBeats).toEqual([3]);
  });
  it("does not restart a paused or completed session when a late frame arrives", () => {
    const s = make();
    run(s, 3);
    expect(s.completed).toBe(true);
    expect(s.advanceFrame(10, 100, true).interrupted).toBe(false);
    expect(s.pass).toBe(1);
    expect(s.running).toBe(false);
  });
});


describe("resuming at the end of a passage", () => {
  it("resumes a paused final late-hit window instead of restarting the pass", () => {
    const s = make({ duration: 1.05, notes: [note("a")] });
    run(s, 1.2);
    s.pause();
    expect(s.completed).toBe(false);
    s.start();
    expect(s.position).toBe(1.2);
    s.press(60, 100);
    expect(s.summary.late).toBe(1);
    s.advance(0.11, 100, false);
    expect(s.completed).toBe(true);
  });
  it("starts a fresh attempt after completion", () => {
    const s = make();
    run(s, 3);
    expect(s.summary.missed).toBe(1);
    s.start();
    expect(s.position).toBe(0);
    expect(s.summary.missed).toBe(0);
    expect(s.completed).toBe(false);
  });
  it("replays from the beginning when seeking to the very end before pressing Play", () => {
    const s = make({}, 3);
    s.start();
    expect(s.position).toBe(0);
    expect(s.summary.total).toBe(1);
  });
});


it("keeps RAF/input timestamps monotonic without counting elapsed time twice", () => {
  let timestamp = 100, elapsed = 0;
  for (const now of [110, 105, 120]) {
    const frame = frameTime(timestamp, now);
    timestamp = frame.timestamp;
    elapsed += frame.seconds;
  }
  expect(timestamp).toBe(120);
  expect(elapsed).toBeCloseTo(0.02);
});
