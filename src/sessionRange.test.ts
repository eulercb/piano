import { describe, expect, it } from "vitest";
import type { Note, Song } from "./music";
import { formatPracticeInterval, isPracticeRange, noteStartsInRange, practiceRangeError } from "./practiceRange";
import {
  exportPracticeHistory, parsePracticeHistory, practicePieceRevision, PracticePassRecorder,
} from "./practiceHistory";
import { PracticeSession, type PracticeMode, type SessionOptions } from "./session";

const makeNote = (id: string, start: number, pitch: number, hand: Note["hand"] = "right", duration = 0.1): Note =>
  ({ id, start, pitch, hand, duration, velocity: 0.72, finger: 3 });
const crossingStart: Note = { ...makeNote("crosses-start", 0.75, 60, "right", 0.75), sourceNoteIds: ["tie-attack", "tie-continuation"] };
const startRight = makeNote("start-right", 1, 62);
const startLeft = makeNote("start-left", 1, 48, "left");
const crossingEnd = makeNote("crosses-end", 1.75, 64, "right", 1);
const lastLeft = makeNote("last-left", 1.9, 50, "left");
const atEnd = makeNote("at-end", 2, 65);
const backingAtEnd = makeNote("backing-at-end", 2, 52, "left");
const song: Song = { id: "original", title: "Original exercise", tempo: 120, duration: 3, notes: [
  crossingStart, startRight, startLeft, crossingEnd, lastLeft, atEnd, backingAtEnd,
] };
const range = { start: 1, end: 2 };
const make = (options: Partial<SessionOptions> = {}, startAt?: number) => new PracticeSession({
  notes: song.notes, duration: 3, tempo: song.tempo,
  mode: "listen", hand: "right", countIn: false, range, ...options,
}, startAt);

describe("temporary practice window", () => {
  it("labels both whole and fractional source-time endpoints", () => {
    expect(formatPracticeInterval(0, 60)).toBe("0:00–1:00");
    expect(formatPracticeInterval(0.25, 0.75)).toBe("0:00.250–0:00.750");
    expect(formatPracticeInterval(0.0001, 0.0002)).toBe("0.0001 s–0.0002 s");
  });

  it("accepts finite half-open ranges and explains invalid controls", () => {
    expect(practiceRangeError(range, 3)).toBeUndefined();
    expect(isPracticeRange({ start: 0, end: 3 }, 3)).toBe(true);
    for (const invalid of [
      { start: NaN, end: 2 }, { start: 0, end: Infinity }, { start: 1, end: 1 },
      { start: 2, end: 1 }, { start: -0.1, end: 2 }, { start: 1, end: 3.01 },
    ]) {
      expect(practiceRangeError(invalid, 3)).toBeTruthy();
      expect(isPracticeRange(invalid, 3)).toBe(false);
      expect(() => make({ range: invalid })).toThrow(RangeError);
    }
    expect(noteStartsInRange(crossingStart, range)).toBe(false);
    expect(noteStartsInRange(startRight, range)).toBe(true);
    expect(noteStartsInRange(atEnd, range)).toBe(false);
    expect(noteStartsInRange(atEnd)).toBe(true);
  });

  it("starts at the selected lower bound and emits original Listen notes only in the window", () => {
    const s = make();
    const before = JSON.stringify(song);
    expect(s.position).toBe(1);
    expect(s.options.notes).toBe(song.notes);
    expect(s.options.duration).toBe(3);
    expect(s.notes).toEqual([startRight, crossingEnd]);
    expect(s.notes[1]).toBe(crossingEnd);
    s.start();
    expect(s.advance(0, 100, false).audioNotes).toEqual([startRight]);
    const final = s.advance(5, 100, false);
    expect(final.audioNotes).toEqual([crossingEnd]);
    expect(final.audioNotes[0]).toBe(crossingEnd);
    expect(final.audioNotes[0]).toMatchObject({ duration: 1, finger: 3 });
    expect(s.position).toBe(2);
    expect(s.completed).toBe(true);
    expect(JSON.stringify(song)).toBe(before);
  });

  it("waits only for in-window Melody targets and excludes outside accompaniment", () => {
    const s = make({ mode: "melody" });
    s.start();
    expect(s.advance(1, 100, false).audioNotes).toEqual([startLeft]);
    expect(s.position).toBe(1);
    s.press(crossingStart.pitch, 100);
    expect(s.matched.size).toBe(0);
    s.press(startRight.pitch, 100);
    expect(s.advance(1, 100, false).audioNotes).toEqual([]);
    expect(s.position).toBe(1.75);
    s.press(crossingEnd.pitch, 100);
    expect(s.advance(1, 100, false).audioNotes).toEqual([lastLeft]);
    expect(s.completed).toBe(true);
    expect(s.position).toBe(2);
  });

  it("keeps count-in on the absolute source start and defers the first attack", () => {
    const s = make({ countIn: true });
    s.start();
    expect(s.advance(0, 50, false).countBeats).toEqual([1]);
    expect(s.advance(3.9, 50, false).audioNotes).toEqual([]);
    expect(s.position).toBe(1);
    expect(s.advance(0.2, 50, false).audioNotes).toEqual([startRight]);
    expect(s.position).toBeCloseTo(1.05);
  });

  it("uses the source tempo at the range's absolute start for metronome movement", () => {
    const s = make({
      range: { start: 1, end: 2.5 }, metronome: true,
      tempoMap: [{ seconds: 0, beat: 0, bpm: 120 }, { seconds: 1, beat: 2, bpm: 60 }],
    });
    s.start();
    expect(s.advance(0, 100, false).metronomeBeat).toBe(true);
    expect(s.advance(0.5, 100, false).metronomeBeat).toBe(false);
    expect(s.advance(0.5, 100, false).metronomeBeat).toBe(true);
  });

  it("clamps seeks and returns to the range start when restarting or repeating", () => {
    const s = make({}, 1.5);
    expect(s.position).toBe(1.5);
    s.start();
    const loop = s.advance(1, 100, true);
    expect(loop.looped).toBe(true);
    expect(loop.audioNotes).toEqual([crossingEnd]);
    expect(s.pass).toBe(2);
    expect(s.position).toBe(1);
    expect(s.advance(0, 100, true).audioNotes).toEqual([startRight]);
    s.restart(-1);
    expect(s.position).toBe(1);
    s.restart(9);
    expect(s.position).toBe(2);
    s.start();
    expect(s.position).toBe(1);
    s.restart(1.8);
    s.restart();
    expect(s.position).toBe(1);
  });

  it("finishes an empty short timing window at its end, without an invented late target", () => {
    const s = make({ mode: "rhythm", range: { start: 0, end: 0.01 } });
    s.start();
    s.advance(0.01, 100, false);
    expect(s.completed).toBe(true);
    expect(s.summary.total).toBe(0);
  });

  for (const mode of ["rhythm", "recital"] as const) {
    for (const speed of [25, 50, 125]) {
      it(`keeps the ${mode} late window at ${speed}% without reattacking later accompaniment`, () => {
        const finalTarget = makeNote("late-target", 1.999, 71);
        const s = make({ mode, metronome: true, notes: [finalTarget, backingAtEnd] });
        s.start();
        const realTimeToOnset = (finalTarget.start - s.rangeStart) / (speed / 100);
        const late = s.advance(realTimeToOnset + 0.18, speed, false);
        expect(s.position).toBeGreaterThan(s.rangeEnd);
        expect(late.audioNotes).toEqual([]);
        expect(late.metronomeBeat).toBe(false);
        expect(s.running).toBe(true);
        s.pause();
        s.start();
        expect(s.position).toBeGreaterThan(s.rangeEnd);
        s.press(finalTarget.pitch, speed);
        s.advance(0.13, speed, false);
        expect(s.completed).toBe(true);
        expect(s.summary).toMatchObject({ total: 1, late: 1, missed: 0, extra: 0 });
      });
    }
  }
});

describe("temporary range history", () => {
  function record(mode: PracticeMode) {
    const session = make({ mode });
    return {
      session,
      recorder: new PracticePassRecorder(session, song, () => "2026-11-13T22:00:00.000Z", () => "range-pass"),
    };
  }

  it("retains the original piece identity/revision and records actual source bounds", () => {
    const { session, recorder } = record("listen");
    session.start();
    let finished: ReturnType<typeof recorder.advanceFrame> | undefined;
    for (let i = 0; i < 4; i++) finished = recorder.advanceFrame(0.25, 100, false);
    expect(finished?.historyError).toBeUndefined();
    const pass = finished?.completedPass;
    expect(pass).toMatchObject({
      pieceId: song.id, pieceTitle: song.title, pieceRevision: practicePieceRevision(song),
      startSeconds: 1, endSeconds: 2, noteCount: 2,
    });
    expect(parsePracticeHistory(exportPracticeHistory([pass!]))).toEqual([pass]);
  });

  it("records a seeked pass from that start, then repeat uses the full selected range", () => {
    const { session, recorder } = record("rhythm");
    session.restart(1.5);
    session.start();
    expect(recorder.advanceFrame(0.25, 100, true).completedPass).toBeUndefined();
    session.press(crossingEnd.pitch, 100);
    const first = recorder.advanceFrame(0.25, 100, true);
    expect(first.completedPass).toBeUndefined();
    const loop = recorder.advanceFrame(0.1, 100, true);
    expect(loop.looped).toBe(true);
    expect(loop.historyError).toBeUndefined();
    expect(loop.completedPass).toMatchObject({
      startSeconds: 1.5, endSeconds: 2, noteCount: 1, rhythm: { total: 1, onTime: 1 },
    });
    expect(session.position).toBe(1);
    let next: ReturnType<typeof recorder.advanceFrame> | undefined;
    for (let i = 0; i < 5; i++) {
      next = recorder.advanceFrame(0.25, 100, true);
      if (next.looped) break;
    }
    expect(next?.completedPass).toMatchObject({
      startSeconds: 1, endSeconds: 2, noteCount: 2, rhythm: { total: 2, missed: 2 },
    });
  });
});
