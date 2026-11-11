// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error Node crypto supplies the browser digest API in these DOM tests.
import { webcrypto } from "node:crypto";
import { App } from "./main";
import { exportMidi, parseMidi, type Song } from "./music";
import { SONGS_KEY } from "./songLibrary";

// Real MIDI parsing and library persistence, with a coarse/frozen wall clock.
// No browser file access, device input, or private music is exercised.
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
vi.mock("./DeferredStudioNoteAuthoring", () => ({ DeferredStudioNoteAuthoring: () => null }));

const song = (title: string, pitch = 60): Song => ({ id: title, title, tempo: 120, duration: 2,
  notes: [{ id: "n", start: 0, duration: 1, pitch, velocity: .7, hand: "left", finger: 5 }] });
const original: Song = { ...song("Existing project"), scoreXml: "<score-partwise/>",
  folderSource: { folderId: "original-folder", name: "original.piano.json", digest: "a".repeat(64) } };
function midiFile(title: string, pitch = 60) {
  const bytes = new Uint8Array(exportMidi(song(title, pitch)));
  return Object.assign(new File([bytes], title + ".mid"), { arrayBuffer: vi.fn(async () => bytes.buffer) });
}
function choose(container: HTMLElement, ...files: File[]) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
}
function saved(): Song[] { return JSON.parse(localStorage.getItem(SONGS_KEY) ?? "[]"); }
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  localStorage.setItem(SONGS_KEY, JSON.stringify([original]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("gives repeated MIDI parses distinct piece identities even within the same wall-clock tick", () => {
  const bytes = new Uint8Array(exportMidi(song("Synthetic MIDI")));
  const first = parseMidi(bytes.buffer), second = parseMidi(bytes.buffer);
  expect(second.id).not.toBe(first.id);
  expect({ ...second, id: first.id }).toEqual(first);
});

it("persists every file in a same-tick MIDI batch without conflicting or stopping early", async () => {
  const view = render(<App />);
  const files = [midiFile("First MIDI", 60), midiFile("Second MIDI", 64), midiFile("Third MIDI", 67)];
  choose(view.container, ...files);
  await waitFor(() => expect(saved()).toHaveLength(4));
  expect(saved().map(item => item.title)).toEqual(["Third MIDI", "Second MIDI", "First MIDI", original.title]);
  expect(new Set(saved().map(item => item.id)).size).toBe(4);
  expect(saved().at(-1)).toEqual(original);
  expect(saved().slice(0, 3).map(item => item.notes[0])).toEqual([67, 64, 60].map(pitch => expect.objectContaining({ pitch, hand: "left", start: 0, duration: 1 })));
  for (const file of files) expect(file.arrayBuffer).toHaveBeenCalledOnce();
  expect(screen.getByRole("heading", { name: "Third MIDI" })).toBeTruthy();
  expect(screen.queryByText(/Import is open but not saved|changed in another tab/)).toBeNull();
});

it("keeps explicit repeated imports as separate copies instead of silently deduplicating a clock collision", async () => {
  const view = render(<App />), file = midiFile("Repeated MIDI");
  choose(view.container, file);
  await waitFor(() => expect(saved()).toHaveLength(2));
  const first = saved()[0];
  choose(view.container, file);
  await waitFor(() => expect(saved()).toHaveLength(3));
  expect(saved()[0].id).not.toBe(first.id);
  expect(saved()[1]).toEqual(first);
  expect(saved()[2]).toEqual(original);
});

it("still ignores an interrupted MIDI read when a newer same-tick file has been imported", async () => {
  let finish!: (buffer: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>(resolve => { finish = resolve; });
  const older = midiFile("Interrupted MIDI"), newer = midiFile("Current MIDI", 72);
  older.arrayBuffer.mockReturnValue(pending);
  const view = render(<App />);
  choose(view.container, older);
  choose(view.container, newer);
  await screen.findByRole("heading", { name: "Current MIDI" });
  const before = localStorage.getItem(SONGS_KEY);
  await act(async () => finish(new Uint8Array(exportMidi(song("Interrupted MIDI"))).buffer));
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
  expect(saved().map(item => item.title)).toEqual(["Current MIDI", original.title]);
  expect(saved()[1]).toEqual(original);
  expect(screen.getByRole("heading", { name: "Current MIDI" })).toBeTruthy();
});

it("keeps folder content identities stable across refresh, preserving saved MIDI finger edits", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const file = midiFile("Folder MIDI");
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({
    kind: "directory", name: "Synthetic folder", queryPermission: async () => "granted",
    async *values() { yield { kind: "file", name: file.name, getFile: async () => file }; },
  }));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/Folder refresh: 1 imported/);
  expect(saved()[0].id).toMatch(/^folder-/);
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved to your library on this device.");
  const before = localStorage.getItem(SONGS_KEY), source = saved()[0].folderSource;
  expect(saved()[0].notes[0].finger).toBe(5);
  expect(source).toMatchObject({ name: file.name, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh / reconnect folder" }));
  await screen.findByText(/Folder refresh: 0 imported, 1 unchanged/);
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
  expect(saved()[1]).toEqual(original);
});
