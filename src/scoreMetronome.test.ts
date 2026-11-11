import { expect, it } from "vitest";
import { PracticeMetronome, type TempoSegment } from "./metronome";
import { PracticeSession, type SessionOptions } from "./session";

const tempoMap: TempoSegment[] = [
  { beat: 0, seconds: 0, bpm: 120 },
  { beat: 1, seconds: .5, bpm: 60 },
  { beat: 3, seconds: 2.5, bpm: 240 },
  { beat: 5, seconds: 3, bpm: 90 },
];
const make = (patch: Partial<SessionOptions> = {}, startAt = 0) => new PracticeSession({
  notes: [
    { id: "right", pitch: 60, start: 0, duration: 8, velocity: .7, hand: "right" },
    { id: "left", pitch: 48, start: 0, duration: 8, velocity: .6, hand: "left" },
  ], duration: 8, tempo: 120, hand: "both", mode: "listen", countIn: false,
  metronome: true, tempoMap, ...patch,
}, startAt);

it("follows slowing and speeding source tempos, including changes during held notes", () => {
  const s = make(); s.start();
  expect(s.advance(0, 100, false).metronomeBeat).toBe(true);
  for (const [delta, beat] of [[.5, true], [.5, false], [.5, true], [.99, false], [.01, true], [.25, true], [.25, true], [.5, false], [1 / 6, true]] as const)
    expect(s.advance(delta, 100, false).metronomeBeat).toBe(beat);
  expect(s.options.tempo).toBe(120);
  expect(s.options.notes.map(n => n.duration)).toEqual([8, 8]);
});

it("preserves fractional beat phase at a mid-beat tempo change", () => {
  const s = make({ tempoMap: [{ beat: 0, seconds: 0, bpm: 120 }, { beat: .5, seconds: .25, bpm: 60 }] });
  s.start(); expect(s.advance(0, 100, false).metronomeBeat).toBe(true);
  expect(s.advance(.25, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.49, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 100, false).metronomeBeat).toBe(true);
});

it.each([25, 50, 75, 100, 125])("scales numeric source tempos with %s%% practice speed without rewriting the map", speed => {
  const s = make(), original = JSON.stringify(s.options); s.start();
  expect(s.advance(0, speed, false).metronomeBeat).toBe(true);
  expect(s.advance(.5 * 100 / speed, speed, false).metronomeBeat).toBe(true);
  expect(s.advance(.99 * 100 / speed, speed, false).metronomeBeat).toBe(false);
  expect(s.advance(.01 * 100 / speed, speed, false).metronomeBeat).toBe(true);
  expect(s.position).toBeCloseTo(1.5);
  expect(JSON.stringify(s.options)).toBe(original);
});

it("keeps the current source tempo during Melody waits rather than reaching future marks", () => {
  const s = make({ mode: "melody" }); s.start();
  s.advance(0, 100, false);
  for (let i = 0; i < 8; i++) {
    expect(s.advance(.5, 100, false).metronomeBeat).toBe(true);
    expect(s.position).toBe(0);
  }
  s.press(60, 100);
  expect(s.advance(.5, 100, false).metronomeBeat).toBe(true);
  expect(s.position).toBe(0); // Both assigned hands must be matched.
  s.press(48, 100);
  expect(s.advance(.5, 100, false).metronomeBeat).toBe(true);
  expect(s.position).toBe(.5);
  expect(s.advance(.5, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.5, 100, false).metronomeBeat).toBe(true);
});

it("integrates movement plus a partial-frame wait at the newly reached tempo", () => {
  const s = make({ mode: "melody", notes: [{ id: "wait", pitch: 60, start: 1, duration: 6, velocity: .7, hand: "right" }] });
  s.start(); s.advance(0, 100, false);
  // 1.5 beats of movement, then one beat at the 60-BPM wait position.
  expect(s.advance(2, 100, false).metronomeBeat).toBe(true);
  expect(s.position).toBe(1);
  expect(s.advance(.49, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 100, false).metronomeBeat).toBe(true);
  expect(s.advance(1, 100, false).metronomeBeat).toBe(true);
  expect(s.position).toBe(1);
});

it("retains phase across pauses, a frame interruption and a speed change", () => {
  const s = make(); s.start(); s.advance(0, 100, false); s.advance(.75, 100, false);
  s.pause(); expect(s.advance(20, 100, false).metronomeBeat).toBe(false);
  s.start(); expect(s.advanceFrame(3, 100, false).interrupted).toBe(true);
  expect(s.position).toBe(.75); s.start();
  expect(s.advance(1.49, 50, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 50, false).metronomeBeat).toBe(true);
  expect(s.position).toBeCloseTo(1.5);
});

it("starts a fresh beat at a seek's actual tempo, while count-in keeps the starting tempo", () => {
  const s = make({ countIn: true }, 2.6); s.start();
  for (let i = 0; i < 4; i++) expect(s.advance(i ? .5 : 0, 100, false)).toMatchObject({ countBeats: [i + 1], metronomeBeat: false });
  expect(s.advance(.5, 100, false).metronomeBeat).toBe(true);
  expect(s.position).toBe(2.6);
  expect(s.advance(.24, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 100, false).metronomeBeat).toBe(true);
  s.restart(.6); s.start(); s.advance(2, 100, false);
  expect(s.advance(.99, 100, false).metronomeBeat).toBe(false);
  expect(s.advance(.01, 100, false).metronomeBeat).toBe(true);
});

it("restarts the original map on repeat without a terminal or duplicate click", () => {
  const s = make({ duration: 3, notes: [] }); s.start();
  s.advance(0, 100, true); s.advance(2.75, 100, true);
  expect(s.advance(.25, 100, true)).toMatchObject({ looped: true, metronomeBeat: false });
  expect(s.advance(0, 100, true).metronomeBeat).toBe(true);
  expect(s.advance(0, 100, true).metronomeBeat).toBe(false);
  expect(s.advance(.5, 100, true).metronomeBeat).toBe(true);
  expect(s.advance(.5, 100, true).metronomeBeat).toBe(false);
  expect(s.advance(2, 100, false).metronomeBeat).toBe(false);
  expect(s.completed).toBe(true);
});

it.each(["listen", "rhythm", "recital"] as const)("does not change %s playback, both-hand results or source data", mode => {
  const on = make({ mode }), off = make({ mode, metronome: false });
  for (const s of [on, off]) { s.start(); s.advance(0, 100, false); s.press(60, 100); s.press(48, 100); }
  for (const dt of [.5, .5, 1.5, .25, .25, 1, 4]) {
    const a = on.advance(dt, 100, false), b = off.advance(dt, 100, false);
    expect(a.audioNotes).toEqual(b.audioNotes);
    expect(on.position).toBe(off.position);
    expect(on.summary).toEqual(off.summary);
  }
  expect(on.writtenHands).toEqual(off.writtenHands);
  expect(on.completed).toBe(true);
});

it("does not burst or repeat missed clicks after crossing several tempo segments", () => {
  const clock = new PracticeMetronome(120, tempoMap);
  expect(clock.advance(0, 0, 0)).toBe(true);
  expect(clock.advance(3, 0, 3)).toBe(true);
  expect(clock.advance(0, 3, 3)).toBe(false);
  expect(clock.advance(.5, 3, 3.5)).toBe(false);
  expect(clock.advance(1 / 6, 3.5, 3 + 2 / 3)).toBe(true);
});
