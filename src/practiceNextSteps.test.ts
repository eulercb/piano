import { expect, it } from "vitest";
import { practiceNextSteps } from "./practiceNextSteps";
import type { PracticePass } from "./practiceHistory";
import type { Song } from "./music";

const song: Song = { id: "study", title: "Study", tempo: 120, notes: [
  { id: "l", pitch: 48, hand: "left", start: 0, duration: 1, velocity: .5 },
  { id: "r", pitch: 60, hand: "right", start: 0, duration: 1, velocity: .5 },
] };
const pass: PracticePass = { id: "pass", pieceId: "study", pieceRevision: "test", pieceTitle: "Study",
  startedAt: "2026-11-11T00:00:00.000Z", completedAt: "2026-11-11T00:00:10.000Z",
  mode: "melody", hand: "right", tempo: 120, speedMin: 50, speedMax: 50,
  startSeconds: 0, endSeconds: 1, noteCount: 1 };

it("offers five-point increases/decreases without altering the song, pass, or source tempo", () => {
  const before = JSON.stringify({ song, pass });
  const steps = practiceNextSteps(pass, song, 50);
  expect(steps.find(s => s.id === "faster")).toMatchObject({ mode: "melody", hand: "right", speed: 55 });
  expect(steps.find(s => s.id === "slower")).toMatchObject({ mode: "melody", hand: "right", speed: 45 });
  expect(JSON.stringify({ song, pass })).toBe(before);
});
it.each([25, 30, 50, 75, 100, 120, 125])("keeps tempo choices bounded at %i%%", speed => {
  const steps = practiceNextSteps(pass, song, speed);
  expect(steps.every(s => s.speed >= 25 && s.speed <= 125)).toBe(true);
  expect(steps.some(s => s.id === "slower")).toBe(speed > 25);
  expect(steps.some(s => s.id === "faster")).toBe(speed < 125);
});
it("introduces an ungraded single-hand waiting pass after listening, never a faster-performance suggestion", () => {
  const steps = practiceNextSteps({ ...pass, mode: "listen", hand: "both" }, song, 100);
  expect(steps.map(s => s.id)).toEqual(["repeat", "melody"]);
  expect(steps[1]).toMatchObject({ hand: "right", mode: "melody", speed: 50 });
});
it("chooses an available hand and never offers empty-hand or misleading both-hand practice", () => {
  const leftOnly = { ...song, notes: song.notes.filter(n => n.hand === "left") };
  expect(practiceNextSteps({ ...pass, mode: "listen", hand: "both" }, leftOnly, 25)[1])
    .toMatchObject({ hand: "left", speed: 25 });
  const ids = practiceNextSteps({ ...pass, hand: "left" }, leftOnly, 50).map(s => s.id);
  expect(ids).not.toContain("other");
  expect(ids).not.toContain("both");
  expect(practiceNextSteps({ ...pass, hand: "both" }, leftOnly, 50).some(s => s.hand === "right")).toBe(false);
  expect(practiceNextSteps(pass, { ...song, notes: [] }, 50)).toEqual([]);
});
it("new hand combinations use waiting at the current speed or 50%, whichever is slower", () => {
  for (const speed of [25, 50, 100]) {
    const steps = practiceNextSteps({ ...pass, mode: "rhythm" }, song, speed);
    expect(steps.find(s => s.id === "other")).toMatchObject({ hand: "left", mode: "melody", speed: Math.min(speed, 50) });
    expect(steps.find(s => s.id === "both")).toMatchObject({ hand: "both", mode: "melody", speed: Math.min(speed, 50) });
  }
});
