// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import type { Song } from "./music";
import { stubDialogs } from "./testDialog";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));

// The real App/session/audio adapter with synthetic RAF/oscillators. This tests
// onset wiring and authored percentages, not Android rendering or audio latency.
const song: Song = { id: "geometry-fixture", title: "Keyboard geometry", tempo: 60, notes: [
  ...[60, 61].map((pitch, index) => ({ id: `onset-${pitch}`, pitch, start: index * 1.25, duration: 1, velocity: .7, hand: "right" as const })),
  ...[46, 62, 85].map(pitch => ({ id: `edge-${pitch}`, pitch, start: 3, duration: 1, velocity: .7, hand: "right" as const })),
] };
const frequencies: number[] = [];
class SilentAudio extends EventTarget {
  state = "running"; currentTime = 0; destination = {};
  close() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  createOscillator() {
    const frequency = { value: 0 };
    return { frequency, connect() {}, disconnect() {}, start() { frequencies.push(frequency.value); }, stop() {}, onended: null };
  }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
let now = 0, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
function advance(steps: number) {
  act(() => { for (let i = 0; i < steps; i++) {
    now += 250;
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now));
  } });
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
function open() {
  const view = renderPractice(<App />); click("My library"); fireEvent.click(screen.getByRole("button", { name: /Keyboard geometry/ }));
  openPracticeRoom();
  return view;
}
function element(container: HTMLElement, selector: string) { return container.querySelector<HTMLElement>(selector)!; }
beforeEach(() => {
  stubDialogs(); localStorage.clear(); localStorage.setItem("piano-songs", JSON.stringify([song]));
  now = frameId = frequencies.length = 0; frames.clear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("AudioContext", SilentAudio);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });


import { fallingNoteGeometry, pianoKeyGeometry } from "./pianoGeometry";
it("independently covers every inclusive MIDI range without gaps, clipping or pitch loss", () => {
  const failures: string[] = [];
  for (let low = 0; low <= 127; low++) for (let high = low; high <= 127; high++) {
    const keys = pianoKeyGeometry(low, high);
    const white = keys.filter(key => !key.black);
    const eps = 1e-8;
    if (keys[0].pitch > low || keys.at(-1)!.pitch < high || keys[0].pitch < 0 || keys.at(-1)!.pitch > 127) failures.push(`bounds ${low}-${high}`);
    if (Math.abs(white[0].left) > eps || Math.abs(white.at(-1)!.left + white.at(-1)!.width - 100) > eps) failures.push(`surface ${low}-${high}`);
    white.forEach((key, index) => { if (index && Math.abs(white[index - 1].left + white[index - 1].width - key.left) > eps) failures.push(`gap ${low}-${high}`); });
    keys.forEach((key, index) => {
      if (![key.left, key.width].every(Number.isFinite) || key.width <= 0 || key.left < -eps || key.left + key.width > 100 + eps) failures.push(`clip ${low}-${high}:${key.pitch}`);
      if (key.pitch !== keys[0].pitch + index) failures.push(`pitch ${low}-${high}`);
      if (key.black && (Math.abs(key.left + key.width / 2 - keys[index + 1].left) > eps || keys[index - 1].black || keys[index + 1].black)) failures.push(`overlay ${low}-${high}`);
    });
  }
  expect(failures).toEqual([]);
});
it("rebuilds shared geometry safely across hand changes and the entire MIDI range", () => {
  const edgeSong: Song = { ...song, notes: [
    { id: "low", pitch: 0, start: 0, duration: 1, velocity: .7, hand: "left" },
    { id: "high", pitch: 127, start: 0, duration: 1, velocity: .7, hand: "right" },
    { id: "low-accidental", pitch: 1, start: 0, duration: 1, velocity: .7, hand: "left" },
    { id: "high-accidental", pitch: 126, start: 0, duration: 1, velocity: .7, hand: "right" },
  ] };
  localStorage.setItem("piano-songs", JSON.stringify([edgeSong]));
  const { container } = open();
  const verify = (count: number, first: string, last: string) => {
    const keys = [...container.querySelectorAll<HTMLElement>(".keyboard button")];
    expect(keys).toHaveLength(count); expect(keys[0].dataset.pitch).toBe(first); expect(keys.at(-1)!.dataset.pitch).toBe(last);
    for (const note of container.querySelectorAll<HTMLElement>(".fall-note")) {
      const key = element(container, `.keyboard [data-pitch="${note.dataset.pitch}"]`);
      expect(note.style.left).toBe(key.style.left); expect(note.style.width).toBe(key.style.width);
    }
    expect(keys[0].style.left).toBe("0%");
    expect(parseFloat(keys.at(-1)!.style.left) + parseFloat(keys.at(-1)!.style.width)).toBeCloseTo(100);
  };
  verify(128, "0", "127");
  openPracticeRoom(); click("Practice setup"); click("Left"); click("Done"); verify(84, "0", "83");
  openPracticeRoom(); click("Practice setup"); click("Right"); click("Done"); verify(80, "48", "127");
  openPracticeRoom(); click("Practice setup"); click("Both"); click("Done"); verify(128, "0", "127");
});
it.each([25, 75, 125])("passes the onset seam on the first audio frame at %i%% speed, including overshoot", speed => {
  const { container } = open(); openPracticeRoom(); click("Practice setup");
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: String(speed) } }); click("Done");
  openPracticeRoom(); click("Play");
  const frequency = 440 * 2 ** ((61 - 69) / 12);
  const steps = Math.ceil(1.25 / (.25 * speed / 100));
  advance(steps - 1);
  expect(frequencies).not.toContain(frequency);
  expect(parseFloat(element(container, '.fall-note[data-pitch="61"]').style.bottom)).toBeGreaterThan(0);
  advance(1);
  expect(frequencies).toContain(frequency);
  const current = Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value);
  const note = element(container, '.fall-note[data-pitch="61"]');
  expect(parseFloat(note.style.bottom)).toBeLessThanOrEqual(0);
  expect(parseFloat(note.style.bottom)).toBeCloseTo(fallingNoteGeometry({start: 1.25, duration: 1}, current).bottom);
});
