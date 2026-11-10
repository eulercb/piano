import { it, expect } from "vitest";
import { matchMelodyPitch, melodyPosition } from "./practice";
import type { Note } from "./music";
const n = (id: string, pitch: number, start = 0): Note => ({
  id,
  pitch,
  start,
  duration: 1,
  velocity: 0.7,
  hand: "right",
});
it("waits at earliest unplayed onset", () =>
  expect(melodyPosition([n("a", 60, 2)], new Set(), 3)).toBe(2));
it("wrong notes do not match", () =>
  expect(matchMelodyPitch([n("a", 60)], new Set(), 61, 0)).toEqual([]));
it("chord can be played in either order", () => {
  const notes = [n("a", 60), n("b", 64)];
  expect(matchMelodyPitch(notes, new Set(), 64, 0)).toEqual(["b"]);
  expect(matchMelodyPitch(notes, new Set(["b"]), 60, 0)).toEqual(["a"]);
});
it("one press handles doubled unison notes", () =>
  expect(matchMelodyPitch([n("a", 60), n("b", 60)], new Set(), 60, 0)).toEqual([
    "a",
    "b",
  ]));
it("later repeated notes require a new press at their onset", () => {
  const notes = [n("a", 60), n("b", 60, 1)];
  expect(matchMelodyPitch(notes, new Set(["a"]), 60, 0)).toEqual([]);
  expect(matchMelodyPitch(notes, new Set(["a"]), 60, 1)).toEqual(["b"]);
});
it("no pending notes allows clock to advance", () =>
  expect(melodyPosition([n("a", 60)], new Set(["a"]), 3)).toBe(3));
