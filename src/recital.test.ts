import { describe, expect, it } from "vitest";
import { assessRecital } from "./recital";
import { ON_TIME_WINDOW, RHYTHM_WINDOW } from "./session";

const target = (id: string, pitch: number, time: number) => ({ id, pitch, time });
const press = (pitch: number, time: number) => ({ pitch, time });
const assess = (targets: Parameters<typeof assessRecital>[0], presses: Parameters<typeof assessRecital>[1]) =>
  assessRecital(targets, presses, RHYTHM_WINDOW, ON_TIME_WINDOW);

describe("completed recital assessment", () => {
  it("handles empty inputs and never mutates input order", () => {
    const targets = Object.freeze([Object.freeze(target("b", 60, 2)), Object.freeze(target("a", 64, 1))]);
    const presses = Object.freeze([Object.freeze(press(60, 2)), Object.freeze(press(64, 1))]);
    const result = assess(targets, presses);
    expect([...result.grades]).toEqual([["a", "on-time"], ["b", "on-time"]]);
    expect(targets[0].id).toBe("b");
    expect(presses[0].time).toBe(2);
    expect(assess([], [])).toEqual({ grades: new Map(), extra: 0 });
    expect(assess([], [press(60, 0)])).toEqual({ grades: new Map(), extra: 1 });
  });

  it("marks every unplayed target as missed", () => {
    expect([...assess([target("a", 60, 1), target("b", 64, 2)], []).grades])
      .toEqual([["a", "missed"], ["b", "missed"]]);
  });

  it("prefers the earlier onset for equal-distance repeated pitches", () => {
    const result = assess([target("b", 60, 1.2), target("a", 60, 1)], [press(60, 1.1)]);
    expect(result.grades.get("a")).toBe("on-time");
    expect(result.grades.get("b")).toBe("missed");
  });

  it("handles unisons shared across hands as one physical key press", () => {
    const result = assess([target("left", 60, 1), target("right", 60, 1)], [press(60, 1.2)]);
    expect([...result.grades.values()]).toEqual(["late", "late"]);
    expect(result.extra).toBe(0);
  });

  it("processes presses in time order and never recycles an already credited onset", () => {
    const result = assess([target("a", 60, 1), target("b", 60, 1.2)], [press(60, 1.4), press(60, 1.01), press(60, 1.21)]);
    expect([...result.grades.values()]).toEqual(["on-time", "on-time"]);
    expect(result.extra).toBe(1);
  });

  it("distinguishes wrong pitches and correct pitches outside their window", () => {
    const result = assess([target("a", 60, 1)], [press(61, 1), press(60, 0.69), press(60, 1.31)]);
    expect(result.grades.get("a")).toBe("missed");
    expect(result.extra).toBe(3);
  });

  it("scales to a long synthetic piece without scanning the whole piece per press", () => {
    const targets = Array.from({ length: 20000 }, (_, index) => target(`n${index}`, 60 + index % 12, index * 0.2));
    const presses = targets.map((n) => press(n.pitch, n.time + 0.05));
    const result = assess(targets, presses);
    expect(result.grades.size).toBe(targets.length);
    expect(new Set(result.grades.values())).toEqual(new Set(["on-time"]));
    expect(result.extra).toBe(0);
  });
});
