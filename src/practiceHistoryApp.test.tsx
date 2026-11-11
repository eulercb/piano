// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { stubDialogs } from "./testDialog";
import { HISTORY_KEY, parsePracticeHistory } from "./practiceHistory";

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
class SilentAudio {
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

it("saves a real playback completion once, preserves pauses, and displays history from navigation", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(1);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  advance(30);
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(22);
  const passes = parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!);
  expect(passes).toHaveLength(1);
  expect(passes[0]).toMatchObject({ mode: "listen", hand: "both", speedMin: 100, speedMax: 100, startSeconds: 0, pieceTitle: "Morning Light" });
  advance(30);
  expect(parsePracticeHistory(localStorage.getItem(HISTORY_KEY)!)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice history" }));
  expect(screen.getByText("Small steps, remembered.")).toBeTruthy();
  expect(screen.getByText(/Listening pass.*no performance score/)).toBeTruthy();
});

it("navigation and restarts discard unfinished attempts rather than adding records", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(1);
  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(1);
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice history" }));
  expect(screen.getByText("Ready for your first pass.")).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});

it("keeps playback usable when history storage is full and warns before closing", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  if (screen.queryByRole("dialog", { name: "Practice setup" })) fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(22);
  expect(screen.getByText(/These passes are temporary/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice history" }));
  expect(screen.getByText(/1 completed pass · temporary/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Export history" }) as HTMLButtonElement).disabled).toBe(false);
});
