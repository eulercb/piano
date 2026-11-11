// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import type { Song } from "./music";
import { HISTORY_KEY, parsePracticeHistory } from "./practiceHistory";
import { stubDialogs } from "./testDialog";

// Real App/session/history with a controllable audio clock. This is synthetic
// lifecycle coverage, not actual browser audio, Android or physical MIDI QA.
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
const song: Song = { id: "audio-fixture", title: "Audio practice", tempo: 60, notes: [
  ...[60, 62, 64].map((pitch, start) => ({ id: `right-${start}`, pitch, start, duration: .5, velocity: .7, hand: "right" as const })),
  ...[48, 50, 52].map((pitch, start) => ({ id: `left-${start}`, pitch, start, duration: .5, velocity: .7, hand: "left" as const })),
] };
function deferred() {
  let resolve!: () => void, reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class ControlledAudio extends EventTarget {
  static instances: ControlledAudio[] = [];
  static initialState = "running";
  static initialResume = () => Promise.resolve();
  currentTime = 0; destination = {}; state = ControlledAudio.initialState;
  starts: number[] = []; stoppedImmediately = 0;
  resume = vi.fn(ControlledAudio.initialResume);
  close = vi.fn(async () => { this.change("closed"); });
  constructor() { super(); ControlledAudio.instances.push(this); }
  createOscillator() {
    return { frequency: { value: 0 }, connect() {}, disconnect() {}, onended: null,
      start: () => { this.starts.push(this.currentTime); },
      stop: (time?: number) => { if (time === undefined) this.stoppedImmediately++; } };
  }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  change(state: string, notify = true) {
    this.state = state;
    if (notify) this.dispatchEvent(new Event("statechange"));
  }
}
let now = 0, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function advance(seconds: number) {
  act(() => { for (let i = 0; i < Math.round(seconds * 10); i++) {
    now += 100;
    for (const audio of ControlledAudio.instances) if (audio.state === "running") audio.currentTime += .1;
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now));
  } });
}
const context = () => ControlledAudio.instances.at(-1)!;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const position = () => Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value);
const passes = () => { const saved = localStorage.getItem(HISTORY_KEY); return saved ? parsePracticeHistory(saved) : []; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function prepare(mode = "Rhythm practice", countIn = false) {
  const view = render(<App />); click("My library"); fireEvent.click(screen.getByRole("button", { name: /Audio practice/ }));
  click("Practice setup"); click("Right");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${mode}`) }));
  if (!countIn) fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } }); click("Done");
  return view;
}
function hidden(value: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}
function pendingStart() {
  const pending = deferred();
  ControlledAudio.initialState = "suspended";
  ControlledAudio.initialResume = () => pending.promise;
  prepare(); click("Play");
  expect(screen.getByRole("button", { name: "Cancel audio start" })).toBeTruthy();
  return pending;
}
beforeEach(() => {
  stubDialogs(); localStorage.clear(); localStorage.setItem("piano-songs", JSON.stringify([song]));
  now = frameId = 0; frames.clear(); ControlledAudio.instances = [];
  ControlledAudio.initialState = "running"; ControlledAudio.initialResume = () => Promise.resolve();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("AudioContext", ControlledAudio); hidden(false);
});
afterEach(async () => {
  cleanup(); vi.runAllTimers(); await settle(); vi.useRealTimers();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "hidden"); localStorage.clear();
});

it.each(["suspended", "interrupted", "closed"])("preserves partial count-in immediately when visible audio becomes %s, even with a queued frame", async state => {
  prepare("Rhythm practice", true); click("Play"); advance(1.5);
  expect(screen.getByText("Get ready · 2 of 4 beats")).toBeTruthy();
  const audio = context(), count = audio.starts.length, queued = [...frames.values()];
  act(() => audio.change(state));
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(screen.getByText(/Audio interrupted/)).toBeTruthy();
  expect(audio.stoppedImmediately).toBeGreaterThan(0);
  act(() => { now += 100; queued.forEach(frame => frame(now)); });
  advance(20); expect(position()).toBe(0); expect(passes()).toHaveLength(0);
  expect(audio.starts).toHaveLength(count);
  if (state !== "closed") act(() => audio.change("running"));
  advance(1); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  click("Play"); expect(screen.getByText("Get ready · 2 of 4 beats")).toBeTruthy(); advance(.5);
  expect(screen.getByText("Get ready · 3 of 4 beats")).toBeTruthy();
  if (state === "closed") expect(ControlledAudio.instances).toHaveLength(2);
});

it.each(["Listen", "Melody practice · wait for notes", "Rhythm practice"])("retains position and results in %s until explicit Play after recovery", async mode => {
  prepare(mode); click("Play"); click("Play C4"); advance(.2);
  const before = position(), audio = context();
  act(() => audio.change("suspended")); advance(20);
  expect(position()).toBe(before); expect(passes()).toHaveLength(0);
  act(() => audio.change("running")); click("Play D4"); advance(1);
  expect(position()).toBe(before); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  click("Play"); advance(.8); click("Play D4"); advance(1); click("Play E4"); advance(.5);
  await act(settle); expect(passes()).toHaveLength(1);
  if (mode === "Rhythm practice") expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it.each(["frame", "input"])("checks actual audio state before a %s when statechange has not arrived", source => {
  prepare(); click("Play"); advance(.2); const before = position(), audio = context(), count = audio.starts.length;
  audio.change("suspended", false);
  if (source === "frame") advance(.1);
  else click("Play C4");
  expect(position()).toBe(before); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(audio.starts).toHaveLength(count); advance(20); expect(passes()).toHaveLength(0);
});

it("waits for resume to resolve running without consuming time, then starts the requested pass", async () => {
  const pending = pendingStart(); advance(20);
  expect(position()).toBe(0); expect(context().starts).toHaveLength(0); expect(passes()).toHaveLength(0);
  act(() => context().change("running")); advance(1);
  expect(screen.getByRole("button", { name: "Cancel audio start" })).toBeTruthy();
  await act(async () => { pending.resolve(); await settle(); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); expect(position()).toBe(0);
  click("Play C4"); advance(.1); expect(position()).toBeCloseTo(.1);
});

it.each(["reject", "resolve still suspended", "throw"])("keeps failed audio resume paused (%s) and allows a successful retry", async outcome => {
  const pending = pendingStart(), audio = context(); advance(5);
  if (outcome === "throw") {
    click("Cancel audio start"); audio.resume.mockImplementationOnce(() => { throw Error("blocked"); }); click("Play");
  } else await act(async () => { if (outcome === "reject") pending.reject(Error("blocked")); else pending.resolve(); await settle(); });
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); expect(screen.getByText(/Audio could not start/)).toBeTruthy();
  expect(position()).toBe(0); expect(passes()).toHaveLength(0); expect(audio.starts).toHaveLength(0);
  audio.resume.mockImplementationOnce(async () => { audio.change("running"); });
  await act(async () => { click("Play"); await settle(); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); expect(position()).toBe(0);
});

it.each(["Cancel audio start", "Restart", "seek", "Practice setup", "Piano connection", "My library", "Prepare a song", "Practice history", "hidden", "Mute"])("invalidates pending audio start on %s without later autostart", async action => {
  const pending = pendingStart(), audio = context();
  if (action === "seek") fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: "1" } });
  else if (action === "hidden") hidden(true);
  else if (action === "Prepare a song" || action === "Practice history") { click("Practice setup"); click(action); }
  else click(action);
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  advance(20); expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel audio start" })).toBeNull();
  expect(audio.starts).toHaveLength(0); expect(passes()).toHaveLength(0);
  if (action === "hidden") { hidden(false); advance(1); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); }
});

it("ignores a stale resume result while a newer Play request is pending", async () => {
  const older = pendingStart(), audio = context(), newer = deferred();
  click("Cancel audio start"); audio.resume.mockImplementationOnce(() => newer.promise); click("Play");
  await act(async () => { older.reject(Error("old failure")); await settle(); });
  expect(screen.getByRole("button", { name: "Cancel audio start" })).toBeTruthy();
  expect(screen.queryByText(/Audio could not start/)).toBeNull();
  await act(async () => { audio.change("running"); newer.resolve(); await settle(); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); expect(position()).toBe(0);
});

it("never starts a new selection or changed hand after an older audio resume", async () => {
  const pending = pendingStart(), audio = context();
  click("Practice setup"); click("Left"); click("Done");
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  advance(20); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); expect(position()).toBe(0);
  expect(audio.starts).toHaveLength(0); expect(passes()).toHaveLength(0);
  click("My library"); fireEvent.click(screen.getByRole("button", { name: /Morning Light/ }));
  advance(1); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); expect(position()).toBe(0);
});

it("allows intentional muted practice without an AudioContext and pauses before unmuting unavailable audio", async () => {
  vi.stubGlobal("AudioContext", class { constructor() { throw Error("unavailable"); } });
  prepare(); click("Play"); expect(screen.getByText(/Audio could not start/)).toBeTruthy();
  click("Mute"); click("Play"); click("Play C4"); advance(.2); click("Unmute");
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); expect(position()).toBeCloseTo(.2);
  expect(screen.getByText(/Audio interrupted/)).toBeTruthy(); advance(20); expect(passes()).toHaveLength(0);
  click("Mute"); click("Play"); advance(.8); click("Play D4"); advance(1); click("Play E4"); advance(.5);
  await act(settle); expect(passes()).toHaveLength(1); expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0 });
  expect(ControlledAudio.instances).toHaveLength(0);
});

it("does not pause a deliberately muted pass when an existing context is interrupted", async () => {
  prepare(); click("Play"); click("Play C4"); advance(.2); click("Mute");
  const audio = context(), sounds = audio.starts.length; act(() => audio.change("suspended"));
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  advance(.8); click("Play D4"); advance(1); click("Play E4"); advance(.5); await act(settle);
  expect(passes()).toHaveLength(1); expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0 });
  expect(audio.starts).toHaveLength(sounds);
});

it("does not queue or replay old piano keys while audio is blocked", async () => {
  const pending = pendingStart(), audio = context(); click("Cancel audio start");
  click("Play C4"); click("Play D4"); advance(1);
  expect(audio.starts).toHaveLength(0);
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  expect(audio.starts).toHaveLength(0); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  click("Play E4"); expect(audio.starts).toHaveLength(1); expect(passes()).toHaveLength(0);
});

it("disposes context and stale resume on unmount and supports a fresh StrictMode mount", async () => {
  const pending = pendingStart(), audio = context(); cleanup();
  expect(audio.close).toHaveBeenCalledTimes(1);
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  expect(audio.starts).toHaveLength(0); expect(frames.size).toBe(0);
  ControlledAudio.initialState = "running"; render(<StrictMode><App /></StrictMode>); click("Play"); advance(.1);
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); expect(context()).not.toBe(audio);
});

it("preserves saved songs, completed history and a dirty Studio draft across audio loss", async () => {
  prepare("Listen"); click("Play"); advance(2.5); await act(settle);
  expect(passes()).toHaveLength(1);
  const savedSongs = localStorage.getItem("piano-songs"), savedHistory = localStorage.getItem(HISTORY_KEY);
  click("Practice setup"); click("Prepare a song");
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
  click("Practice room"); click("Play"); advance(.2);
  act(() => context().change("suspended")); advance(20); act(() => context().change("running"));
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(localStorage.getItem("piano-songs")).toBe(savedSongs); expect(localStorage.getItem(HISTORY_KEY)).toBe(savedHistory);
  click("Practice setup"); click("Prepare a song");
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  const closing = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(closing); expect(closing.defaultPrevented).toBe(true);
});

it.each(["Melody practice · wait for notes", "Rhythm practice"])("retains a partially matched chord after audio recovery in %s", async mode => {
  localStorage.setItem("piano-songs", JSON.stringify([{ ...song, notes: [
    ...[60, 64, 67].map((pitch, i) => ({ id: `chord-${i}`, pitch, start: 0, duration: .5, velocity: .7, hand: "right" })),
    { id: "next", pitch: 62, start: 1, duration: .5, velocity: .7, hand: "right" },
  ] }]));
  prepare(mode); click("Play"); click("Play C4");
  act(() => context().change("suspended")); advance(20);
  act(() => context().change("running")); click("Play E4"); click("Play G4"); advance(.1);
  expect(position()).toBe(0); expect(passes()).toHaveLength(0);
  click("Play"); click("Play E4"); click("Play G4"); advance(1); click("Play D4"); advance(.5);
  await act(settle); expect(passes()).toHaveLength(1);
  if (mode === "Rhythm practice") expect(passes()[0].rhythm).toMatchObject({ onTime: 4, missed: 0, extra: 0 });
});

it("cancels pending audio Play when the selected MIDI input disconnects", async () => {
  const pending = deferred();
  ControlledAudio.initialState = "suspended"; ControlledAudio.initialResume = () => pending.promise;
  const port = { id: "piano", name: "USB Piano", manufacturer: "Casio", state: "connected", connection: "closed",
    onmidimessage: null, async open() { this.connection = "open"; }, async close() { this.connection = "closed"; } };
  const access = { inputs: new Map([[port.id, port]]), onstatechange: null as (() => void) | null };
  const oldMidi = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => access });
  try {
    prepare(); click("Piano connection"); await act(async () => { click("Connect piano"); await settle(); }); click("Done");
    click("Play"); const audio = context(); expect(screen.getByRole("button", { name: "Cancel audio start" })).toBeTruthy();
    await act(async () => { port.state = "disconnected"; access.inputs.clear(); access.onstatechange?.(); await settle(); });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.queryByText(/Starting audio/)).toBeNull();
    await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
    advance(20); expect(position()).toBe(0); expect(passes()).toHaveLength(0); expect(audio.starts).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  } finally {
    cleanup(); await settle();
    if (oldMidi) Object.defineProperty(navigator, "requestMIDIAccess", oldMidi);
    else Reflect.deleteProperty(navigator, "requestMIDIAccess");
  }
});


it.each(["slider", "preset"])("cancels pending Studio audio start when the tempo %s changes", async control => {
  prepare("Listen"); click("Practice setup"); click("Prepare a song");
  const pending = deferred();
  ControlledAudio.initialState = "suspended"; ControlledAudio.initialResume = () => pending.promise;
  click("Play"); const audio = context();
  expect(screen.getByRole("button", { name: "Cancel audio start" })).toBeTruthy();
  if (control === "slider") fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "50" } });
  else click("50%");
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  advance(20); expect(position()).toBe(0); expect(audio.starts).toHaveLength(0); expect(passes()).toHaveLength(0);
  click("Play"); advance(5.1); await act(settle);
  expect(passes()).toHaveLength(1); expect(passes()[0]).toMatchObject({ speedMin: 50, speedMax: 50 });
});


it("adversarial: a new piece selected before pending resume does not auto-start or mutate history", async () => {
  const pending = pendingStart(), audio = context();
  click("My library"); fireEvent.click(screen.getByRole("button", { name: /Morning Light/ }));
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  advance(20);
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(position()).toBe(0); expect(audio.starts).toHaveLength(0); expect(passes()).toHaveLength(0);
});

it("adversarial: old resolved resume cannot start the newer pending attempt", async () => {
  const old = pendingStart(), audio = context(), next = deferred();
  click("Cancel audio start"); audio.resume.mockImplementationOnce(() => next.promise); click("Play");
  await act(async () => { audio.change("running"); old.resolve(); await settle(); });
  advance(20); expect(position()).toBe(0); expect(passes()).toHaveLength(0); expect(audio.starts).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Cancel audio start" })).toBeTruthy();
  await act(async () => { next.resolve(); await settle(); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy(); expect(position()).toBe(0);
});

it("adversarial: unavailable audio before input cannot add an extra press or complete history", async () => {
  prepare(); click("Play"); click("Play C4"); advance(.2); const audio = context();
  audio.change("suspended", false); click("Play E4"); advance(20);
  expect(position()).toBeCloseTo(.2); expect(passes()).toHaveLength(0);
  click("Results");
  expect([...document.querySelectorAll(".timing-summary dd")].map(e => e.textContent)).toEqual(["1 / 3", "0", "0", "0", "0"]);
});

it("adversarial: unmute of an already running context continues intentional muted rhythm", async () => {
  prepare(); click("Play"); click("Play C4"); advance(.2); click("Mute");
  advance(.8); click("Play D4"); click("Unmute");
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  advance(1); click("Play E4"); advance(.5); await act(settle);
  expect(passes()).toHaveLength(1); expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it("adversarial: pending preview is invalidated by unmount along with its key timer", async () => {
  const pending = deferred(); ControlledAudio.initialState = "suspended"; ControlledAudio.initialResume = () => pending.promise;
  const view = prepare(); const beforeTimers = vi.getTimerCount(); click("Play C4"); const audio = context();
  expect(vi.getTimerCount()).toBe(beforeTimers + 1); view.unmount(); expect(vi.getTimerCount()).toBeLessThanOrEqual(beforeTimers);
  await act(async () => { audio.change("running"); pending.resolve(); await settle(); });
  expect(audio.starts).toHaveLength(0); expect(frames.size).toBe(0); expect(audio.close).toHaveBeenCalledTimes(1);
});
