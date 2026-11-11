// @vitest-environment jsdom
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
  const view = render(<App />); click("My library"); fireEvent.click(screen.getByRole("button", { name: /Keyboard geometry/ }));
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

it("shares keyboard, lane and note bounds, including accidental extremes, across Practice and Studio", () => {
  const { container } = open();
  const check = () => {
    const keys = [...container.querySelectorAll<HTMLElement>(".keyboard button")];
    expect(keys[0].dataset.pitch).toBe("45");
    expect(keys.at(-1)!.dataset.pitch).toBe("86");
    for (const key of keys) {
      const lane = element(container, `.lane[data-pitch="${key.dataset.pitch}"]`);
      expect(lane.style.left).toBe(key.style.left);
      expect(lane.style.width).toBe(key.style.width);
    }
    for (const note of container.querySelectorAll<HTMLElement>(".fall-note")) {
      const key = element(container, `.keyboard [data-pitch="${note.dataset.pitch}"]`);
      expect(note.style.left).toBe(key.style.left);
      expect(note.style.width).toBe(key.style.width);
      expect(note.classList.contains("accidental")).toBe(key.classList.contains("black"));
    }
    return keys.map(key => [key.dataset.pitch, key.style.left, key.style.width]);
  };
  const practice = check();
  click("Practice setup"); click("Prepare a song");
  expect(container.querySelector(".practice-shell")).toBeNull();
  expect(check()).toEqual(practice);
  click("Practice room");
  expect(check()).toEqual(practice);
  click("Reading score");
  expect(container.querySelector(".roll")).toBeNull();
  expect(container.querySelectorAll(".keyboard button")).toHaveLength(practice.length);
  click("Falling notes"); expect(check()).toEqual(practice);
});

it.each([50, 100])("hits the keyboard boundary on the same frame that audio starts at %i%% speed", speed => {
  const { container } = open();
  click("Practice setup"); fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: String(speed) } }); click("Done");
  click("Play");
  const note = () => element(container, '.fall-note[data-pitch="61"]');
  const frequency = 440 * 2 ** ((61 - 69) / 12);
  const steps = speed === 100 ? 5 : 10;
  advance(steps - 1);
  expect(parseFloat(note().style.bottom)).toBeGreaterThan(0);
  expect(frequencies).not.toContain(frequency);
  advance(1);
  expect(frequencies).toContain(frequency);
  expect(note().style.bottom).toBe("0%");
  expect(note().style.height.endsWith("%")).toBe(true);
  expect((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value).toBe("1.25");
  click("Pause"); advance(2); expect(note().style.bottom).toBe("0%");
  click("Play"); advance(1); expect(parseFloat(note().style.bottom)).toBeLessThan(0);
  click("Restart"); expect(parseFloat(note().style.bottom)).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: "1.25" } });
  expect(note().style.bottom).toBe("0%");
});

it("keeps the waiting note at the same seam until the correct melody key", () => {
  const { container } = open();
  click("Practice setup"); fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.click(screen.getByRole("button", { name: /^Melody practice/ })); click("Done");
  click("Play"); advance(4);
  expect(element(container, '.fall-note[data-pitch="60"]').style.bottom).toBe("0%");
  click("Play D4"); advance(2);
  expect(element(container, '.fall-note[data-pitch="60"]').style.bottom).toBe("0%");
  click("Play C4"); advance(1);
  expect(parseFloat(element(container, '.fall-note[data-pitch="60"]').style.bottom)).toBeLessThan(0);
});
