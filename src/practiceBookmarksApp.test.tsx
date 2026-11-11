// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error Node built-in is available to Vitest; the app intentionally has no Node typings.
import { webcrypto } from "node:crypto";
import { App } from "./main";
import { stubDialogs } from "./testDialog";
import { demoSong } from "./music";
import { BOOKMARKS_KEY, exportBookmarks, parseBookmarks, songRevision, type PracticeBookmark } from "./practiceBookmarks";
import { SONGS_KEY } from "./songLibrary";
import { HISTORY_KEY } from "./practiceHistory";
vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
const song = { ...demoSong, id: "saved", title: "Saved passage" };
Object.defineProperty(globalThis.crypto, "subtle", { value: webcrypto.subtle, configurable: true });
const revision = await songRevision(song);
const bookmark: PracticeBookmark = { id: "bookmark", name: "Slow recital", songId: song.id, title: song.title, revision, hand: "right", mode: "recital", speed: 75, countIn: false, repeat: true };
beforeEach(() => { stubDialogs(); localStorage.clear(); localStorage.setItem(SONGS_KEY, JSON.stringify([song])); localStorage.setItem(BOOKMARKS_KEY, exportBookmarks([bookmark])); vi.spyOn(window, "confirm").mockReturnValue(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
function library() { fireEvent.click(screen.getByRole("button", { name: "My library" })); }
function setup() { fireEvent.click(screen.getByRole("button", { name: "Practice setup" })); }
it("restores exact saved music and settings paused without history or song writes", async () => {
  const before = localStorage.getItem(SONGS_KEY); render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  expect(await screen.findByRole("heading", { name: song.title })).toBeTruthy(); expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  expect(screen.getByRole("slider", { name: "Playback position" }).getAttribute("value")).toBe("0");
  setup(); expect((screen.getByRole("slider", { name: "Tempo percentage" }) as HTMLInputElement).value).toBe("75");
  expect(screen.getByRole("button", { name: /^Recital practice/ }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("checkbox", { name: "Count in 4 beats" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("checkbox", { name: "Repeat this passage" }) as HTMLInputElement).checked).toBe(true);
  expect(localStorage.getItem(SONGS_KEY)).toBe(before); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it.each(["missing", "changed", "corrupt"])("refuses %s saved revision without substituting music", async kind => {
  render(<App />); library(); localStorage.setItem(SONGS_KEY, kind === "missing" ? "[]" : kind === "corrupt" ? "bad" : JSON.stringify([{ ...song, tempo: 99 }]));
  fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy(); expect(await screen.findAllByText(/missing|changed since|could not be read/, { selector: "div.notice" })).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("saves a named bookmark and requires explicit deletion confirmation", async () => {
  render(<App />); setup(); fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Demo slow" } });
  fireEvent.click(screen.getByRole("button", { name: "Save practice bookmark" }));
  await waitFor(() => expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Delete Demo slow" })); fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Delete Demo slow" })); fireEvent.click(screen.getByRole("button", { name: "Yes, delete bookmark" }));
  await waitFor(() => expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1));
});
it("keeps dirty drafts on canceled restore and disables bookmarking unsaved edits", async () => {
  render(<App />); setup(); fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /Change piece/ })); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalled()); expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("does not apply an old digest after a newer piece selection", async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const realDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("unused"));
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>(r => { resolve = r; }));
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  fireEvent.click(screen.getByRole("button", { name: /A STUDIO ORIGINAL/ }));
  resolve(realDigest);
  await waitFor(() => expect(screen.getByRole("heading", { name: demoSong.title })).toBeTruthy());
  expect(screen.queryByText(/has changed since/)).toBeNull(); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("rechecks library storage after a delayed digest", async () => {
  let resolve!: (value: ArrayBuffer) => void;
  // Use the exact normalized revision digest bytes, independent of property ordering.
  const bytes = Uint8Array.from(revision.match(/../g)!, value => parseInt(value, 16)).buffer;
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>(r => { resolve = r; }));
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, tempo: 97 }])); resolve(bytes);
  await screen.findByText(/changed while confirming/);
  expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
});
it("handles unavailable secure digest without replacing the piece", async () => {
  vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(Error("Digest unavailable"));
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await screen.findByText("Digest unavailable"); expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
});
it("does not silently restore a bookmark deleted in another tab", async () => {
  render(<App />); library(); localStorage.setItem(BOOKMARKS_KEY, exportBookmarks([]));
  fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await screen.findByText(/changed or was deleted/); expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
});
it("allows confirmed dirty replacement but never records it as a completed pass", async () => {
  vi.mocked(window.confirm).mockReturnValue(true);
  render(<App />); setup(); fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /Change piece/ })); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await screen.findByRole("heading", { name: song.title }); expect(window.confirm).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("imports a bounded metadata backup only after confirmation without importing music", async () => {
  render(<App />); library(); const before = localStorage.getItem(SONGS_KEY);
  const file = new File([""], "bookmarks.json"); Object.defineProperty(file, "text", { value: async () => exportBookmarks([{ ...bookmark, id: "second", name: "Another pass" }]) });
  fireEvent.change(screen.getByLabelText("Import bookmark backup"), { target: { files: [file] } });
  await screen.findByRole("button", { name: "Merge bookmarks" }); expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Merge bookmarks" })); await screen.findByRole("button", { name: "Open Another pass" });
  expect(localStorage.getItem(SONGS_KEY)).toBe(before); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("recovers a metadata bookmark after project backup reimport assigns a new id, with explicit matching confirmation", async () => {
  localStorage.setItem(SONGS_KEY, "[]"); vi.mocked(window.confirm).mockReturnValue(true);
  const view = render(<App />);
  const file = new File([""], "passage.piano.json");
  Object.defineProperty(file, "text", { value: async () => JSON.stringify({ version: 1, song }) });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByRole("heading", { name: song.title });
  const imported = JSON.parse(localStorage.getItem(SONGS_KEY)!)[0]; expect(imported.id).not.toBe(song.id);
  // The imported project opens in Studio; return through its Change piece control.
  fireEvent.click(screen.getByRole("button", { name: /Change piece/ }));
  fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await screen.findByRole("heading", { name: song.title });
  await screen.findByText(/Bookmark opened at the beginning/);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Open matching saved piece"));
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("rejects ambiguous recovered revisions rather than choosing a piece", async () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "copy-a" }, { ...song, id: "copy-b" }]));
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await screen.findByText(/Several saved pieces match/); expect(window.confirm).not.toHaveBeenCalled();
});
it("does not open a recovered piece if its explicit matching confirmation is canceled", async () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "reimported" }]));
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await waitFor(() => expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Open matching saved piece")));
  expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});
it("rejects a bookmark save if its source changes while a digest is pending", async () => {
  const view = render(<App />); library();
  fireEvent.click(screen.getByRole("button", { name: /YOUR COLLECTION Saved passage/ })); setup();
  const digest = Uint8Array.from(revision.match(/../g)!, value => parseInt(value, 16)).buffer;
  let resolve!: (value: ArrayBuffer) => void;
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>(r => { resolve = r; }));
  fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Pending save" } });
  fireEvent.click(screen.getByRole("button", { name: "Save practice bookmark" }));
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, tempo: 97 }]));
  resolve(digest);
  await waitFor(() => expect(view.container.textContent).toContain("changed while saving the bookmark"));
  expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1);
  expect(view.container.textContent).not.toContain("Practice bookmark saved on this device.");
});
it.each(["library", "settings", "navigation"])("rejects stale %s state at delayed bookmark lock commit", async change => {
  const view = render(<App />); library();
  fireEvent.click(screen.getByRole("button", { name: /YOUR COLLECTION Saved passage/ })); setup();
  let run!: () => boolean, release!: (value: boolean) => void;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_: string, callback: () => boolean) => { run = callback; return new Promise<boolean>(resolve => { release = resolve; }); } } });
  try {
    fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Locked save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save practice bookmark" }));
    await waitFor(() => expect(run).toBeTypeOf("function"));
    if (change === "library") localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, tempo: 97 }]));
    if (change === "settings") fireEvent.click(screen.getByRole("checkbox", { name: "Repeat this passage" }));
    if (change === "navigation") fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
    release(run());
    await waitFor(() => expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1));
    expect(view.container.textContent).not.toContain("Practice bookmark saved on this device.");
  } finally { Reflect.deleteProperty(navigator, "locks"); }
});
