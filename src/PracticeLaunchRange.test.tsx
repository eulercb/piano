// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeLaunch } from "./PracticeLaunch";
import type { Song } from "./music";
import type { PracticeRange } from "./practiceRange";
import type { PracticeHand } from "./session";

const song: Song = {
  id: "test-piece", title: "Test piece", tempo: 100, duration: 8,
  notes: [
    { id: "crossing", pitch: 48, hand: "left", start: 0, duration: 5, velocity: 0.7, finger: 4, sourceNoteIds: ["tie-start", "tie-end"] },
    { id: "included", pitch: 64, hand: "right", start: 1, duration: 1, velocity: 0.7, finger: 3 },
    { id: "endpoint", pitch: 50, hand: "left", start: 4, duration: 1, velocity: 0.7 },
  ],
};

function TestPlan({ piece = song, initialRange, initialHand = "both", onRange = vi.fn(), onStart = vi.fn(), externalReset = false }: {
  piece?: Song; initialRange?: PracticeRange; initialHand?: PracticeHand;
  onRange?: (next?: PracticeRange) => void; onStart?: () => void; externalReset?: boolean;
}) {
  const [range, setRange] = useState(initialRange);
  const [hand, setHand] = useState(initialHand);
  return <PracticeLaunch song={piece} dirty hand={hand} mode="melody" speed={50} countIn={false} muted={true}
    repeat={false} metronome={false} range={externalReset ? undefined : range}
    onRange={next => { setRange(next); onRange(next); }} onHand={setHand}
    onMode={vi.fn()} onSpeed={vi.fn()} onCountIn={vi.fn()} onMute={vi.fn()}
    onStart={onStart} onLibrary={vi.fn()} onPrepare={vi.fn()} />;
}
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));
const field = (side: "Start" | "End") => screen.getByRole<HTMLInputElement>("spinbutton", { name: `${side} (seconds)` });
const type = (side: "Start" | "End", value: string) => fireEvent.change(field(side), { target: { value } });

afterEach(cleanup);

describe("temporary passage controls", () => {
  it("defaults to the whole piece and commits the first-half preset without editing the song", () => {
    const onRange = vi.fn();
    const before = JSON.stringify(song);
    render(<TestPlan onRange={onRange} />);
    expect(button("Whole piece").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Whole piece · 3 notes for the selected hand")).toBeTruthy();
    click("First half");
    expect(onRange).toHaveBeenLastCalledWith({ start: 0, end: 4 });
    expect(button("First half").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("0–4 seconds · 2 notes for the selected hand")).toBeTruthy();
    expect(screen.getByText(/Practising your unsaved draft/)).toBeTruthy();
    click("Whole piece");
    expect(onRange).toHaveBeenLastCalledWith(undefined);
    expect(JSON.stringify(song)).toBe(before);
  });

  it("edits precise numeric boundaries and does not include crossing or end attacks", () => {
    const onRange = vi.fn();
    const onStart = vi.fn();
    render(<TestPlan onRange={onRange} onStart={onStart} initialHand="left" />);
    click("Custom time range");
    expect(onRange).not.toHaveBeenCalled();
    type("Start", "1");
    type("End", "4");
    expect(onRange).toHaveBeenLastCalledWith({ start: 1, end: 4 });
    expect(button(/Left hand No notes/).disabled).toBe(true);
    expect(button(/Left hand No notes/).getAttribute("aria-pressed")).toBe("true");
    expect(button("Start practice").disabled).toBe(true);
    expect(screen.getByText(/No notes for this hand in the range/)).toBeTruthy();
    click(/Right hand One part/);
    expect(screen.getByText("1–4 seconds · 1 note for the selected hand")).toBeTruthy();
    type("End", "4.0000000001");
    expect(onRange).toHaveBeenLastCalledWith({ start: 1, end: 4.0000000001 });
    expect(field("End").value).toBe("4.0000000001");
    expect(button(/Left hand One part/).disabled).toBe(false);
    click("Start practice");
    expect(onStart).toHaveBeenCalledOnce();
  });

  it.each([
    ["Start", "", /Enter both a start and an end/],
    ["Start", "-1", /within this piece/],
    ["Start", "4", /end must be after the start/],
    ["End", "9", /within this piece/],
    ["End", "0", /end must be after the start/],
  ] as const)("blocks Start and does not commit invalid %s value %j", (side, value, error) => {
    const onRange = vi.fn();
    const onStart = vi.fn();
    render(<TestPlan initialRange={{ start: 0, end: 4 }} onRange={onRange} onStart={onStart} />);
    click("Custom time range");
    type(side, value);
    expect(screen.getByRole("status").textContent).toMatch(error);
    expect(field(side).getAttribute("aria-invalid")).toBe("true");
    expect(field(side).getAttribute("aria-describedby")?.split(" ")).toContain(screen.getByRole("status").id);
    expect(button("Start practice").disabled).toBe(true);
    click("Start practice");
    expect(onStart).not.toHaveBeenCalled();
    expect(onRange).not.toHaveBeenCalled();
    type(side, side === "Start" ? "0" : "4");
    expect(field(side).hasAttribute("aria-invalid")).toBe(false);
    expect(button("Start practice").disabled).toBe(false);
  });

  it("offers another range when no note attacks start in the selected interval", () => {
    render(<TestPlan initialRange={{ start: 2, end: 4 }} />);
    expect(screen.getByText(/No notes start in this range/)).toBeTruthy();
    expect(button(/Both hands No notes/).disabled).toBe(true);
    expect(button("Start practice").disabled).toBe(true);
  });

  it("discards stale draft text when the selected song or committed range changes", () => {
    const { rerender } = render(<TestPlan initialRange={{ start: 0, end: 4 }} />);
    click("Custom time range");
    type("End", "");
    rerender(<TestPlan initialRange={{ start: 0, end: 4 }} externalReset />);
    expect(button("Whole piece").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("spinbutton")).toBeNull();

    click("Custom time range");
    type("Start", "");
    rerender(<TestPlan piece={{ ...song, title: "Edited piece" }} initialRange={{ start: 0, end: 4 }} externalReset />);
    expect(button("Whole piece").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(button("Start practice").disabled).toBe(false);
  });
});
