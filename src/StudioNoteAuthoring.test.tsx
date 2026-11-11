// @vitest-environment jsdom
import { StrictMode, useLayoutEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, Song } from "./music";
import { StudioNoteAuthoring, type NoteAuthoringChange } from "./StudioNoteAuthoring";

const note = (id = "a", start = 0): Note => ({ id, pitch: 60, start, duration: 0.5, velocity: 0.6, hand: "right", finger: 2 });
const source = (notes = [note(), note("b", 1)]): Song => ({ id: "synthetic", title: "Synthetic study", tempo: 120, notes });
afterEach(cleanup);

function renderEditor(initial = source()) {
  const changed = vi.fn<(next: Song, change: NoteAuthoringChange) => void>();
  function Harness() {
    const [song, setSong] = useState(initial);
    return <StudioNoteAuthoring song={song} onChange={(next, change) => { changed(next, change); setSong(next); }} />;
  }
  render(<StrictMode><Harness /></StrictMode>);
  return changed;
}
const field = (name: string) => screen.getByRole("spinbutton", { name: new RegExp(`^${name}`) });
const change = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });

describe("Studio note authoring UI", () => {
  it("stages duration/start edits until Apply and keeps the selected note after chronological reorder", () => {
    const changed = renderEditor();
    change("Duration", "2.25"); change("Start", "3");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply note changes" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].notes[1]).toMatchObject({ id: "a", duration: 2.25, start: 3 });
    expect((field("Note number") as HTMLInputElement).value).toBe("2");
    expect((field("Duration") as HTMLInputElement).value).toBe("2.25");
  });

  it("rejects empty, out-of-range, and zero-duration fields without mutating the song", () => {
    const changed = renderEditor();
    change("Pitch", "");
    fireEvent.click(screen.getByRole("button", { name: "Apply note changes" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Pitch is required/);
    change("Pitch", "128");
    fireEvent.click(screen.getByRole("button", { name: "Apply note changes" }));
    expect(screen.getByRole("alert").textContent).toMatch(/0 to 127/);
    change("Pitch", "60"); change("Duration", "0");
    fireEvent.click(screen.getByRole("button", { name: "Apply note changes" }));
    expect(screen.getByRole("alert").textContent).toMatch(/greater than zero/);
    expect(changed).not.toHaveBeenCalled();
  });

  it("adds a note with chosen timing, hand and fingering, and allows canceling the new draft", () => {
    const changed = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    change("Pitch", "48");
    fireEvent.click(screen.getByRole("button", { name: "Cancel new note" }));
    expect(changed).not.toHaveBeenCalled();
    expect((field("Pitch") as HTMLInputElement).value).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    change("Pitch", "48"); change("Start", "0.25"); change("Duration", "0.75");
    fireEvent.change(screen.getByRole("combobox", { name: "Hand" }), { target: { value: "left" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].notes).toHaveLength(3);
    expect(changed.mock.calls[0][0].notes[1]).toMatchObject({ pitch: 48, start: 0.25, duration: 0.75, hand: "left", finger: 5 });
    expect((field("Note number") as HTMLInputElement).value).toBe("2");
  });

  it("requires explicit deletion confirmation and cancellation leaves the note unchanged", () => {
    const changed = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/Delete C4 at 0.000 seconds/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep note" }));
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep note" }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].notes).toEqual([note("b", 1)]);
    expect(changed.mock.calls[0][1]).toEqual({ action: "delete", noteId: "b" });
  });

  it("discards a pending confirmation when a newer song arrives, even with the same ID", () => {
    const changed = vi.fn();
    const view = render(<StudioNoteAuthoring song={source()} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    const oldConfirm = screen.getByRole("button", { name: "Delete this note" });
    view.rerender(<StudioNoteAuthoring song={source([note("a", 2)])} onChange={changed} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(oldConfirm);
    expect(changed).not.toHaveBeenCalled();
    expect((field("Start") as HTMLInputElement).value).toBe("2");
  });

  it("deletes the final note and offers a working first-note form", () => {
    const changed = renderEditor(source([note()]));
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this note" }));
    expect(changed.mock.calls[0][0].notes).toEqual([]);
    expect(screen.getByText(/No notes yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete note" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls[1][0].notes).toHaveLength(1);
  });

  it("navigates notes without changing them or allowing an invalid index", () => {
    const changed = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Next note" }));
    expect((field("Start") as HTMLInputElement).value).toBe("1");
    change("Note number", "9");
    expect((field("Note number") as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Previous note" }));
    expect((field("Start") as HTMLInputElement).value).toBe("0");
    expect(changed).not.toHaveBeenCalled();
  });

  it("blocks structural authoring for malformed MusicXML and explains the source error", () => {
    const changed = vi.fn();
    render(<StudioNoteAuthoring song={{ ...source(), scoreOrigin: "musicxml", scoreXml: "<score-partwise/>" }} onChange={changed} />);
    expect(screen.getByRole("alert").textContent).toContain("a score must have");
    expect((screen.getByRole("button", { name: "Apply written duration" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it("explains that legacy reference engraving will not change", () => {
    renderEditor({ ...source(), scoreXml: "<score-partwise/>" });
    expect(screen.getByText(/attached score is a reference only/)).toBeTruthy();
  });

  it("surfaces parent failures without a false success announcement", () => {
    render(<StudioNoteAuthoring song={source()} onChange={() => { throw Error("Could not apply this change."); }} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply note changes" }));
    expect(screen.getByRole("alert").textContent).toBe("Could not apply this change.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});


// The layout effect deterministically delivers input after the controls commit
// but before passive effects run. No sleeps or React scheduler mocks are needed.
it.each(["mount", "song replacement", "note selection"])("keeps immediate input after %s instead of overwriting it in a passive reset", scenario => {
  function Harness({ song, selectedNoteId, enter }: { song: Song; selectedNoteId?: string; enter: boolean }) {
    useLayoutEffect(() => {
      if (!enter) return;
      const input = field("Duration") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, [song, selectedNoteId, enter]);
    return <StudioNoteAuthoring song={song} selectedNoteId={selectedNoteId} onChange={changed} />;
  }
  const changed = vi.fn();
  const original = source();
  const replacement = { ...original, notes: [{ ...note(), duration: 1.25 }, note("b", 1)] };
  const view = render(<Harness song={original} selectedNoteId="a" enter={scenario === "mount"} />);
  if (scenario === "song replacement") view.rerender(<Harness song={replacement} selectedNoteId="a" enter />);
  if (scenario === "note selection") view.rerender(<Harness song={original} selectedNoteId="b" enter />);
  expect((field("Duration") as HTMLInputElement).value).toBe("3");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply note changes" }));
  expect(changed).toHaveBeenCalledTimes(1);
  const selectedId = scenario === "note selection" ? "b" : "a";
  expect(changed.mock.calls[0][0].notes.find((note: Note) => note.id === selectedId).duration).toBe(3);
  expect(changed.mock.calls[0][1]).toEqual({ action: "edit", noteId: selectedId });
  expect(original.notes[0].duration).toBe(.5);
});
