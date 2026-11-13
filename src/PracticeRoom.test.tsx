// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { demoSong, type Song } from "./music";
import { stubDialogs } from "./testDialog";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
// Score engraving is separately tested with its real adapter. Check its mounting
// and props here, not a fabricated rendered mobile result.
vi.mock("./Score", () => ({ Score: ({ compact, xml }: { compact?: boolean; xml?: string }) => <div role="region" aria-label="Reading score" data-compact={compact}>{xml ? "Attached score" : "Import MusicXML to read along."}</div> }));
const midi = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("./MidiConnection", async () => {
  const { useEffect } = await import("react");
  return { MidiConnection: () => {
    useEffect(() => { midi.mounts++; return () => { midi.unmounts++; }; }, []);
    return <button>Connect piano</button>;
  } };
});
let now = 0, frame = 0, oscillatorStarts = 0;
const callbacks = new Map<number, FrameRequestCallback>();
class SilentAudio extends EventTarget {
  state = "running";
  close() { return Promise.resolve(); }
  currentTime = 0; destination = {};
  resume() { return Promise.resolve(); }
  createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { oscillatorStarts++; }, stop() {}, onended: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
}
function advance(seconds: number) {
  act(() => { for (let i = 0; i < Math.round(seconds * 10); i++) {
    now += 100; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now));
  } });
}
function button(name: string) { return screen.getByRole("button", { name }); }
function setup() { const opener = button("Practice setup"); opener.focus(); fireEvent.click(opener); return screen.getByRole("dialog", { name: "Practice setup" }); }
function close() { fireEvent.click(button("Done")); }
function position() { return Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value); }
beforeEach(() => {
  stubDialogs(); localStorage.clear(); callbacks.clear(); now = frame = oscillatorStarts = midi.mounts = midi.unmounts = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++frame, callback); return frame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("AudioContext", SilentAudio);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("opens a focused room, with setup/score unmounted or hidden and only one persistent transport", () => {
  const { container } = renderPractice(<App />);
  expect(container.querySelector(".practice-shell")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("region", { name: "Reading score" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Count in 4 beats" })).toBeNull();
  expect(container.querySelector(".heading")).toBeNull();
  expect(container.querySelector("footer")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(1);
  expect(button("Restart")).toBeTruthy();
  expect(screen.getByText("Both hands · 50% · Listen")).toBeTruthy();
});

it("repeatedly opens setup, restores focus, cancels with Escape and retains chosen settings", () => {
  renderPractice(<App />);
  for (let attempt = 0; attempt < 3; attempt++) {
    const panel = setup();
    expect(panel.contains(document.activeElement)).toBe(true);
    if (!attempt) {
      fireEvent.click(button("Right"));
      fireEvent.click(screen.getByRole("button", { name: /^Melody practice · wait for notes/ }));
      fireEvent.click(button("75%"));
    }
    expect(within(panel).getByText(/suggestions, not detected or graded by MIDI/)).toBeTruthy();
    fireEvent(panel, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("Practice setup"));
    expect(screen.getByText("Right hand · 75% · Wait for notes")).toBeTruthy();
  }
});

it("pauses on panel entry and resumes from the same position without resetting the passage", () => {
  renderPractice(<App />); setup();
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); close();
  openPracticeRoom(); fireEvent.click(button("Play")); advance(1); const before = position();
  setup(); advance(2); expect(position()).toBe(before); close();
  expect(button("Play")).toBeTruthy();
  openPracticeRoom(); fireEvent.click(button("Play")); advance(1); expect(position()).toBeGreaterThan(before);
  fireEvent.click(button("Restart")); expect(position()).toBe(0);
});

it("keeps the MIDI component mounted across device dismissal and Library/Studio navigation", () => {
  renderPractice(<App />);
  const opener = button("Piano connection"); opener.focus(); fireEvent.click(opener);
  expect(button("Connect piano")).toBeTruthy(); close();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener); close();
  fireEvent.click(button("My library"));
  fireEvent.click(button("Prepare a song"));
  fireEvent.click(button("Practice room")); openPracticeRoom();
  expect(midi.mounts).toBe(1); expect(midi.unmounts).toBe(0);
});

it("replaces falling notes with a bounded score surface without duplicating transport", () => {
  const song: Song = { ...demoSong, id: "score-fixture", title: "Synthetic score", scoreXml: "<score-partwise/>" };
  localStorage.setItem("piano-songs", JSON.stringify([song]));
  const { container } = renderPractice(<App />);
  fireEvent.click(button("My library"));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic score/ }));
  openPracticeRoom(); fireEvent.click(button("Reading score"));
  expect(container.querySelector(".roll")).toBeNull();
  expect(screen.getByRole("region", { name: "Reading score" }).getAttribute("data-compact")).toBe("true");
  expect((button("Finger hints on falling notes") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(1);
  fireEvent.click(button("Falling notes"));
  expect(screen.queryByRole("region", { name: "Reading score" })).toBeNull();
  expect(container.querySelector(".roll")).toBeTruthy();
});

it("explains a missing score and returns to notes, while finger hints toggle without changing notes", () => {
  localStorage.setItem("piano-songs", JSON.stringify([{ ...demoSong, id: "finger-fixture", title: "Finger study", notes: demoSong.notes.map(note => ({ ...note, finger: 2 })) }]));
  const { container } = renderPractice(<App />);
  fireEvent.click(button("My library")); fireEvent.click(screen.getByRole("button", { name: /Finger study/ })); openPracticeRoom();
  const before = [...container.querySelectorAll(".fall-note")].map(note => note.textContent);
  expect(before.some(text => /^[1-5]$/.test(text ?? ""))).toBe(true);
  fireEvent.click(button("Finger hints on falling notes"));
  expect([...container.querySelectorAll(".fall-note")].some(note => /^[1-5]$/.test(note.textContent ?? ""))).toBe(false);
  fireEvent.click(button("Finger hints on falling notes"));
  expect([...container.querySelectorAll(".fall-note")].map(note => note.textContent)).toEqual(before);
  openPracticeRoom(); fireEvent.click(button("Reading score"));
  expect(screen.getByText(/No reading score attached/)).toBeTruthy();
  fireEvent.click(button("Falling notes"));
  expect(container.querySelectorAll(".fall-note")).toHaveLength(before.length);
});

it("preserves wait-for-note melody behavior in the focused route and ignores shortcuts in panels", () => {
  renderPractice(<App />); const panel = setup();
  fireEvent.keyDown(within(panel).getByRole("button", { name: "Right" }), { key: "a" });
  expect(oscillatorStarts).toBe(0);
  fireEvent.click(button("Right"));
  fireEvent.click(screen.getByRole("button", { name: /^Melody practice · wait for notes/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" })); close();
  openPracticeRoom(); fireEvent.click(button("Play")); advance(1); expect(position()).toBe(0);
  fireEvent.click(button("Play C♯4")); advance(.2); expect(position()).toBe(0);
  fireEvent.click(button("Play E4")); advance(.2); expect(position()).toBeGreaterThan(0);
  fireEvent.click(button("My library")); fireEvent.click(button("Practice room")); openPracticeRoom();
  expect(screen.getByText("Right hand · 50% · Wait for notes")).toBeTruthy();
});

it("keeps rhythm results on demand and restores the guide after closing them", () => {
  renderPractice(<App />); setup();
  fireEvent.click(screen.getByRole("button", { name: /^Rhythm practice/ })); close();
  expect(screen.queryByRole("region", { name: "Rhythm feedback" })).toBeNull();
  fireEvent.click(button("Results"));
  expect(screen.getByRole("region", { name: "Rhythm feedback" })).toBeTruthy(); close();
  expect(screen.queryByRole("dialog")).toBeNull(); expect(button("Play")).toBeTruthy();
});
