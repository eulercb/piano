// @vitest-environment jsdom
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
class SilentAudio {
  currentTime = 0; destination = {};
  resume() { return Promise.resolve(); }
  createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
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
const passes = () => parsePracticeHistory(localStorage.getItem(HISTORY_KEY) ?? "[]");
function openPiano() { click("Piano connection"); return screen.getByRole("dialog", { name: "Piano connection" }); }
function prepare(mode = "Melody practice · wait for notes") {
  click("My library"); fireEvent.click(screen.getByRole("button", { name: new RegExp(song.title) }));
  click("Practice setup"); click("Right");
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
  now = frameId = 0; frames.clear();
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
  render(<App />);
  expect(request).not.toHaveBeenCalled();
  openPiano(); click("Connect piano");
  expect((button("Connecting…") as HTMLButtonElement).disabled).toBe(true);
  click("Done"); prepare();
  await act(async () => { permission.resolve(new FakeAccess(piano)); await settle(); });
  expect(request).toHaveBeenCalledExactlyOnceWith({ sysex: false });
  expect(piano.open).toHaveBeenCalledTimes(1);
  click("Play"); advance(.5);
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
  render(<App />); prepare(); openPiano(); click("Connect piano"); click("Cancel connection"); click("Done");
  openPiano(); click("Connect piano"); click("Done");
  const staleAccess = new FakeAccess(old);
  await act(async () => { currentPermission.resolve(new FakeAccess(piano)); await settle(); oldPermission.resolve(staleAccess); await settle(); });
  expect(staleAccess.onstatechange).toBeNull(); expect(old.open).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(2);
  click("Play"); act(() => old.emit(60)); advance(.5); expect(position()).toBe(0);
  act(() => piano.emit(60)); advance(.5); expect(position()).toBeCloseTo(.5);
  expect(within(openPiano()).getByText("Last note: C4 · 1 note received")).toBeTruthy();
});

it("recovers only the selected input after unplugging and ignores stale or unselected messages", async () => {
  const piano = new FakeInput("piano"), other = new FakeInput("other", "Other");
  const access = new FakeAccess(piano, other), request = vi.fn(async () => access);
  restoreMidi = requestMidi(request);
  render(<App />); prepare(); openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "Piano input" }), { target: { value: "piano" } }); await settle(); });
  const staleMessage = piano.onmidimessage;
  click("Done"); click("Play");
  act(() => { other.emit(60); piano.emit(60, 0); }); advance(.5); expect(position()).toBe(0);
  act(() => piano.emit(60)); advance(1); expect(position()).toBeCloseTo(1);
  await act(async () => { access.unplug(piano); await settle(); });
  act(() => { message(staleMessage, piano, [0x90, 62, 90]); other.emit(62); });
  advance(.5); expect(position()).toBeCloseTo(1);
  let panel = openPiano();
  expect(within(panel).getByRole("status").textContent).toContain("disconnected");
  expect((within(panel).getByRole("combobox", { name: "Piano input" }) as HTMLSelectElement).value).toBe("piano");
  expect(other.open).not.toHaveBeenCalled(); click("Done");
  const replacement = new FakeInput("piano");
  await act(async () => { access.add(replacement); await settle(); });
  click("Play");
  act(() => { message(staleMessage, piano, [0x90, 62, 90]); replacement.emit(62, 0); });
  advance(.5); expect(position()).toBeCloseTo(1);
  act(() => replacement.emit(62)); advance(1); expect(position()).toBeCloseTo(2);
  panel = openPiano();
  expect(within(panel).getByText("Last note: D4 · 1 note received")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it("pauses rhythm for panel reopen and reconnect, then delivers each new press only once", async () => {
  const piano = new FakeInput("piano"), access = new FakeAccess(piano), request = vi.fn(async () => access);
  restoreMidi = requestMidi(request);
  render(<App />); prepare("Rhythm practice"); openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  click("Done"); click("Play"); act(() => piano.emit(60)); advance(1); act(() => piano.emit(62));
  const saved = position();
  for (let i = 0; i < 3; i++) {
    openPiano(); act(() => piano.emit(64)); advance(1); expect(position()).toBe(saved); click("Done");
    expect(button("Play")).toBeTruthy();
  }
  expect(request).toHaveBeenCalledTimes(1); expect(piano.open).toHaveBeenCalledTimes(1);
  openPiano(); const staleMessage = piano.onmidimessage;
  await act(async () => { click("Reconnect piano"); await settle(); });
  expect(piano.open).toHaveBeenCalledTimes(2); expect(piano.close).toHaveBeenCalledTimes(1);
  click("Done"); click("Play"); advance(1);
  act(() => { message(staleMessage, piano, [0x90, 64, 90]); piano.emit(64); }); advance(1);
  expect(passes()).toHaveLength(1);
  expect(passes()[0]).toMatchObject({ mode: "rhythm", hand: "right", rhythm: { total: 3, onTime: 3, missed: 0, extra: 0 } });
  expect(within(openPiano()).getByText("Last note: E4 · 1 note received")).toBeTruthy();
});


it("keeps touch practice usable after denial and recovers from an empty list and an input-open failure", async () => {
  const access = new FakeAccess(), piano = new FakeInput("piano");
  const request = vi.fn<RequestMidiAccess>().mockRejectedValueOnce({ name: "NotAllowedError" }).mockResolvedValue(access);
  restoreMidi = requestMidi(request);
  render(<App />); prepare(); let panel = openPiano();
  await act(async () => { click("Connect piano"); await settle(); });
  expect(within(panel).getByRole("status").textContent).toContain("MIDI access was denied");
  click("Done"); click("Play"); click("Play C4"); advance(.5); expect(position()).toBeCloseTo(.5);
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
  click("Done"); click("Play"); advance(.5); act(() => piano.emit(62)); advance(.5);
  expect(position()).toBeCloseTo(1.5);
  expect(request).toHaveBeenCalledTimes(3);
});
