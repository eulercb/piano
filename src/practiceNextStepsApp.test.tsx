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
function openStudy(mode: "listen" | "melody" | "rhythm" | "recital" = "listen", hand = "Right") {
  render(<App />); click("My library"); click(/Synthetic short study/); setup();
  click(hand);
  click(mode === "listen" ? /^Listen & explore/ : mode === "melody" ? /^Melody practice/ : mode === "recital" ? /^Recital practice/ : /^Rhythm practice/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); close();
}
function complete(mode: "listen" | "melody" | "rhythm" | "recital") {
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

it("does not turn an unfinished or paused pass into a progression suggestion", () => {
  openStudy(); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull();
  expect(screen.getByText(/Pauses and unfinished attempts are not failures/)).toBeTruthy(); close();
  click("Play"); advance(.5); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("offers a gentle waiting pass after listening and requires deliberate Play with focus returned", () => {
  openStudy(); complete("listen"); const before = localStorage.getItem(SONGS_KEY);
  results(); expect(screen.getByText(/It is not a performance score/)).toBeTruthy();
  click(/Try waiting for notes Right hand · 50%/);
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(button("Results"));
  expect(screen.getByText("Right hand · 50% · Wait for notes")).toBeTruthy();
  expect(position()).toBe(0); advance(10); expect(position()).toBe(0);
  expect(button("Play")).toBeTruthy(); expect(history()).toHaveLength(1);
  expect(history()[0].mode).toBe("listen"); expect(localStorage.getItem(SONGS_KEY)).toBe(before);
  click("Play"); advance(1); expect(position()).toBe(0);
  click("Play C4"); advance(.2); expect(position()).toBeGreaterThan(0);
});
it.each(["melody", "rhythm", "recital"] as const)("offers manual +5%% progress after %s while preserving the completed pass", mode => {
  openStudy(mode); complete(mode); const saved = localStorage.getItem(SONGS_KEY), oldHistory = localStorage.getItem(HISTORY_KEY);
  results(); click(/Try a small speed increase Right hand · 55%/);
  expect(screen.getByText(`Right hand · 55% · ${mode === "melody" ? "Wait for notes" : mode === "recital" ? "Recital" : "Rhythm"}`)).toBeTruthy();
  expect(position()).toBe(0); advance(5); expect(position()).toBe(0);
  expect(localStorage.getItem(SONGS_KEY)).toBe(saved); expect(localStorage.getItem(HISTORY_KEY)).toBe(oldHistory);
  click("Play"); click("Play C4"); advance(2);
  expect(history()).toHaveLength(2); expect(history()[0]).toMatchObject({ mode, speedMin: 55, speedMax: 55, tempo: 120 });
});
it("lets rhythm return to slower wait-for-notes when introducing the other hand or both", () => {
  openStudy("rhythm"); setup(); click("100%"); close(); click("Play"); click("Play C4"); advance(1.2);
  results(); click(/Bring both hands together Both hands · 50% · Wait for notes/);
  expect(screen.getByText("Both hands · 50% · Wait for notes")).toBeTruthy();
  click("Play"); click("Play C4"); advance(1); expect(position()).toBe(0);
  click("Play C3"); advance(2.2); results();
  expect(screen.getByRole("button", { name: /Focus on the left hand Left hand · 50%/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Focus on the right hand Right hand · 50%/ })).toBeTruthy();
});
it("preserves count-in and does not offer progression after seeking beyond every target", () => {
  openStudy(); setup(); fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); close();
  fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: ".25" } });
  // Seek excludes both notes here, so completion correctly does not offer achievements.
  click("Play"); advance(6); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull(); close();
  click("Restart"); click("Play"); advance(6.2); results();
  click(/Repeat from beginning Right hand · 50% · Listen/);
  expect(position()).toBe(0); setup();
  expect((screen.getByRole("checkbox", { name: "Count in 4 beats" }) as HTMLInputElement).checked).toBe(true); close();
  click("Play"); advance(1); expect(position()).toBe(0); expect(screen.getByText(/Get ready ·/)).toBeTruthy();
});
it("labels a seeked completion and explicitly starts next-step practice from the beginning", () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...study, notes: [study.notes[1],
    { ...study.notes[1], id: "later-right", start: .5, duration: .2, pitch: 62 }] }]));
  openStudy();
  fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: ".25" } });
  click("Play"); advance(1.6); expect(history()[0]).toMatchObject({ startSeconds: .25, noteCount: 1 });
  results();
  expect(screen.getByText(/These choices restart the selected piece or prepared passage from its beginning/)).toBeTruthy();
  click(/Repeat from beginning Right hand · 50% · Listen/);
  expect(position()).toBe(0); advance(2); expect(position()).toBe(0);
  click("Play"); advance(2.2); expect(history()[0]).toMatchObject({ startSeconds: 0, noteCount: 2 });
});
it("shows the latest finished loop without completing the new loop when Results pauses it", () => {
  openStudy("rhythm"); setup(); fireEvent.click(screen.getByRole("checkbox", { name: "Repeat this passage" })); close();
  click("Play"); click("Play C4"); advance(2.2); results();
  expect(history()).toHaveLength(1); expect(screen.getByRole("region", { name: "Next practice step" })).toBeTruthy();
  click(/Take it a little slower Right hand · 45%/);
  expect(button("Play")).toBeTruthy(); advance(10); expect(history()).toHaveLength(1);
  setup(); expect((screen.getByRole("checkbox", { name: "Repeat this passage" }) as HTMLInputElement).checked).toBe(true);
});
it("clears stale next steps after restart, speed change, hand change and navigation", () => {
  openStudy(); complete("listen"); click("Restart"); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull(); close();
  complete("listen"); setup(); click("75%"); close(); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull(); close();
  click("Play"); advance(1.5); setup(); click("Left"); close(); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull(); close();
  click("My library"); click("Practice room"); results();
  expect(screen.queryByRole("region", { name: "Next practice step" })).toBeNull();
});
it("keeps an unsaved Studio fingering intact through next steps and the shorter-passage link", () => {
  openStudy(); setup(); click("Prepare a song");
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
  click("Practice room"); complete("listen"); results(); click(/Try waiting for notes/);
  complete("melody"); results(); click("Choose a shorter passage in Studio");
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  expect(JSON.parse(localStorage.getItem(SONGS_KEY)!)[0].notes[0].finger).toBe(2);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it("keeps choices usable with temporary history when storage fails", () => {
  openStudy(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  complete("listen"); results(); click(/Try waiting for notes/);
  expect(screen.getByText(/These passes are temporary/)).toBeTruthy();
  expect(screen.getByText("Right hand · 50% · Wait for notes")).toBeTruthy();
});
it("does not change anything when results are dismissed repeatedly or canceled", () => {
  openStudy("melody"); complete("melody"); const saved = localStorage.getItem(HISTORY_KEY);
  for (let i = 0; i < 3; i++) {
    const panel = results(); expect(within(panel).getByRole("region", { name: "Next practice step" })).toBeTruthy();
    fireEvent(panel, new Event("cancel", { cancelable: true }));
    expect(document.activeElement).toBe(button("Results")); expect(button("Play")).toBeTruthy();
  }
  expect(position()).toBe(1); expect(localStorage.getItem(HISTORY_KEY)).toBe(saved);
});


it("keeps recital moving without live counts, then reveals only the completed result and saves it", () => {
  openStudy("recital"); const saved = localStorage.getItem(SONGS_KEY);
  expect(screen.getByText("Right hand · 50% · Recital")).toBeTruthy();
  click("Play"); click("Play C4"); click("Play C♯4"); advance(.4);
  expect(position()).toBeGreaterThan(0);
  expect(screen.queryByText("On time")).toBeNull();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  const panel = results();
  expect(within(panel).getByText(/Feedback appears after the pass/)).toBeTruthy();
  expect(within(panel).queryByText("On time")).toBeNull();
  close(); click("Play"); advance(2);
  expect(history()[0]).toMatchObject({ mode: "recital", rhythm: { total: 1, onTime: 1, extra: 1, missed: 0 } });
  const completed = results();
  expect(within(completed).getByText("On time")).toBeTruthy();
  expect(within(completed).getByText("1 / 1")).toBeTruthy();
  expect(localStorage.getItem(SONGS_KEY)).toBe(saved);
});
it("offers recital after rhythm and returns to live feedback only on explicit choice", () => {
  openStudy("rhythm"); complete("rhythm"); results();
  click(/Try an uninterrupted pass Right hand · 50% · Recital/);
  expect(button("Play")).toBeTruthy(); expect(position()).toBe(0);
  advance(3); expect(position()).toBe(0);
  complete("recital"); results();
  click(/Return to live timing feedback Right hand · 50% · Rhythm/);
  expect(button("Play")).toBeTruthy(); expect(position()).toBe(0);
  expect(history().map(p => p.mode)).toEqual(["recital", "rhythm"]);
});
it("shows the finished recital loop without publishing partial counts for the new loop", () => {
  openStudy("recital"); setup(); fireEvent.click(screen.getByRole("checkbox", { name: "Repeat this passage" })); close();
  click("Play"); click("Play C4"); advance(2.2);
  const panel = results();
  expect(history()).toHaveLength(1);
  expect(within(panel).getByText("Previous completed pass")).toBeTruthy();
  expect(within(panel).getAllByText("On time")).toHaveLength(1);
  expect(within(panel).getByText(/Feedback appears after the pass/)).toBeTruthy();
  close(); click("Restart"); results();
  expect(screen.queryByText("Previous completed pass")).toBeNull();
  expect(history()).toHaveLength(1);
});

it("discards an abandoned recital recording on seek and keeps only the remaining targets", () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...study, notes: [study.notes[1],
    { ...study.notes[1], id: "later-right", start: .5, duration: .2, pitch: 62 }] }]));
  openStudy("recital"); click("Play"); click("Play C4"); click("Play C♯4"); advance(.2);
  fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: ".5" } });
  click("Play"); click("Play D4"); advance(1.2);
  expect(history()).toHaveLength(1);
  expect(history()[0]).toMatchObject({ mode: "recital", startSeconds: .5, noteCount: 1,
    rhythm: { onTime: 1, extra: 0, missed: 0 } });
  click("Restart"); complete("recital");
  expect(history()[0]).toMatchObject({ mode: "recital", startSeconds: 0, noteCount: 2,
    rhythm: { onTime: 1, extra: 0, missed: 1 } });
});
it("ignores recital count-in presses and preserves completed counts after a remount", () => {
  openStudy("recital"); setup();
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); close();
  click("Play"); click("Play C♯4"); advance(4); click("Play C4"); advance(2.2);
  expect(history()[0]).toMatchObject({ mode: "recital", rhythm: { onTime: 1, extra: 0, missed: 0 } });
  const saved = localStorage.getItem(HISTORY_KEY);
  cleanup(); render(<App />); setup(); click("Practice history");
  expect(screen.getByText(/Recital/)).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBe(saved);
});
