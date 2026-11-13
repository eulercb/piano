// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import type { Song } from "./music";
import type { MidiAccess, MidiInputPort, RequestMidiAccess } from "./midiInput";
import { HISTORY_KEY, parsePracticeHistory } from "./practiceHistory";
import { stubDialogs } from "./testDialog";

// Exercise the real connection component, controller, modal wiring, session and
// history together. Permission, ports, native dialogs, audio and time are fake;
// this does not verify an Android/Casio connection or a browser permission UI.
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function message(handler: MIDIInput["onmidimessage"], port: MidiInputPort, bytes: number[]) {
  handler?.call(port as MIDIInput, { data: new Uint8Array(bytes) } as MIDIMessageEvent);
}
class FakeInput implements MidiInputPort {
  state: MIDIPortDeviceState = "connected";
  connection: MIDIPortConnectionState = "closed";
  onmidimessage: MIDIInput["onmidimessage"] = null;
  changed = () => {};
  open = vi.fn(async () => { this.connection = "open"; this.changed(); });
  close = vi.fn(async () => { this.connection = "closed"; this.changed(); });
  constructor(readonly id: string, readonly name = "USB Piano", readonly manufacturer = "Casio") {}
  emit(pitch: number, velocity = 90) { message(this.onmidimessage, this, [0x90, pitch, velocity]); }
}
class FakeAccess implements MidiAccess {
  inputs = new Map<string, FakeInput>();
  onstatechange: MIDIAccess["onstatechange"] = null;
  constructor(...inputs: FakeInput[]) { inputs.forEach(input => this.add(input)); }
  changed() { this.onstatechange?.call(this as unknown as MIDIAccess, {} as MIDIConnectionEvent); }
  add(input: FakeInput) { this.inputs.set(input.id, input); input.changed = () => this.changed(); this.changed(); }
  unplug(input: FakeInput) {
    input.state = "disconnected"; input.connection = "closed";
    this.inputs.delete(input.id); this.changed();
  }
}
let stoppedVoices = 0;
class SilentAudio extends EventTarget {
  state = "running";
  close() { return Promise.resolve(); }
  currentTime = 0; destination = {};
  resume() { return Promise.resolve(); }
  createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() { stoppedVoices++; }, onended: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
const song: Song = { id: "midi-fixture", title: "Synthetic MIDI practice", tempo: 60, notes: [
  ...[60, 62, 64].map((pitch, start) => ({ id: `right-${start}`, pitch, start, duration: .5, velocity: .7, hand: "right" as const })),
  { id: "left", pitch: 48, start: 0, duration: .5, velocity: .7, hand: "left" },
] };
let now = 0, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function advance(seconds: number) {
  act(() => { for (let i = 0; i < Math.round(seconds * 10); i++) {
    now += 100; const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(now));
  } });
}
const button = (name: string) => screen.getByRole("button", { name });
const click = (name: string) => fireEvent.click(button(name));
const position = () => Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value);
const passes = () => {
  const saved = localStorage.getItem(HISTORY_KEY);
  return saved ? parsePracticeHistory(saved) : [];
};
function openPiano() { click("Piano connection"); return screen.getByRole("dialog", { name: "Piano connection" }); }
function prepare(mode = "Melody practice · wait for notes") {
  click("My library"); fireEvent.click(screen.getByRole("button", { name: new RegExp(song.title) }));
  openPracticeRoom(); click("Practice setup"); click("Right");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${mode}`) }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  click("Done");
}
function requestMidi(request: RequestMidiAccess) {
  const original = Object.getOwnPropertyDescriptor(navigator, "requestMIDIAccess");
  Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: request });
  return () => {
    if (original) Object.defineProperty(navigator, "requestMIDIAccess", original);
    else Reflect.deleteProperty(navigator, "requestMIDIAccess");
  };
}
let restoreMidi: (() => void) | undefined;
beforeEach(() => {
  stubDialogs(); localStorage.clear(); localStorage.setItem("piano-songs", JSON.stringify([song]));
  now = frameId = stoppedVoices = 0; frames.clear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("AudioContext", SilentAudio);
});
afterEach(async () => {
  cleanup(); await settle(); restoreMidi?.(); restoreMidi = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});

it("finishes a real melody pass after permission resolves behind the closed panel and navigation", async () => {
  const permission = deferred<MidiAccess>(), piano = new FakeInput("piano");
  const request = vi.fn(() => permission.promise);
  restoreMidi = requestMidi(request);
  renderPractice(<App />);
  expect(request).not.toHaveBeenCalled();
  openPiano(); click("Connect piano");
  expect((button("Connecting…") as HTMLButtonElement).disabled).toBe(true);
  click("Done"); prepare();
  await act(async () => { permission.resolve(new FakeAccess(piano)); await settle(); });
  expect(request).toHaveBeenCalledExactlyOnceWith({ sysex: false });
  expect(piano.open).toHaveBeenCalledTimes(1);
  openPracticeRoom(); click("Play"); advance(.5);
  act(() => piano.emit(61)); advance(.2); expect(position()).toBe(0);
  for (const [index, pitch] of [60, 62, 64].entries()) {
    act(() => piano.emit(pitch)); advance(1);
    expect(position()).toBeCloseTo(Math.min(index + 1, 2.5));
  }
  expect(passes()).toHaveLength(1);
  expect(passes()[0]).toMatchObject({ pieceId: song.id, hand: "right", mode: "melody", noteCount: 3 });
  const panel = openPiano();
  expect(within(panel).getByText("Last note: E4 · 4 notes received")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it("cancels delayed permission, retries on reopening and ignores the obsolete result", async () => {
  const oldPermission = deferred<MidiAccess>(), currentPermission = deferred<MidiAccess>();
  const old = new FakeInput("obsolete"), piano = new FakeInput("current");
  const request = vi.fn<RequestMidiAccess>().mockReturnValueOnce(oldPermission.promise).mockReturnValueOnce(currentPermission.promise);
  restoreMidi = requestMidi(request);
  renderPractice(<App />); prepare(); openPiano(); click("Connect piano"); click("Cancel connection"); click("Done");
  openPiano(); click("Connect piano"); click("Done");
  const staleAccess = new FakeAccess(old);
  await act(async () => { currentPermission.resolve(new FakeAccess(piano)); await settle(); oldPermission.resolve(staleAccess); await settle(); });
  expect(staleAccess.onstatechange).toBeNull(); expect(old.open).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(2);
  openPracticeRoom(); click("Play"); act(() => old.emit(60)); advance(.5); expect(position()).toBe(0);
  act(() => piano.emit(60)); advance(.5); expect(position()).toBeCloseTo(.5);
  expect(within(openPiano()).getByText("Last note: C4 · 1 note received")).toBeTruthy();
});

it("recovers only the selected input after unplugging and ignores stale or unselected messages", async () => {
  const piano = new FakeInput("piano"), other = new FakeInput("other", "Other");
  const access = new FakeAccess(piano, other), request = vi.fn(async () => access);
  restoreMidi = requestMidi(request);
  renderPractice(<App />); prepare(); openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "Piano input" }), { target: { value: "piano" } }); await settle(); });
  const staleMessage = piano.onmidimessage;
  click("Done"); openPracticeRoom(); click("Play");
  act(() => { other.emit(60); piano.emit(60, 0); }); advance(.5); expect(position()).toBe(0);
  act(() => piano.emit(60)); advance(1); expect(position()).toBeCloseTo(1);
  await act(async () => { access.unplug(piano); await settle(); });
  expect(button("Play")).toBeTruthy();
  expect(screen.getByText("Piano not connected · practice paused")).toBeTruthy();
  act(() => { message(staleMessage, piano, [0x90, 62, 90]); other.emit(62); });
  advance(.5); expect(position()).toBeCloseTo(1);
  let panel = openPiano();
  expect(within(panel).getByRole("status").textContent).toContain("disconnected");
  expect((within(panel).getByRole("combobox", { name: "Piano input" }) as HTMLSelectElement).value).toBe("piano");
  expect(other.open).not.toHaveBeenCalled(); click("Done");
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  expect(screen.getByText("Piano ready · press Play to continue")).toBeTruthy();
  act(() => replacement.emit(62)); advance(.5); expect(position()).toBeCloseTo(1);
  openPracticeRoom(); click("Play");
  act(() => { message(staleMessage, piano, [0x90, 62, 90]); replacement.emit(62, 0); });
  advance(.5); expect(position()).toBeCloseTo(1);
  act(() => replacement.emit(62)); advance(1); expect(position()).toBeCloseTo(2);
  panel = openPiano();
  expect(within(panel).getByText("Last note: D4 · 2 notes received")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it("pauses rhythm for panel reopen and reconnect, then delivers each new press only once", async () => {
  const piano = new FakeInput("piano"), access = new FakeAccess(piano), request = vi.fn(async () => access);
  restoreMidi = requestMidi(request);
  renderPractice(<App />); prepare("Rhythm practice"); openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  click("Done"); openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(1); act(() => piano.emit(62));
  const saved = position();
  for (let i = 0; i < 3; i++) {
    openPiano(); act(() => piano.emit(64)); advance(1); expect(position()).toBe(saved); click("Done");
    expect(button("Play")).toBeTruthy();
  }
  expect(request).toHaveBeenCalledTimes(1); expect(piano.open).toHaveBeenCalledTimes(1);
  openPiano(); const staleMessage = piano.onmidimessage;
  await act(async () => { click("Reconnect piano"); await settle(); });
  expect(piano.open).toHaveBeenCalledTimes(2); expect(piano.close).toHaveBeenCalledTimes(1);
  click("Done"); openPracticeRoom(); click("Play"); advance(1);
  act(() => { message(staleMessage, piano, [0x90, 64, 90]); piano.emit(64); }); advance(1);
  expect(passes()).toHaveLength(1);
  expect(passes()[0]).toMatchObject({ mode: "rhythm", hand: "right", rhythm: { total: 3, onTime: 3, missed: 0, extra: 0 } });
  expect(within(openPiano()).getByText("Last note: E4 · 1 note received")).toBeTruthy();
});


it("keeps touch practice usable after denial and recovers from an empty list and an input-open failure", async () => {
  const access = new FakeAccess(), piano = new FakeInput("piano");
  const request = vi.fn<RequestMidiAccess>().mockRejectedValueOnce({ name: "NotAllowedError" }).mockResolvedValue(access);
  restoreMidi = requestMidi(request);
  renderPractice(<App />); prepare(); let panel = openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  expect(within(panel).getByRole("status").textContent).toContain("MIDI access was denied");
  click("Done"); openPracticeRoom(); click("Play"); click("Play C4"); advance(.5); expect(position()).toBeCloseTo(.5);
  panel = openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  expect(within(panel).getByRole("status").textContent).toContain("No MIDI inputs found");
  piano.open.mockRejectedValueOnce(new Error("device busy"));
  await act(async () => { access.add(piano); await settle(); });
  expect(piano.open).not.toHaveBeenCalled();
  await act(async () => { fireEvent.change(within(panel).getByRole("combobox", { name: "Piano input" }), { target: { value: "piano" } }); await settle(); });
  expect(within(panel).getByRole("status").textContent).toContain("Could not open this MIDI input");
  await act(async () => { access.changed(); await settle(); });
  expect(piano.open).toHaveBeenCalledTimes(1);
  await act(async () => { click("Reconnect piano"); await settle(); });
  expect(within(panel).getByRole("status").textContent).toContain("Connected to Casio");
  expect(piano.open).toHaveBeenCalledTimes(2);
  click("Done"); openPracticeRoom(); click("Play"); advance(.5); act(() => piano.emit(62)); advance(.5);
  expect(position()).toBeCloseTo(1.5);
  expect(request).toHaveBeenCalledTimes(3);
});

async function connectPiano(piano: FakeInput, access = new FakeAccess(piano)) {
  restoreMidi = requestMidi(vi.fn(async () => access));
  renderPractice(<App />); prepare("Rhythm practice"); openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  if (access.inputs.size > 1) await act(async () => {
    fireEvent.change(screen.getByRole("combobox", { name: "Piano input" }), { target: { value: piano.id } });
    await settle();
  });
  click("Done");
  return access;
}

it("freezes rhythm immediately on selected-input loss, retaining grades without missed notes or a false completion", async () => {
  const piano = new FakeInput("piano"), other = new FakeInput("other", "Other");
  const access = await connectPiano(piano, new FakeAccess(piano, other));
  openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(.5);
  // A different input disappearing must not interrupt the selected piano.
  await act(async () => { access.unplug(other); await settle(); });
  expect(button("Pause")).toBeTruthy();
  const before = position(), staleFrames = [...frames.values()], oldMessage = piano.onmidimessage, stopsBeforeLoss = stoppedVoices;
  await act(async () => {
    access.unplug(piano);
    // Simulate another already-queued frame before React commits effect cleanup.
    now += 100; staleFrames.forEach(frame => frame(now));
    message(oldMessage, piano, [0x90, 62, 90]);
    await settle();
  });
  expect(position()).toBe(before); expect(button("Play")).toBeTruthy();
  expect(stoppedVoices).toBeGreaterThan(stopsBeforeLoss);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Piano not connected · practice paused")).toBeTruthy();
  advance(10); expect(position()).toBe(before); expect(passes()).toHaveLength(0);
  click("Results");
  const feedback = screen.getByRole("region", { name: "Rhythm feedback" });
  expect(feedback.querySelector(".timing-summary")!.textContent).toContain("On time1 / 3");
  expect(feedback.querySelector(".timing-summary")!.textContent).toContain("Missed0");
  click("Done");
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  act(() => replacement.emit(62)); advance(1); expect(position()).toBe(before);
  expect(button("Play")).toBeTruthy();
  openPracticeRoom(); click("Play"); advance(.5); act(() => replacement.emit(62)); advance(1); act(() => replacement.emit(64)); advance(.5);
  expect(passes()).toHaveLength(1);
  expect(passes()[0]).toMatchObject({ mode: "rhythm", rhythm: { total: 3, onTime: 3, missed: 0, extra: 0 } });
});

it.each(["Melody practice · wait for notes", "Rhythm practice", "Recital practice"])("keeps a partial count-in across unplug, delayed reopen and manual resume in %s", async (mode) => {
  const piano = new FakeInput("piano");
  const access = await connectPiano(piano);
  openPracticeRoom(); click("Practice setup"); fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${mode}`) }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); click("Done");
  openPracticeRoom(); click("Play"); advance(1.2); expect(screen.getByText("Get ready · 2 of 4 beats")).toBeTruthy();
  await act(async () => { access.unplug(piano); await settle(); });
  advance(5); expect(position()).toBe(0); expect(passes()).toHaveLength(0);
  const opening = deferred<void>(), replacement = new FakeInput("piano");
  replacement.open.mockImplementationOnce(async () => { await opening.promise; replacement.connection = "open"; replacement.changed(); });
  await act(async () => { access.add(replacement); await settle(); });
  expect(screen.getByText("Connecting piano · practice paused")).toBeTruthy();
  advance(1); expect(button("Play")).toBeTruthy();
  await act(async () => { opening.resolve(); await settle(); });
  advance(1); expect(button("Play")).toBeTruthy();
  openPracticeRoom(); click("Play"); expect(screen.getByText("Get ready · 2 of 4 beats")).toBeTruthy();
  advance(2.7); expect(screen.getByText("Get ready · 4 of 4 beats")).toBeTruthy();
  advance(.1); expect(screen.queryByText(/Get ready ·/)).toBeNull();
  act(() => replacement.emit(60)); advance(1); act(() => replacement.emit(62)); advance(1); act(() => replacement.emit(64)); advance(.5);
  expect(passes()).toHaveLength(1);
  if (mode === "Rhythm practice" || mode === "Recital practice") expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it.each(["closed", "pending"] as const)("pauses when the selected port becomes %s and retains the attempt through failed reconnect and explicit input switch", async (connection) => {
  const piano = new FakeInput("piano"), other = new FakeInput("other", "Other");
  const access = await connectPiano(piano, new FakeAccess(piano, other));
  openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(.5); const before = position();
  await act(async () => { piano.connection = connection; access.changed(); await settle(); });
  expect(button("Play")).toBeTruthy(); expect(piano.onmidimessage).toBeNull();
  expect(screen.getByText("Piano not connected · practice paused")).toBeTruthy();
  await act(async () => { access.changed(); await settle(); });
  expect(piano.open).toHaveBeenCalledTimes(1); expect(other.open).not.toHaveBeenCalled();
  click("Open Piano"); piano.open.mockRejectedValueOnce(new Error("device busy"));
  await act(async () => { click("Reconnect piano"); await settle(); });
  expect(screen.getByText(/Could not open this MIDI input/)).toBeTruthy();
  click("Done"); advance(1); expect(position()).toBe(before); expect(button("Play")).toBeTruthy();
  click("Open Piano");
  await act(async () => {
    fireEvent.change(screen.getByRole("combobox", { name: "Piano input" }), { target: { value: "other" } });
    await settle();
  });
  click("Done"); expect(screen.getByText("Piano ready · press Play to continue")).toBeTruthy();
  act(() => other.emit(62)); advance(.5); expect(position()).toBe(before);
  openPracticeRoom(); click("Play"); advance(.5); act(() => other.emit(62)); advance(1); act(() => other.emit(64)); advance(.5);
  expect(passes()).toHaveLength(1);
  expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it.each(["disconnect", "clear selection"])("clears the recovery reminder on intentional %s and permits touch/typing without automatic input switching", async (choice) => {
  const piano = new FakeInput("piano"), access = await connectPiano(piano);
  openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(.5);
  await act(async () => { access.unplug(piano); await settle(); });
  click("Open Piano");
  await act(async () => {
    if (choice === "disconnect") click("Disconnect");
    else fireEvent.change(screen.getByRole("combobox", { name: "Piano input" }), { target: { value: "" } });
    await settle();
  });
  click("Done");
  expect(screen.queryByText(/^Piano .*practice paused|^Piano ready/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Piano" })).toBeNull();
  expect(button("Play")).toBeTruthy();
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  expect(replacement.open).not.toHaveBeenCalled();
  openPracticeRoom(); click("Play"); advance(.5); click("Play D4"); advance(1);
  fireEvent.keyDown(document.body, { key: "d" }); advance(.5);
  expect(passes()).toHaveLength(1);
  expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it("does not interrupt touch rhythm for permission or an initial failed open before MIDI has become usable", async () => {
  const permission = deferred<MidiAccess>(), piano = new FakeInput("piano");
  piano.open.mockRejectedValueOnce(new Error("device busy"));
  restoreMidi = requestMidi(vi.fn(() => permission.promise));
  renderPractice(<App />); prepare("Rhythm practice"); openPiano(); click("Connect piano"); click("Done");
  openPracticeRoom(); click("Play"); click("Play C4"); advance(.5);
  await act(async () => { permission.resolve(new FakeAccess(piano)); await settle(); });
  expect(button("Pause")).toBeTruthy();
  expect(screen.queryByText(/practice paused/)).toBeNull();
  advance(.5); click("Play D4"); advance(1); click("Play E4"); advance(.5);
  expect(passes()).toHaveLength(1);
  expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it("keeps listening uninterrupted when the selected piano is unplugged", async () => {
  const piano = new FakeInput("piano"), access = await connectPiano(piano);
  openPracticeRoom(); click("Practice setup"); fireEvent.click(screen.getByRole("button", { name: /^Listen & explore/ })); click("Done");
  openPracticeRoom(); click("Play"); advance(.5);
  await act(async () => { access.unplug(piano); await settle(); });
  expect(button("Pause")).toBeTruthy();
  expect(screen.getByText("Piano not connected")).toBeTruthy();
  expect(screen.queryByText(/practice paused/)).toBeNull();
  advance(2); expect(passes()).toHaveLength(1); expect(passes()[0].mode).toBe("listen");
});

it("keeps saved songs, existing history and a dirty Studio draft intact through loss and reconnect", async () => {
  const piano = new FakeInput("piano"), access = await connectPiano(piano);
  openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(1); act(() => piano.emit(62)); advance(1); act(() => piano.emit(64)); advance(.5);
  const savedSongs = localStorage.getItem("piano-songs"), savedHistory = localStorage.getItem(HISTORY_KEY);
  expect(passes()).toHaveLength(1);
  openPracticeRoom(); click("Practice setup"); click("Prepare a song");
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
  click("Practice room"); openPracticeRoom(); openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(.5);
  await act(async () => { access.unplug(piano); await settle(); }); advance(5);
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  expect(button("Play")).toBeTruthy();
  expect(localStorage.getItem("piano-songs")).toBe(savedSongs);
  expect(localStorage.getItem(HISTORY_KEY)).toBe(savedHistory);
  openPracticeRoom(); click("Practice setup"); click("Prepare a song");
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  const closing = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(closing); expect(closing.defaultPrevented).toBe(true);
});

it.each(["Melody practice · wait for notes", "Rhythm practice", "Recital practice"])("preserves partial chord through reconnect in %s", async (mode) => {
  const chordSong: Song = { ...song, notes: [
    ...[60, 64, 67].map((pitch, i) => ({ id: `chord-${i}`, pitch, start: 0, duration: .5, velocity: .7, hand: "right" as const })),
    { id: "next", pitch: 62, start: 1, duration: .5, velocity: .7, hand: "right" },
  ] };
  localStorage.setItem("piano-songs", JSON.stringify([chordSong]));
  const piano = new FakeInput("piano"), access = await connectPiano(piano);
  openPracticeRoom(); click("Practice setup"); fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${mode}`) })); click("Done");
  openPracticeRoom(); click("Play"); act(() => piano.emit(60));
  await act(async () => { access.unplug(piano); await settle(); });
  advance(20); expect(position()).toBe(0); expect(passes()).toHaveLength(0);
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  act(() => { replacement.emit(64); replacement.emit(67); }); advance(.2);
  expect(position()).toBe(0); expect(button("Play")).toBeTruthy();
  openPracticeRoom(); click("Play"); act(() => { replacement.emit(64); replacement.emit(67); });
  advance(1); act(() => replacement.emit(62)); advance(.5);
  expect(passes()).toHaveLength(1);
  if (mode === "Rhythm practice" || mode === "Recital practice") expect(passes()[0].rhythm).toMatchObject({ onTime: 4, missed: 0, extra: 0 });
});

it("replacement of selected input object pauses before a delayed reopen and repeats safely", async () => {
  const piano = new FakeInput("piano"), access = await connectPiano(piano);
  openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(.5);
  const replacement = new FakeInput("piano"), opening = deferred<void>();
  replacement.open.mockImplementationOnce(async () => { await opening.promise; replacement.connection = "open"; replacement.changed(); });
  await act(async () => { access.add(replacement); await settle(); });
  expect(button("Play")).toBeTruthy(); expect(position()).toBeCloseTo(.5);
  await act(async () => { opening.resolve(); await settle(); });
  openPracticeRoom(); click("Play"); advance(.5); act(() => replacement.emit(62));
  await act(async () => { access.unplug(replacement); await settle(); });
  expect(position()).toBeCloseTo(1); expect(button("Play")).toBeTruthy();
  replacement.state = "connected";
  await act(async () => { access.add(replacement); await settle(); });
  openPracticeRoom(); click("Play"); advance(1); act(() => replacement.emit(64)); advance(.5);
  expect(passes()).toHaveLength(1); expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});

it("replug after explicit touch resume never starts another attempt or pauses it", async () => {
  const piano = new FakeInput("piano"), access = await connectPiano(piano);
  openPracticeRoom(); click("Play"); act(() => piano.emit(60)); advance(.5);
  await act(async () => { access.unplug(piano); await settle(); });
  openPracticeRoom(); click("Play"); advance(.5); click("Play D4");
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  expect(button("Pause")).toBeTruthy(); advance(1); click("Play E4"); advance(.5);
  expect(passes()).toHaveLength(1); expect(passes()[0].rhythm).toMatchObject({ onTime: 3, missed: 0, extra: 0 });
});
