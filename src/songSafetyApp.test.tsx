// @vitest-environment jsdom
import { clickDownload } from "./testDownload";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { importScoreFile } from "./scoreImport";
import { SONGS_KEY } from "./songLibrary";
import { HISTORY_KEY } from "./practiceHistory";
import { stubDialogs } from "./testDialog";
import { demoSong, type Song } from "./music";

// Synthetic app regressions. No browser upload, device MIDI or private music.
const update = vi.hoisted(() => vi.fn());
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [true], updateServiceWorker: update }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
vi.mock("./scoreImport", () => ({ importScoreFile: vi.fn() }));
const song = (id: string): Song => ({ id, title: id, tempo: 120,
  notes: [{ id: "note", start: 0, duration: 1, pitch: 60, hand: "right", velocity: .7, finger: 2 }] });
function imported(title: string) { return { song: song(title), warnings: [], format: "mxl", scoreTimeline: { entries: [], measures: [], duration: 1 }, measureStartTempos: [120] } as Awaited<ReturnType<typeof importScoreFile>>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function chooseFiles(container: HTMLElement, ...names: string[]) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: names.map(name => new File(["synthetic"], name)) } });
}
function prepare() {
  fireEvent.click(screen.getByRole("button", { name: "Practice setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
}
async function importOne(container: HTMLElement, name = "first") {
  vi.mocked(importScoreFile).mockResolvedValue(imported(name)); chooseFiles(container, name + ".mxl");
  await screen.findByRole("heading", { name });
}
function finger(value: string) { fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value } }); }
function beforeUnload() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
function saved(): Song[] { return JSON.parse(localStorage.getItem(SONGS_KEY) ?? "[]"); }
function playbackClock() {
  const frames = new Map<number, FrameRequestCallback>(); let frame = 0, now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("AudioContext", class extends EventTarget {
    state = "running";
    close() { return Promise.resolve(); }
    currentTime = 0; destination = {}; resume() { return Promise.resolve(); }
    createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
    createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
  });
  return (ticks: number) => act(() => { for (let index = 0; index < ticks; index++) {
    now += 100; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now));
  } });
}
beforeEach(() => {
  stubDialogs(); localStorage.clear(); update.mockReset(); vi.mocked(importScoreFile).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:export"; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("preserves unreadable saved bytes and keeps a failed import open for export", async () => {
  const source = JSON.stringify([song("valid"), { id: "corrupt" }]); localStorage.setItem(SONGS_KEY, source);
  const view = render(<App />); await importOne(view.container);
  expect(localStorage.getItem(SONGS_KEY)).toBe(source);
  expect(screen.getByText(/Import is open but not saved/)).toBeTruthy();
  await waitFor(() => expect(beforeUnload()).toBe(true));
  clickDownload(screen.getByRole("button", { name: "Export project + fingers" }));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
});
it("stops a multiple-file import on failed persistence instead of replacing the exportable copy", async () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === SONGS_KEY) throw new DOMException("Full", "QuotaExceededError");
    return setItem.call(this, key, value);
  });
  vi.mocked(importScoreFile).mockResolvedValue(imported("First unsaved import"));
  const view = render(<App />); chooseFiles(view.container, "first.mxl", "second.mxl");
  await screen.findByRole("heading", { name: "First unsaved import" });
  expect(importScoreFile).toHaveBeenCalledTimes(1); expect(localStorage.getItem(SONGS_KEY)).toBeNull();
  expect(screen.getByText(/Remaining files were not imported/)).toBeTruthy();
});
it("stops a folder import on failed persistence without claiming success", async () => {
  localStorage.setItem(SONGS_KEY, "unreadable");
  vi.mocked(importScoreFile).mockResolvedValue(imported("Unsaved folder import"));
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({ async *values() {
    for (const name of ["first.mxl", "second.mxl"]) yield { kind: "file", name, getFile: async () => new File(["synthetic"], name) };
  } }));
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByRole("heading", { name: "Unsaved folder import" });
  expect(importScoreFile).toHaveBeenCalledTimes(1); expect(localStorage.getItem(SONGS_KEY)).toBe("unreadable");
  expect(screen.queryByText(/Imported 1 of/)).toBeNull();
});
it("merges another tab's new piece and rejects its conflicting edit while preserving this draft", async () => {
  const view = render(<App />); await importOne(view.container);
  const original = saved()[0]; finger("5");
  localStorage.setItem(SONGS_KEY, JSON.stringify([song("other-tab"), original]));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved to your library on this device.");
  expect(saved().map(s => s.title)).toEqual(["first", "other-tab"]);
  finger("4");
  const newer = { ...saved()[0], notes: [{ ...saved()[0].notes[0], finger: 3 }] };
  localStorage.setItem(SONGS_KEY, JSON.stringify([newer, song("other-tab")]));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/This piece changed in another tab/);
  expect(saved()[0].notes[0].finger).toBe(3);
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("4");
  await waitFor(() => expect(beforeUnload()).toBe(true));
});
it("keeps unsaved edits across navigation and lets the user cancel switching pieces or importing", async () => {
  const view = render(<App />); await importOne(view.container); finger("5");
  expect(beforeUnload()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: /Morning Light/ }));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  chooseFiles(view.container, "replacement.mxl");
  expect(importScoreFile).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reload update" }));
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved to your library on this device.");
  // The notice can render before the passive effect removes the close guard.
  // Wait for the guard itself, not an unrelated DOM mutation or a fixed delay.
  await waitFor(() => expect(beforeUnload()).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Reload update" }));
  expect(update).toHaveBeenCalledTimes(1);
});
it("allows an explicitly confirmed piece change and clears the old unsaved warning", async () => {
  const view = render(<App />); await importOne(view.container); finger("5");
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: /Morning Light/ }));
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
  expect(saved()[0].notes[0].finger).toBe(2); expect(beforeUnload()).toBe(false);
});
it("does not let an older import replace a newer one", async () => {
  const slow = deferred<Awaited<ReturnType<typeof importScoreFile>>>();
  vi.mocked(importScoreFile).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(imported("New choice"));
  const view = render(<App />); chooseFiles(view.container, "old.mxl");
  await waitFor(() => expect(importScoreFile).toHaveBeenCalledTimes(1));
  chooseFiles(view.container, "new.mxl");
  await screen.findByRole("heading", { name: "New choice" });
  await act(async () => slow.resolve(imported("Old choice")));
  expect(screen.getByRole("heading", { name: "New choice" })).toBeTruthy();
  expect(saved().map(s => s.title)).toEqual(["New choice"]);
});
it("cancels pending batch imports when a newer navigation occurs", async () => {
  const slow = deferred<Awaited<ReturnType<typeof importScoreFile>>>();
  vi.mocked(importScoreFile).mockReturnValue(slow.promise);
  const view = render(<App />); chooseFiles(view.container, "pending.mxl", "later.mxl");
  await waitFor(() => expect(importScoreFile).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  await act(async () => slow.resolve(imported("Late import")));
  expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
  expect(importScoreFile).toHaveBeenCalledTimes(1); expect(saved()).toEqual([]);
});
it("does not let a pending import overwrite a newer Studio edit", async () => {
  const slow = deferred<Awaited<ReturnType<typeof importScoreFile>>>();
  vi.mocked(importScoreFile).mockReturnValue(slow.promise);
  const view = render(<App />); prepare(); chooseFiles(view.container, "pending.mxl");
  await waitFor(() => expect(importScoreFile).toHaveBeenCalledTimes(1));
  finger("5");
  await act(async () => slow.resolve(imported("Late import")));
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  expect(saved()).toEqual([]);
});
it("ignores a folder picker that finishes after the user has navigated away", async () => {
  const slow = deferred<unknown>();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockReturnValue(slow.promise));
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
  await act(async () => slow.resolve({ async *values() { yield { kind: "file", name: "pending.mxl", getFile: async () => new File(["synthetic"], "pending.mxl") }; } }));
  expect(importScoreFile).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
});
it("keeps edits made during a pending save dirty and lets them save against that completed revision", async () => {
  const view = render(<App />); await importOne(view.container); finger("4");
  let complete!: () => void;
  const request = vi.fn((_name, action) => new Promise(resolve => { complete = () => resolve(action()); }));
  vi.stubGlobal("navigator", { locks: { request } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(beforeUnload()).toBe(true);
  finger("5"); await act(async () => complete());
  expect(saved()[0].notes[0].finger).toBe(4); expect(beforeUnload()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save" })); await act(async () => complete());
  await waitFor(() => {
    expect(saved()[0].notes[0].finger).toBe(5);
    expect(beforeUnload()).toBe(false);
  });
});
it("does not rebase a reopened old draft when an earlier pending save completes", async () => {
  const view = render(<App />); await importOne(view.container); finger("4");
  let complete!: () => void;
  vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, action) => new Promise(resolve => { complete = () => resolve(action()); })) } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: /YOUR COLLECTION first/ })); prepare();
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("2");
  await act(async () => complete()); expect(saved()[0].notes[0].finger).toBe(4);
  finger("5"); fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await act(async () => complete()); await screen.findByText(/This piece changed in another tab/);
  expect(saved()[0].notes[0].finger).toBe(4);
});
it("asks before replacing an unsaved full-piece draft with a trimmed passage", async () => {
  render(<App />); prepare(); finger("5");
  fireEvent.click(screen.getByRole("button", { name: "Select the beginning half" }));
  fireEvent.click(screen.getByRole("button", { name: "Trim passage" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("full-piece draft"));
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Note" }) as HTMLSelectElement).options.length).toBe(demoSong.notes.length);
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Trim passage" }));
  expect(screen.getByRole("heading", { name: "Morning Light · passage" })).toBeTruthy(); expect(beforeUnload()).toBe(true);
});
it("saves built-in demo edits as a new copy and never overwrites an older saved demo", async () => {
  const legacy = { ...demoSong, notes: demoSong.notes.map(n => ({ ...n, finger: 3 })) };
  localStorage.setItem(SONGS_KEY, JSON.stringify([legacy]));
  render(<App />); prepare(); finger("5");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved to your library on this device.");
  expect(saved()).toHaveLength(2); expect(saved()[0].id).not.toBe(demoSong.id);
  expect(saved()[0].notes[0].finger).toBe(5);
  expect(saved().find(s => s.id === demoSong.id)).toEqual(legacy);
  expect(screen.getByRole("heading", { name: "Morning Light · copy" })).toBeTruthy();
  await waitFor(() => expect(beforeUnload()).toBe(false));
});
it("protects temporary practice history on reload and close even when the song is saved", async () => {
  const advance = playbackClock();
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === HISTORY_KEY) throw new DOMException("Full", "QuotaExceededError");
    return setItem.call(this, key, value);
  });
  const view = render(<App />); await importOne(view.container);
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.change(screen.getByRole("slider", { name: "Tempo percentage" }), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  advance(12);
  await screen.findByText(/These passes are temporary until saved/);
  await waitFor(() => expect(beforeUnload()).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Reload update" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("temporary practice history"));
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: /Morning Light/ }));
  expect(screen.getByRole("heading", { name: "Morning Light" })).toBeTruthy();
  expect(window.confirm).toHaveBeenCalledTimes(1);
});

it("stops and resets playback when saving the built-in demo as a new library copy", async () => {
  const advance = playbackClock(); render(<App />); prepare();
  fireEvent.click(screen.getByRole("checkbox", { name: "Count in 4 beats" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" })); advance(2);
  expect(Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value)).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved to your library on this device.");
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(Number((screen.getByRole("slider", { name: "Playback position" }) as HTMLInputElement).value)).toBe(0);
  expect(screen.getByRole("heading", { name: "Morning Light · copy" })).toBeTruthy();
});
