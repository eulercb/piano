import { expect, it } from "vitest";
import { PracticeSession } from "./session";

function session(tempo: number, countIn = false, mode: "melody" | "recital" = "melody", metronome = true) {
  return new PracticeSession({ tempo, countIn, mode, metronome, hand: "both", duration: 8,
    notes: [{ id: "one", pitch: 60, start: 0, duration: 8, velocity: .7, hand: "right" }] });
}

it.each([37, 97, 240])("review: irregular frames at %s BPM retain phase through partial count-in and repeated pauses", tempo => {
  const s = session(tempo, true);
  const beat = 60 / tempo;
  s.start();
  expect(s.advance(0, 75, false).countBeats).toEqual([1]);
  s.advance(beat * 2 / .75, 75, false);
  s.pause();
  expect(s.advance(100, 125, false).metronomeBeat).toBe(false);
  s.start();
  expect(s.advance(beat * 2 / 1.25, 125, false).metronomeBeat).toBe(true);
  expect(s.countingIn).toBe(false);
  let elapsed = 0, emitted = 1;
  for (let i = 0; i < 240; i++) {
    const dt = [0, .017, .049, .107][i % 4];
    const speed = [25, 75, 125][i % 3];
    if (i % 7 === 0) {
      s.pause();
      expect(s.advance(500, speed, false).metronomeBeat).toBe(false);
      s.start();
      expect(s.advance(0, speed, false).metronomeBeat).toBe(false);
    }
    elapsed += dt * speed / 100;
    emitted += Number(s.advanceFrame(dt, speed, false).metronomeBeat);
    expect(emitted).toBe(1 + Math.floor(elapsed / beat + 1e-8));
    expect(s.position).toBe(0);
    expect(s.summary).toMatchObject({ missed: 0, extra: 0 });
  }
});

it("review: metronome does not expose or alter recital grades across speed changes and interruption", () => {
  const off = session(97, false, "recital", false), on = session(97, false, "recital", true);
  for (const s of [off, on]) {
    s.start(); s.advance(0, 100, false); s.press(60, 100);
    s.advance(.15, 100, false); s.press(62, 100);
    expect(s.grades.size).toBe(0);
    expect(s.advanceFrame(20, 50, false).interrupted).toBe(true);
    s.start(); s.advance(1, 50, false); s.advance(10, 125, false);
    expect(s.completed).toBe(true);
  }
  expect(on.summary).toEqual(off.summary);
  expect(on.summary).toMatchObject({ onTime: 1, extra: 1 });
});
