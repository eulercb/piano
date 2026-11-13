// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { stubDialogs } from "./testDialog";
import { HISTORY_KEY, parsePracticeHistory } from "./practiceHistory";
import type { Song } from "./music";
import { SONGS_KEY } from "./songLibrary";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => <span>Piano input</span> }));

let now = 0;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function advance(seconds: number) {
  act(() => {
    for (let i = 0; i < Math.ceil(seconds / 0.1); i++) {
      now += 100;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((frame) => frame(now));
    }
  });
}
class SilentAudio extends EventTarget {
  state = "running";
  close() { return Promise.resolve(); }
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
beforeEach(() => {
  stubDialogs();
  now = 0; frameId = 0; frames.clear(); localStorage.clear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("AudioContext", SilentAudio);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const study: Song = { id: "written-parts", title: "Synthetic both-hand study", tempo: 120, duration: 1, notes: [
  { id: "left-unison", pitch: 60, start: 0, duration: 0.2, hand: "left", velocity: 0.7 },
  { id: "right-unison", pitch: 60, start: 0, duration: 0.2, hand: "right", velocity: 0.7 },
  { id: "left-missed", pitch: 64, start: 0.5, duration: 0.2, hand: "left", velocity: 0.7 },
  { id: "right-late", pitch: 62, start: 0.5, duration: 0.2, hand: "right", velocity: 0.7 },
] };
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
function openBothHandStudy(mode: "rhythm" | "recital", repeat = false) {
  localStorage.setItem(SONGS_KEY, JSON.stringify([study]));
  renderPractice(<App />); click("My library"); click(/Synthetic both-hand study/); openPracticeRoom(); click("Practice setup");
  click(mode === "rhythm" ? /^Rhythm practice/ : /^Recital practice/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  if (repeat) fireEvent.click(screen.getByRole("checkbox", { name: "Repeat this passage" }));
  click("Done");
}

it.each(["rhythm", "recital"] as const)("saves both-hand %s written counts only after completion, preserves pauses, and reloads them in History", (mode) => {
  openBothHandStudy(mode);
  const savedSong = localStorage.getItem(SONGS_KEY);
  openPracticeRoom(); click("Play"); click("Play C4"); click("Play C♯4"); advance(0.2);
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  click("Results");
  const results = screen.getByRole("dialog", { name: "Practice results" });
  if (mode === "recital") {
    expect(within(results).queryByText("On time")).toBeNull();
    expect(within(results).getByText(/Feedback appears after the pass/)).toBeTruthy();
  }
  expect(screen.queryByRole("group", { name: "Written left part" })).toBeNull();
  click("Done"); advance(2);
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  openPracticeRoom(); click("Play"); advance(0.5); click("Play D4"); advance(0.4);
  const passes = parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!);
  expect(passes).toHaveLength(1);
  expect(passes[0]).toMatchObject({ mode, hand: "both", noteCount: 4,
    rhythm: { total: 4, onTime: 2, early: 0, late: 1, missed: 1, extra: 1 },
    writtenHands: {
      left: { total: 2, onTime: 1, early: 0, late: 0, missed: 1 },
      right: { total: 2, onTime: 1, early: 0, late: 1, missed: 0 },
    },
  });
  const savedHistory = localStorage.getItem(HISTORY_KEY);
  cleanup(); renderPractice(<App />); openPracticeRoom(); click("Practice setup"); click("Practice history");
  const left = within(screen.getByRole("group", { name: "Written left part" }));
  const right = within(screen.getByRole("group", { name: "Written right part" }));
  expect(left.getByText("On time").nextElementSibling?.textContent).toBe("1 / 2");
  expect(left.getByText("Missed").nextElementSibling?.textContent).toBe("1");
  expect(right.getByText("Late").nextElementSibling?.textContent).toBe("1");
  expect(screen.getAllByText("Extra presses")).toHaveLength(1);
  expect(localStorage.getItem(HISTORY_KEY)).toBe(savedHistory);
  expect(localStorage.getItem(SONGS_KEY)).toBe(savedSong);
});

it.each(["rhythm", "recital"] as const)("keeps completed %s loop parts separate from the next unfinished attempt", (mode) => {
  openBothHandStudy(mode, true);
  openPracticeRoom(); click("Play"); click("Play C4"); advance(1.1);
  const first = parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!);
  expect(first).toHaveLength(1);
  expect(first[0].writtenHands).toEqual({
    left: { total: 2, onTime: 1, early: 0, late: 0, missed: 1 },
    right: { total: 2, onTime: 1, early: 0, late: 0, missed: 1 },
  });
  click("Play C♯4"); advance(0.2);
  openPracticeRoom(); click("Practice setup"); click("Practice history");
  expect(parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!)).toEqual(first);
  expect(screen.getByText(/1 completed pass · saved locally/)).toBeTruthy();
  expect(screen.getAllByText("1 / 2")).toHaveLength(2);
  expect(screen.getByText("Extra presses").nextElementSibling?.textContent).toBe("0");
});

it("saves a real playback completion once, preserves pauses, and displays history from navigation", () => {
  renderPractice(<App />);
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(1);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  advance(30);
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(22);
  const passes = parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!);
  expect(passes).toHaveLength(1);
  expect(passes[0]).toMatchObject({ mode: "listen", hand: "both", speedMin: 100, speedMax: 100, startSeconds: 0, pieceTitle: "Morning Light" });
  advance(30);
  expect(parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!)).toHaveLength(1);
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice history" }));
  expect(screen.getByText("Small steps, remembered.")).toBeTruthy();
  expect(screen.getByText(/Listening pass.*no performance score/)).toBeTruthy();
});

it("navigation and restarts discard unfinished attempts rather than adding records", () => {
  renderPractice(<App />);
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(1);
  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(1);
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice history" }));
  expect(screen.getByText("Ready for your first pass.")).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});

it("keeps playback usable when history storage is full and warns before closing", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  renderPractice(<App />);
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(22);
  expect(screen.getByText(/These passes are temporary/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice history" }));
  expect(screen.getByText(/1 completed pass · temporary/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Export history" }) as HTMLButtonElement).disabled).toBe(false);
});
