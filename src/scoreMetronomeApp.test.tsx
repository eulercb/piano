// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { parseMusicXml } from "./musicxml";
import { HISTORY_KEY } from "./practiceHistory";
import { stubDialogs } from "./testDialog";

// Real source parser, persisted-song normalization, App, transport and audio
// lifecycle; drawing, audio hardware and animation timestamps are simulated.
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
const title = "Synthetic changing-tempo study";
const xml = `<score-partwise><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><sound tempo="120"/><direction><offset>4</offset><sound tempo="60"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><staff>1</staff></note><backup><duration>16</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><staff>2</staff></note></measure></part></score-partwise>`;
const song = { ...parseMusicXml(xml).song, id: "source-tempo-study" };
class SyntheticAudio extends EventTarget {
  static instances: SyntheticAudio[] = [];
  state = "running"; currentTime = 0; destination = {};
  pitches: number[] = [];
  constructor() { super(); SyntheticAudio.instances.push(this); }
  resume = async () => {};
  close = async () => { this.state = "closed"; };
  change(state: string) { this.state = state; this.dispatchEvent(new Event("statechange")); }
  createOscillator() {
    const frequency = { value: 0 };
    return { frequency, connect() {}, disconnect() {}, onended: null, start: () => { this.pitches.push(frequency.value); }, stop() {} };
  }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
let now = 0, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const context = () => SyntheticAudio.instances.at(-1)!;
const clicks = () => SyntheticAudio.instances.flatMap(audio => audio.pitches).filter(f => Math.abs(f - 440 * 2 ** (15 / 12)) < .001).length;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const position = () => Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value);
function advance(seconds: number) {
  act(() => {
    for (let i = 0; i < Math.round(seconds * 10); i++) {
      now += 100;
      for (const audio of SyntheticAudio.instances) if (audio.state === "running") audio.currentTime += .1;
      const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(now));
    }
  });
}
function prepare(options: { reference?: boolean; melody?: boolean; countIn?: boolean; speed?: number; enabled?: boolean } = {}) {
  const saved = options.reference ? { ...song, scoreOrigin: undefined } : song;
  localStorage.setItem("piano-songs", JSON.stringify([saved]));
  const before = localStorage.getItem("piano-songs");
  render(<App />); click("My library"); fireEvent.click(screen.getByRole("button", { name: new RegExp(title) }));
  click("Practice setup"); click("Both");
  fireEvent.click(screen.getByRole("button", { name: options.melody ? /^Melody practice/ : /^Listen/ }));
  if (!options.countIn) fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: String(options.speed ?? 100) } });
  const toggle = screen.getByRole("checkbox", { name: "Metronome" }) as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  if (options.enabled !== false) fireEvent.click(toggle);
  expect(screen.getByText(options.reference ? /no verified source tempo map/ : /follow numeric tempo changes/)).toBeTruthy();
  click("Done");
  return before;
}
beforeEach(() => {
  stubDialogs(); localStorage.clear(); frames.clear(); now = frameId = 0; SyntheticAudio.instances = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("AudioContext", SyntheticAudio);
});
afterEach(() => { cleanup(); vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it.each([100, 50])("follows persisted source tempos at %s%% speed without changing songs, hands or history", speed => {
  const before = prepare({ speed }); click("Play"); expect(clicks()).toBe(1);
  const notes = context().pitches.filter(f => f < 1000);
  expect(notes).toHaveLength(2);
  advance(.5 * 100 / speed); expect(clicks()).toBe(2);
  advance(.5 * 100 / speed); expect(clicks()).toBe(2);
  advance(.5 * 100 / speed); expect(clicks()).toBe(3);
  expect(position()).toBeCloseTo(1.5);
  expect(localStorage.getItem("piano-songs")).toBe(before);
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});

it("keeps reference-only XML inert and the default-off choice silent", () => {
  const before = prepare({ reference: true, enabled: false });
  click("Play"); advance(1); expect(clicks()).toBe(0);
  click("Practice setup"); fireEvent.click(screen.getByRole("checkbox", { name: "Metronome" })); click("Done");
  click("Play"); expect(clicks()).toBe(1);
  advance(.5); expect(clicks()).toBe(2);
  advance(.5); expect(clicks()).toBe(3); // Still 120 BPM, unlike source-linked playback.
  expect(localStorage.getItem("piano-songs")).toBe(before);
});

it("continues at the stopped source tempo while Melody waits for both written hands", () => {
  prepare({ melody: true }); click("Play"); advance(1); expect(clicks()).toBe(3); expect(position()).toBe(0);
  click("Play C4"); advance(.5); expect(clicks()).toBe(4); expect(position()).toBe(0);
  click("Play C3"); advance(.5); expect(clicks()).toBe(5); expect(position()).toBeCloseTo(.5);
  advance(.5); expect(clicks()).toBe(5); advance(.5); expect(clicks()).toBe(6);
});

it("retains source-tempo phase across mute and audio interruption without backlog", () => {
  const before = prepare(); click("Play"); advance(.7); expect(clicks()).toBe(2);
  click("Mute"); advance(1); expect(clicks()).toBe(2);
  click("Unmute"); advance(.2); expect(clicks()).toBe(2);
  act(() => context().change("interrupted")); advance(10);
  expect(position()).toBeCloseTo(1.9); expect(clicks()).toBe(2);
  act(() => context().change("running")); click("Play"); expect(clicks()).toBe(2);
  advance(.5); expect(clicks()).toBe(2); advance(.1); expect(clicks()).toBe(3);
  expect(localStorage.getItem("piano-songs")).toBe(before);
});

it("hands off starting-tempo count-in to source-tempo clicks once", () => {
  prepare({ countIn: true }); click("Play"); advance(1.9); expect(clicks()).toBe(4);
  advance(.1); expect(clicks()).toBe(5); expect(position()).toBeCloseTo(0);
  advance(.5); expect(clicks()).toBe(6); advance(.5); expect(clicks()).toBe(6);
  advance(.5); expect(clicks()).toBe(7);
});
