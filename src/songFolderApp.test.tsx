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

it("calls the picker synchronously with Window and read-only options", async () => {
  const handle = folderFiles([]);
  let inClick = false;
  const picker = vi.fn(function (this: Window, options: { mode: string }) {
    // A receiver-sensitive host implementation, not a claim that every Window
    // Web IDL binding rejects an undefined receiver.
    if (this !== window) throw new TypeError("Illegal invocation");
    expect(inClick).toBe(true);
    expect(options).toEqual({ mode: "read" });
    return Promise.resolve(handle);
  });
  vi.stubGlobal("showDirectoryPicker", picker);
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  inClick = true;
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  inClick = false;
  await screen.findByText(/No MIDI, MusicXML or Piano project/);
  expect(picker).toHaveBeenCalledTimes(1);
});

it.each([undefined, {}])("falls back to file import with a restored shortcut and non-callable picker (%s)", async picker => {
  const handle = folderFiles([]), values = vi.spyOn(handle, "values");
  vi.spyOn(folderModule, "storedFolder").mockResolvedValue({ id: "saved", handle });
  vi.stubGlobal("showDirectoryPicker", picker);
  const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  vi.mocked(importScoreFile).mockResolvedValue(imported("Fallback original"));
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  await screen.findByRole("button", { name: "Refresh / reconnect folder" });
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/Folder access is unavailable/);
  expect(click).toHaveBeenCalledTimes(1);
  expect(values).not.toHaveBeenCalled();
  expect(handle.requestPermission).not.toHaveBeenCalled();
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["original"], "fallback.mxl")] } });
  await screen.findByText("Score imported with playable notes, hands and printed fingerings.");
  expect(saved()).toHaveLength(1);
});

it("reconnects a restored shortcut even when the native picker is unavailable", async () => {
  const handle = folderFiles([]), values = vi.spyOn(handle, "values");
  vi.spyOn(folderModule, "storedFolder").mockResolvedValue({ id: "saved", handle });
  vi.stubGlobal("showDirectoryPicker", undefined);
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  await screen.findByRole("button", { name: "Refresh / reconnect folder" });
  expect(values).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh / reconnect folder" }));
  await screen.findByText(/No MIDI, MusicXML or Piano project/);
  expect(values).toHaveBeenCalledTimes(1);
  expect(handle.queryPermission).toHaveBeenCalledWith({ mode: "read" });
});

it.each([
  ["AbortError", /Folder selection or access was not completed/],
  ["SecurityError", /The browser blocked folder access/],
  ["NotAllowedError", /Folder permission was not granted/],
  ["TypeError", /The folder chooser could not open/],
])("explains %s without exposing native paths and allows a fresh retry", async (name, message) => {
  const handle = folderFiles([]);
  const picker = vi.fn().mockRejectedValueOnce(new DOMException("/private/synthetic-secret", name as string)).mockResolvedValue(handle);
  vi.stubGlobal("showDirectoryPicker", picker);
  localStorage.setItem(SONGS_KEY, JSON.stringify([song("Saved original")]));
  const before = localStorage.getItem(SONGS_KEY);
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(message);
  expect(document.body.textContent).not.toContain("synthetic-secret");
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
  expect(handle.queryPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/No MIDI, MusicXML or Piano project/);
  expect(picker).toHaveBeenCalledTimes(2);
});

it("reports a vanished saved directory without claiming the chooser failed", async () => {
  const handle = folderFiles([]);
  vi.spyOn(handle, "values").mockImplementation(async function* () { throw new DOMException("/private/synthetic-secret", "NotFoundError"); });
  vi.spyOn(folderModule, "storedFolder").mockResolvedValue({ id: "saved", handle });
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  await screen.findByRole("button", { name: "Refresh / reconnect folder" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh / reconnect folder" }));
  await screen.findByText(/Folder refresh stopped before finishing/);
  expect(document.body.textContent).not.toContain("synthetic-secret");
  expect(saved()).toHaveLength(0);
});

it("keeps an unsaved finger draft when folder selection is not completed", async () => {
  folderFiles([{ name: "original.mxl", content: "original" }]);
  vi.mocked(importScoreFile).mockResolvedValue(imported("Draft keeper"));
  render(<App />); await openFolder(); finger("5");
  const before = localStorage.getItem(SONGS_KEY);
  const picker = vi.fn().mockRejectedValue(new DOMException("Canceled", "AbortError"));
  vi.stubGlobal("showDirectoryPicker", picker);
  fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  expect(picker).not.toHaveBeenCalled(); // Declining draft replacement stops here.
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/Folder selection or access was not completed/);
  fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("5");
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});

it("ignores a picker rejection after navigation instead of replacing the latest notice", async () => {
  let reject!: (reason: unknown) => void;
  vi.stubGlobal("showDirectoryPicker", vi.fn(() => new Promise((_, fail) => { reject = fail; })));
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  fireEvent.click(screen.getByRole("button", { name: "Practice room" }));
  await act(async () => reject(new DOMException("blocked", "SecurityError")));
  expect(screen.queryByText(/The browser blocked folder access/)).toBeNull();
  expect(saved()).toHaveLength(0);
});

it("keeps earlier imports when folder enumeration later fails", async () => {
  const handle = folderFiles([]);
  vi.spyOn(handle, "values").mockImplementation(async function* () {
    yield { kind: "file", name: "first.mxl", getFile: async () => new File(["first"], "first.mxl") };
    throw new DOMException("/private/synthetic-secret", "NotReadableError");
  });
  vi.mocked(importScoreFile).mockResolvedValue(imported("Imported before interruption"));
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/Folder refresh stopped before finishing. Already saved songs are kept/);
  expect(saved()).toHaveLength(1);
  expect(saved()[0].title).toBe("Imported before interruption");
  expect(document.body.textContent).not.toContain("synthetic-secret");
});

it("suppresses native per-file paths while retaining parser guidance and successful imports", async () => {
  const handle = folderFiles([]);
  localStorage.setItem(SONGS_KEY, JSON.stringify([song("Existing saved piece")]));
  const original = saved()[0];
  vi.spyOn(handle, "values").mockImplementation(async function* () {
    yield { kind: "file", name: "good.mxl", getFile: async () => new File(["good"], "good.mxl") };
    yield { kind: "file", name: "unreadable.mxl", getFile: async () => {
      throw Object.assign(new Error("/private/synthetic-read-secret"), { name: "NotReadableError" });
    } };
    yield { kind: "file", name: "unsupported.mxl", getFile: async () => new File(["unsupported"], "unsupported.mxl") };
  });
  vi.mocked(importScoreFile).mockResolvedValueOnce(imported("Good partial import"))
    .mockRejectedValueOnce(new Error("Unsupported synthetic notation. Choose a supported score."));
  render(<App />); fireEvent.click(screen.getByRole("button", { name: "My library" }));
  fireEvent.click(screen.getByRole("button", { name: "Open song folder" }));
  await screen.findByText(/Folder refresh: 1 imported, 0 unchanged, 0 kept existing/);
  expect(document.body.textContent).toContain("unreadable.mxl: Could not read this file.");
  expect(document.body.textContent).toContain("unsupported.mxl: Unsupported synthetic notation.");
  expect(document.body.textContent).not.toContain("synthetic-read-secret");
  expect(saved()).toHaveLength(2);
  expect(saved().find(s => s.id === original.id)).toEqual(original);
  expect(saved().some(s => s.title === "Good partial import")).toBe(true);
});
