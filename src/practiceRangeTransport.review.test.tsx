// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import type { Song } from "./music";
import { SONGS_KEY } from "./songLibrary";
import { stubDialogs } from "./testDialog";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));

const song: Song = { id: "range-transport", title: "Range transport exercise", tempo: 90, notes: [
  { id: "left-held", start: 0, duration: 2, pitch: 48, velocity: .5, hand: "left" },
  { id: "right-attack", start: 1, duration: .5, pitch: 64, velocity: .5, hand: "right" },
  { id: "left-at-end", start: 1.005, duration: .5, pitch: 50, velocity: .5, hand: "left" },
] };
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));
const position = () => screen.getByRole<HTMLInputElement>("slider", { name: "Playback position" });

function openShortRange() {
  render(<App />);
  click("Choose another piece");
  click(/YOUR COLLECTION Range transport exercise/);
  click("Custom time range");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Start (seconds)" }), { target: { value: "1" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "End (seconds)" }), { target: { value: "1.005" } });
  click("Mute");
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  click("Start practice");
}

beforeEach(() => {
  stubDialogs();
  localStorage.setItem(SONGS_KEY, JSON.stringify([song]));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(SONGS_KEY);
  vi.unstubAllGlobals();
});

it("seeks to the exact endpoint of a sub-centisecond range and restarts at its start", () => {
  openShortRange();
  expect(position().step).toBe("any");
  expect(position().min).toBe("1");
  expect(position().max).toBe("1.005");
  fireEvent.change(position(), { target: { value: "1.005" } });
  expect(position().value).toBe("1.005");
  expect(position().getAttribute("aria-valuetext")).toMatch(/^1\.005 seconds/);
  click("Restart");
  expect(position().value).toBe("1");
});

it("disables the Setup hand with a held note at the start and an excluded attack at the end", () => {
  openShortRange();
  click("Practice setup");
  const setup = within(screen.getByRole("dialog", { name: "Practice setup" }));
  expect(setup.getByRole<HTMLButtonElement>("button", { name: "Left" }).disabled).toBe(true);
  expect(setup.getByRole<HTMLButtonElement>("button", { name: "Right" }).disabled).toBe(false);
  expect(setup.getByRole<HTMLButtonElement>("button", { name: "Both" }).disabled).toBe(false);
  expect(localStorage.getItem(SONGS_KEY)).toBe(JSON.stringify([song]));
});
