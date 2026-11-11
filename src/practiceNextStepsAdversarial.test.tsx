// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import type { Song } from "./music";
import { HISTORY_KEY, parsePracticeHistory } from "./practiceHistory";
import { SONGS_KEY } from "./songLibrary";
import { stubDialogs } from "./testDialog";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
const study: Song = { id: "synthetic-study", title: "Synthetic short study", tempo: 120, duration: 1, notes: [
  { id: "l", pitch: 48, hand: "left", start: 0, duration: .5, velocity: .5, finger: 2 },
  { id: "r", pitch: 60, hand: "right", start: 0, duration: .5, velocity: .5, finger: 3 },
] };
let now = 0, id = 0;
const frames = new Map<number, FrameRequestCallback>();
function advance(seconds: number) {
  act(() => { for (let i = 0; i < Math.ceil(seconds * 10); i++) {
    now += 100; const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(now));
  } });
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));
const setup = () => click("Practice setup");
const close = () => click("Done");
function results() {
  const opener = button("Results"); opener.focus(); fireEvent.click(opener);
  return screen.getByRole("dialog", { name: "Practice results" });
}
const history = () => parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!);
const position = () => Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value);
function openStudy(mode: "listen" | "melody" | "rhythm" = "listen", hand = "Right") {
  render(<App />); click("My library"); click(/Synthetic short study/); setup();
  click(hand);
  click(mode === "listen" ? /^Listen & explore/ : mode === "melody" ? /^Melody practice/ : /^Rhythm practice/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); close();
}
function complete(mode: "listen" | "melody" | "rhythm") {
  click("Play");
  if (mode !== "listen") click("Play C4");
  advance(2.2);
  expect(button("Play")).toBeTruthy();
}
beforeEach(() => {
  stubDialogs(); localStorage.clear(); localStorage.setItem(SONGS_KEY, JSON.stringify([study]));
  frames.clear(); now = id = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++id, frame); return id; });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
  vi.stubGlobal("AudioContext", class extends EventTarget {
    state = "running"; currentTime = 0; destination = {};
    resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
    createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("preserves unreadable history while allowing a completed pass to prepare a next step", () => {
  const corrupt = '{"private-backup": "do not overwrite"';
  localStorage.setItem(HISTORY_KEY, corrupt);
  openStudy(); complete("listen"); results();
  click(/Try waiting for notes/);
  expect(localStorage.getItem(HISTORY_KEY)).toBe(corrupt);
  expect(screen.getByText(/Saved history could not be read and has not been overwritten/)).toBeTruthy();
  expect(position()).toBe(0); expect(button("Play")).toBeTruthy();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});

it.each(["mode", "count-in", "seek"])("clears completed-pass suggestions after a %s change", change => {
  openStudy(); complete("listen");
  if (change === "seek") {
    fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: ".25" } });
  } else {
    setup();
    if (change === "mode") click(/^Melody practice/);
    else fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
    close();
  }
  results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull();
  expect(history()).toHaveLength(1);
});

it("bases next-step speed on the finishing speed while retaining the actual pass speed range", () => {
  openStudy("rhythm"); click("Play"); click("Play C4"); advance(.4);
  setup(); click("75%"); close(); click("Play"); advance(1.2);
  results();
  expect(screen.getByText(/Last completed pass: Right hand · Rhythm · 50–75%/)).toBeTruthy();
  expect(history()[0]).toMatchObject({ speedMin: 50, speedMax: 75, tempo: 120 });
  const saved = localStorage.getItem(HISTORY_KEY);
  click(/Try a small speed increase Right hand · 80%/);
  expect(screen.getByText("Right hand · 80% · Rhythm")).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBe(saved);
  advance(10); expect(position()).toBe(0);
});
