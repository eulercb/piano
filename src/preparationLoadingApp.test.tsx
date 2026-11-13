// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { loadStudioAuthoring, loadScoreImporter } from "./preparationModules";
import { demoSong } from "./music";
import { SONGS_KEY } from "./songLibrary";
import { stubDialogs } from "./testDialog";
import { clickDownload } from "./testDownload";

// Real editing, validation, imports and persistence. Only chunk availability,
// engraving, browser dialogs and download dispatch are simulated.
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
vi.mock("./preparationModules", () => ({ loadedStudioAuthoring: () => undefined, loadStudioAuthoring: vi.fn(), loadScoreImporter: vi.fn() }));
type StudioModule = Awaited<ReturnType<typeof loadStudioAuthoring>>;
type ImportModule = Awaited<ReturnType<typeof loadScoreImporter>>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const button = (name: string) => screen.getByRole("button", { name });
function prepare() { openPracticeRoom(); fireEvent.click(button("Practice setup")); fireEvent.click(button("Prepare a song")); }
function choose(container: HTMLElement, file: File) { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } }); }
const xml = '<score-partwise version="4.0"><work><work-title>Deferred synthetic score</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
const scoreFile = () => Object.assign(new File([xml], "synthetic.musicxml"), { arrayBuffer: vi.fn(async () => new TextEncoder().encode(xml).buffer) });
let downloads: Blob[];
beforeEach(() => {
  localStorage.clear(); stubDialogs(); downloads = [];
  vi.mocked(loadStudioAuthoring).mockReset().mockImplementation(() => import("./StudioNoteAuthoring"));
  vi.mocked(loadScoreImporter).mockReset().mockImplementation(() => import("./scoreImport"));
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: Blob) { downloads.push(blob); return "blob:synthetic"; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
async function exported() {
  clickDownload(button("Export project + fingers"));
  return new Promise<any>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(JSON.parse(String(reader.result)).song); reader.onerror = reject; reader.readAsText(downloads.at(-1)!); });
}

it("loads neither preparation module in Practice or Library, and retains edits through failed authoring, retry and repeated navigation", async () => {
  const pending = deferred<StudioModule>();
  vi.mocked(loadStudioAuthoring).mockRejectedValueOnce(Error("Temporary chunk failure")).mockReturnValueOnce(pending.promise);
  renderPractice(<App />);
  expect(loadStudioAuthoring).not.toHaveBeenCalled(); expect(loadScoreImporter).not.toHaveBeenCalled();
  fireEvent.click(button("My library"));
  expect(loadStudioAuthoring).not.toHaveBeenCalled(); expect(loadScoreImporter).not.toHaveBeenCalled();
  fireEvent.click(button("Prepare a song"));
  await screen.findByText(/Note authoring could not load/);
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
  const before = await exported();
  expect(before.notes[0].finger).toBe(5); expect(localStorage.getItem(SONGS_KEY)).toBeNull();
  const retry = button("Retry note authoring"); retry.focus(); fireEvent.click(retry);
  expect(loadStudioAuthoring).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(await import("./StudioNoteAuthoring")));
  expect(document.activeElement).toBe(screen.getByRole("region", { name: "Note authoring tools" }));
  expect(await exported()).toEqual(before);
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Duration \(seconds\)/ }), { target: { value: "2" } });
  fireEvent.click(button("Apply note changes"));
  const draft = await exported(); expect(draft.notes[0]).toMatchObject({ duration: 2, finger: 5 });
  for (let index = 0; index < 2; index++) {
    fireEvent.click(button("My library")); fireEvent.click(button("Practice history")); fireEvent.click(button("Practice room")); openPracticeRoom();
    expect(button("Play")).toBeTruthy();
    prepare(); await screen.findByRole("button", { name: "Apply note changes" });
    expect(await exported()).toEqual(draft);
  }
  expect(loadScoreImporter).not.toHaveBeenCalled();
  expect(localStorage.getItem(SONGS_KEY)).toBeNull();
  fireEvent.click(button("Save")); await screen.findByText("Saved to your library on this device.");
  expect(JSON.parse(localStorage.getItem(SONGS_KEY)!)[0].notes).toEqual(draft.notes);
});

it("does not pull a departed Studio page or old piece back when its chunk finally arrives", async () => {
  const pending = deferred<StudioModule>(); vi.mocked(loadStudioAuthoring).mockReturnValueOnce(pending.promise);
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...demoSong, id: "other", title: "Other saved piece" }]));
  renderPractice(<App />); prepare();
  expect(screen.getByText(/Loading note authoring/)).toBeTruthy();
  fireEvent.click(button("My library")); fireEvent.click(screen.getByRole("button", { name: /Other saved piece/ })); openPracticeRoom();
  await act(async () => pending.resolve(await import("./StudioNoteAuthoring")));
  expect(screen.getByRole("heading", { level: 1, name: "Other saved piece" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Note authoring tools" })).toBeNull();
  expect(button("Play")).toBeTruthy();
  prepare(); await screen.findByRole("button", { name: "Apply note changes" });
  expect((await exported()).id).toBe("other");
});

it("keeps a dirty piece and stored data exportable after an importer chunk fails, then retries the same file explicitly", async () => {
  const view = renderPractice(<App />); prepare();
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });
  const draft = await exported(), file = scoreFile();
  vi.mocked(window.confirm).mockReturnValue(true);
  vi.mocked(loadScoreImporter).mockRejectedValueOnce(Error("Unavailable chunk"));
  choose(view.container, file);
  await screen.findByText(/Score import tools could not load/);
  expect(await exported()).toEqual(draft); expect(localStorage.getItem(SONGS_KEY)).toBeNull();
  expect(file.arrayBuffer).not.toHaveBeenCalled();
  choose(view.container, file);
  await screen.findByRole("heading", { name: "Deferred synthetic score" });
  expect(loadScoreImporter).toHaveBeenCalledTimes(2);
  expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem(SONGS_KEY)!)[0].title).toBe("Deferred synthetic score");
});

it("cancels a delayed importer before file reading after navigation", async () => {
  const pending = deferred<ImportModule>(); vi.mocked(loadScoreImporter).mockReturnValueOnce(pending.promise);
  const view = renderPractice(<App />), file = scoreFile(); choose(view.container, file);
  fireEvent.click(button("My library"));
  await act(async () => pending.resolve(await import("./scoreImport")));
  expect(file.arrayBuffer).not.toHaveBeenCalled(); expect(localStorage.getItem(SONGS_KEY)).toBeNull();
  expect(screen.getByRole("heading", { name: "Your next favorite piece." })).toBeTruthy();
  expect(screen.queryByText(/Score import tools could not load/)).toBeNull();
});

it("cancels delayed import when newer edits apply, and ignores its eventual failure", async () => {
  const pending = deferred<ImportModule>(); vi.mocked(loadScoreImporter).mockReturnValueOnce(pending.promise);
  const view = renderPractice(<App />); prepare(); const file = scoreFile(); choose(view.container, file);
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "4" } });
  await act(async () => pending.reject(Error("Old chunk failure")));
  expect(screen.queryByText(/Score import tools could not load/)).toBeNull();
  expect(file.arrayBuffer).not.toHaveBeenCalled(); expect(localStorage.getItem(SONGS_KEY)).toBeNull();
  expect((await exported()).notes[0].finger).toBe(4);
});

it("allows only the newest file selection to read and persist after delayed loading", async () => {
  const first = deferred<ImportModule>(), second = deferred<ImportModule>();
  vi.mocked(loadScoreImporter).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = renderPractice(<App />), staleFile = scoreFile(), currentFile = scoreFile();
  choose(view.container, staleFile); choose(view.container, currentFile);
  const importer = await import("./scoreImport");
  await act(async () => second.resolve(importer));
  await screen.findByRole("heading", { name: "Deferred synthetic score" });
  await act(async () => first.resolve(importer));
  expect(staleFile.arrayBuffer).not.toHaveBeenCalled(); expect(currentFile.arrayBuffer).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(JSON.parse(localStorage.getItem(SONGS_KEY)!)).toHaveLength(1));
});
