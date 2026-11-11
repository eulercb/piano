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
it("skips unchanged files and preserves locally saved finger edits", async () => {
  folderFiles([{name:"song.mxl",content:"one"}]);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Folder piece"));
  render(<App />); await openFolder(); finger("5");
  fireEvent.click(screen.getByRole("button", {name:"Save"}));
  await screen.findByText("Saved to your library on this device.");
  await refreshFolder();
  expect(saved()).toHaveLength(1); expect(saved()[0].notes[0].finger).toBe(5);
  expect(importScoreFile).toHaveBeenCalledTimes(1);
});
it("keeps changed sources on Cancel, then imports a separate updated copy on explicit confirmation", async () => {
  const files = [{name:"song.mxl",content:"one"}]; folderFiles(files);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Original"));
  render(<App />); await openFolder(); const original = saved()[0];
  files[0].content = "two";
  await refreshFolder(); expect(saved()).toHaveLength(1);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("separate copy"));
  vi.mocked(window.confirm).mockReturnValue(true);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Updated"));
  await refreshFolder(); expect(saved()).toHaveLength(2); expect(saved().find(s => s.id === original.id)).toEqual(original);
  await refreshFolder(); expect(saved()).toHaveLength(2);
});
it("does not read files after denied reconnect and requests read-only permission", async () => {
  const handle = folderFiles([{name:"song.mxl",content:"one"}]);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Original"));
  render(<App />); await openFolder();
  handle.queryPermission.mockResolvedValue("prompt"); handle.requestPermission.mockResolvedValue("denied");
  fireEvent.click(screen.getByRole("button", {name:"My library"}));
  fireEvent.click(screen.getByRole("button", {name:"Refresh / reconnect folder"}));
  await screen.findByText(/Folder permission was not granted/);
  expect(handle.requestPermission).toHaveBeenCalledWith({mode:"read"});
  expect(importScoreFile).toHaveBeenCalledTimes(1); expect(saved()).toHaveLength(1);
});
it("cancels delayed folder reads after navigation", async () => {
  const pending = deferred<File>();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({ name:"Songs", async *values() {
    yield {kind:"file",name:"song.mxl",getFile:()=>pending.promise};
  }}));
  render(<App />); fireEvent.click(screen.getByRole("button",{name:"My library"}));
  fireEvent.click(screen.getByRole("button",{name:"Open song folder"}));
  await act(async()=>{});
  fireEvent.click(screen.getByRole("button",{name:"Practice room"}));
  await act(async()=>pending.resolve(new File(["one"],"song.mxl")));
  expect(saved()).toHaveLength(0); expect(importScoreFile).not.toHaveBeenCalled();
});

it("restores a saved shortcut without reading files or requesting permissions on mount", async () => {
  const handle = folderFiles([]); const values = vi.spyOn(handle,"values");
  vi.spyOn(folderModule,"storedFolder").mockResolvedValue({id:"saved",handle});
  render(<App />); fireEvent.click(screen.getByRole("button",{name:"My library"}));
  await screen.findByRole("button",{name:"Refresh / reconnect folder"});
  expect(values).not.toHaveBeenCalled(); expect(handle.queryPermission).not.toHaveBeenCalled();
  expect(handle.requestPermission).not.toHaveBeenCalled();
});
it("does not let a late saved shortcut replace a newly selected folder", async () => {
  const pending = deferred<folderModule.FolderConnection | undefined>();
  vi.spyOn(folderModule,"storedFolder").mockReturnValue(pending.promise);
  const selected = folderFiles([{name:"song.mxl",content:"one"}]);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Original"));
  render(<App />); await openFolder();
  await act(async()=> pending.resolve({id:"old",handle:{...selected,name:"Old folder"}}));
  fireEvent.click(screen.getByRole("button",{name:"My library"}));
  expect(screen.getByText(/Folder: My songs/)).toBeTruthy();
  expect(screen.queryByText(/Folder: Old folder/)).toBeNull();
});
