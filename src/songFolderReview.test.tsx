// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error Node builtin is available to Vitest; production uses browser crypto.
import { webcrypto } from "node:crypto";
import * as folderModule from "./songFolder";
import { App } from "./main";
import { importScoreFile } from "./scoreImport";
import { SONGS_KEY } from "./songLibrary";
import { stubDialogs } from "./testDialog";
import { type Song } from "./music";

// Synthetic app regressions. No browser upload, device MIDI or private music.
const update = vi.hoisted(() => vi.fn());
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [true], updateServiceWorker: update }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
vi.mock("./scoreImport", () => ({ importScoreFile: vi.fn() }));
const song = (id: string): Song => ({ id, title: id, tempo: 120,
  notes: [{ id: "note", start: 0, duration: 1, pitch: 60, hand: "right", velocity: .7, finger: 2 }] });
function imported(title: string) { return { song: song(title), warnings: [], format: "mxl", scoreTimeline: { entries: [], measures: [], duration: 1 }, measureStartTempos: [120], tempoMap: [{ beat: 0, seconds: 0, bpm: 120 }] } as Awaited<ReturnType<typeof importScoreFile>>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function finger(value: string) { fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value } }); }
function saved(): Song[] { return JSON.parse(localStorage.getItem(SONGS_KEY) ?? "[]"); }
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  stubDialogs(); localStorage.clear(); update.mockReset(); vi.mocked(importScoreFile).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:export"; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });


function folderFiles(files: {name: string; content: string}[]) {
  const handle = { name: "My songs", kind: "directory", queryPermission: vi.fn().mockResolvedValue("granted"), requestPermission: vi.fn().mockResolvedValue("granted"),
    isSameEntry: vi.fn().mockResolvedValue(true), async *values() {
      for (const f of files) yield { kind: "file", name: f.name, getFile: async () => new File([f.content], f.name) };
    } };
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(handle));
  return handle;
}
async function openFolder() {
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/Folder refresh:/);
}
async function refreshFolder() {
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh \/ reconnect folder" }));
  await screen.findByText(/Folder refresh:/);
}
it("asks before importing a changed source after session-only reconnect", async () => {
  const files = [{name:"song.mxl",content:"one"}]; folderFiles(files);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Original"));
  const first = render(<App />); await openFolder(); const before = localStorage.getItem(SONGS_KEY);
  first.unmount(); files[0].content = "two";
  render(<App />); await openFolder();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("separate copy"));
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});
it("does not request permission after a pending query was canceled by navigation", async () => {
  const query = deferred<PermissionState>();
  const handle = folderFiles([]); handle.queryPermission.mockReturnValue(query.promise);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Practice room" }));
  await act(async () => query.resolve("prompt"));
  expect(handle.requestPermission).not.toHaveBeenCalled();
});
it("never removes library pieces missing from the refreshed directory", async () => {
  const files = [{name:"song.mxl",content:"one"}]; folderFiles(files);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Original"));
  render(<App />); await openFolder(); const before = localStorage.getItem(SONGS_KEY);
  files.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh / reconnect folder" }));
  await screen.findByText(/No MIDI, MusicXML or Piano project/);
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});
