// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Song } from "./music";
import { PracticeHistory } from "./PracticeHistory";
import { PracticeNextSteps } from "./PracticeNextSteps";
import { exportPracticeHistory, PracticeHistoryStore, type PracticePass } from "./practiceHistory";
import { practiceNextSteps } from "./practiceNextSteps";

const song: Song = { id: "exercise", title: "Original exercise", tempo: 120, notes: [
  { id: "left-crossing", pitch: 48, hand: "left", start: 1, duration: 2, velocity: .5 },
  { id: "right-start", pitch: 60, hand: "right", start: 2, duration: 1, velocity: .5, finger: 3 },
  { id: "left-end", pitch: 50, hand: "left", start: 4, duration: 1, velocity: .5 },
] };
const pass: PracticePass = { id: "pass", pieceId: song.id, pieceTitle: song.title, pieceRevision: "v1-original",
  startedAt: "2026-11-13T23:00:00.000Z", completedAt: "2026-11-13T23:01:00.000Z",
  mode: "melody", hand: "right", tempo: 120, speedMin: 50, speedMax: 50,
  startSeconds: 2, endSeconds: 4, noteCount: 1 };
const range = { start: 2, end: 4 };

afterEach(cleanup);

it("offers only hands with attacks in the selected range, including the start but not the end", () => {
  const before = JSON.stringify({ song, pass, range });
  const steps = practiceNextSteps(pass, song, 50, range);
  expect(steps.find(s => s.id === "repeat")).toMatchObject({ title: "Repeat selected passage", hand: "right" });
  expect(steps.every(s => s.hand === "right")).toBe(true);
  expect(practiceNextSteps({ ...pass, hand: "both", mode: "listen" }, song, 50, range)
    .find(s => s.id === "melody")).toMatchObject({ hand: "right" });
  expect(practiceNextSteps(pass, song, 50, { start: 3, end: 4 })).toEqual([]);
  expect(JSON.stringify({ song, pass, range })).toBe(before);
});

it("labels temporary-range repetition explicitly and leaves the selected step to the caller", () => {
  const choose = vi.fn();
  render(<PracticeNextSteps pass={pass} song={song} speed={50} range={range} onChoose={choose} onPrepare={() => {}} />);
  expect(screen.getByText(/restart the selected passage from its start/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Explore the other hand|Bring both hands together/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Repeat selected passage/ }));
  expect(choose).toHaveBeenCalledWith({ id: "repeat", title: "Repeat selected passage", hand: "right", mode: "melody", speed: 50 });
});

it("does not treat an ordinary seek recorded in a pass as a temporary selected range", () => {
  const steps = practiceNextSteps(pass, song, 50);
  expect(steps.find(s => s.id === "repeat")?.title).toBe("Repeat from beginning");
  expect(steps.find(s => s.id === "other")?.hand).toBe("left");
});

it("shows a recorded interval even when the pass starts at zero, without rewriting the backup", () => {
  const partial = { ...pass, startSeconds: 0, endSeconds: 2 };
  const original = exportPracticeHistory([partial]);
  const storage = { getItem: vi.fn(() => original), setItem: vi.fn(), removeItem: vi.fn() };
  const store = new PracticeHistoryStore(() => storage);
  render(<PracticeHistory store={store} />);
  expect(screen.getByText("Recorded interval · 0:00–0:02 at original speed")).toBeTruthy();
  expect(screen.queryByText(/Selected piece \/ prepared passage/)).toBeNull();
  expect(store.getSnapshot().passes).toEqual([partial]);
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("distinguishes short source-time endpoints in both Results and History", () => {
  const brief = { ...pass, startSeconds: .25, endSeconds: .75 };
  const storage = { getItem: vi.fn(() => exportPracticeHistory([brief])), setItem: vi.fn(), removeItem: vi.fn() };
  render(<><PracticeNextSteps pass={brief} song={song} speed={50} onChoose={() => {}} onPrepare={() => {}} />
    <PracticeHistory store={new PracticeHistoryStore(() => storage)} /></>);
  expect(screen.getByText(/Last completed pass:.*0:00\.250–0:00\.750/)).toBeTruthy();
  expect(screen.getByText(/Recorded interval · 0:00\.250–0:00\.750 at original speed/)).toBeTruthy();
});
