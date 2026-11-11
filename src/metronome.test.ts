import { expect, it } from "vitest";
import { PracticeMetronome } from "./metronome";
import { PracticeSession } from "./session";

const make = (options: Partial<PracticeSession["options"]> = {}, startAt = 0) => new PracticeSession({
  notes: [{ id: "a", pitch: 60, start: 0, duration: 10, velocity: .7, hand: "right" }],
  duration: 10, tempo: 120, mode: "listen", hand: "both", countIn: false,
  metronome: true, ...options,
}, startAt);

it("emits at most one click per advance and never repeats missed beats", () => {
  const clock = new PracticeMetronome(120);
  expect(clock.advance(0, 0, 0)).toBe(true);
  expect(clock.advance(0, 0, 0)).toBe(false);
  expect(clock.advance(.49, 0, .49)).toBe(false);
  expect(clock.advance(.01, .49, .5)).toBe(true);
  expect(clock.advance(20, .5, 20.5)).toBe(true);
  expect(clock.advance(0, 20.5, 20.5)).toBe(false);
  clock.reset();
  expect(clock.advance(0, 0, 0)).toBe(true);
});

it("is opt-in and does not affect playback or grading", () => {
  const off = make({ metronome: undefined }), on = make();
  off.start(); on.start();
  expect(off.advance(0, 100, false).metronomeBeat).toBe(false);
  expect(on.advance(0, 100, false).metronomeBeat).toBe(true);
  off.advance(.5, 100, false); on.advance(.5, 100, false);
  expect(on.position).toBe(off.position);
  expect(on.summary).toEqual(off.summary);
});

it("preserves phase across pause and scales remaining beat time with changed speed", () => {
  const s = make(); s.start();
  expect(s.advance(0, 100, false).metronomeBeat).toBe(true);
  expect(s.advance(.2, 100, false).metronomeBeat).toBe(false);
  s.pause();
  expect(s.advance(30, 100, false).metronomeBeat).toBe(false);
  s.start();
  expect(s.advance(0, 50, false).metronomeBeat).toBe(false);
  expect(s.advance(.59, 50, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 50, false).metronomeBeat).toBe(true);
});

it("keeps a steady beat while melody waits without moving or completing the attempt", () => {
  const s = make({ mode: "melody" }); s.start();
  s.advance(0, 100, false);
  for (let i = 0; i < 20; i++) {
    expect(s.advance(.5, 100, false).metronomeBeat).toBe(true);
    expect(s.position).toBe(0);
    expect(s.completed).toBe(false);
  }
});

it("begins exactly after count-in, carrying fractional boundary time without duplicate clicks", () => {
  const s = make({ countIn: true }); s.start();
  for (let i = 0; i < 4; i++) {
    const r = s.advance(i ? .5 : 0, 100, false);
    expect(r.countBeats).toEqual([i + 1]);
    expect(r.metronomeBeat).toBe(false);
  }
  expect(s.advance(.6, 100, false).metronomeBeat).toBe(true);
  expect(s.advance(.39, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 100, false).metronomeBeat).toBe(true);
});

it("resets the beat on seek/restart and repeat; no terminal or duplicate loop click", () => {
  const s = make({ duration: 1 }); s.start();
  s.advance(0, 100, false); s.advance(.2, 100, false);
  s.restart(.3); s.start();
  expect(s.advance(0, 100, false).metronomeBeat).toBe(true);
  const loop = s.advance(.7, 100, true);
  expect(loop.looped).toBe(true);
  expect(loop.metronomeBeat).toBe(false);
  expect(s.advance(0, 100, true).metronomeBeat).toBe(true);
  expect(s.advance(0, 100, true).metronomeBeat).toBe(false);
  expect(s.advance(1, 100, false).metronomeBeat).toBe(false);
  expect(s.completed).toBe(true);
});

it("rejects long frame gaps before advancing the beat", () => {
  const s = make(); s.start(); s.advanceFrame(0, 100, false);
  s.advanceFrame(.2, 100, false);
  expect(s.advanceFrame(10, 100, false)).toMatchObject({ interrupted: true, metronomeBeat: false });
  s.start();
  expect(s.advanceFrame(.2, 100, false).metronomeBeat).toBe(false);
  expect(s.advanceFrame(.1, 100, false).metronomeBeat).toBe(true);
});

it("re-enters count-in on each repeat with no ongoing clicks during the new count", () => {
  const s = make({ countIn: true, duration: 1 }); s.start();
  expect(s.advance(2, 100, true).metronomeBeat).toBe(true);
  expect(s.advance(1, 100, true)).toMatchObject({ looped: true, metronomeBeat: false });
  expect(s.advance(0, 100, true)).toMatchObject({ countBeats: [1], metronomeBeat: false });
  expect(s.advance(1.5, 100, true).metronomeBeat).toBe(false);
  expect(s.advance(.5, 100, true).metronomeBeat).toBe(true);
  expect(s.pass).toBe(2);
});
