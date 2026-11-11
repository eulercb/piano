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

it("opens a safe saved bookmark despite an unrelated unsafe cached score", async () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "legacy", title: "Legacy", scoreXml: "https://example.invalid/score.xml" }, song]));
  const before = localStorage.getItem(SONGS_KEY);
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  expect(await screen.findByText(/Bookmark opened at the beginning, paused/)).toBeTruthy();
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});
it("saves a demo bookmark despite an unrelated unsafe cached score", async () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "legacy", title: "Legacy", scoreXml: "https://example.invalid/score.xml" }, song]));
  const before = localStorage.getItem(SONGS_KEY);
  render(<App />); setup(); fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Demo safe" } });
  fireEvent.click(screen.getByRole("button", { name: "Save practice bookmark" }));
  await waitFor(() => expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(2));
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});
it("finds a safe renamed-id bookmark match past an unrelated unsafe candidate", async () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "legacy", title: "Legacy", scoreXml: "https://example.invalid/score.xml" }, { ...song, id: "replacement" }]));
  vi.mocked(window.confirm).mockReturnValue(true);
  const before = localStorage.getItem(SONGS_KEY);
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  expect(await screen.findByText(/Bookmark opened at the beginning, paused/)).toBeTruthy();
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});

it.each([undefined, 'musicxml'] as const)("refuses a selected unsafe source without substituting an exact safe match (%s)", async scoreOrigin => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, scoreXml: "https://example.invalid/score.xml", scoreOrigin }, { ...song, id: "replacement" }]));
  vi.mocked(window.confirm).mockReturnValue(true);
  const before = localStorage.getItem(SONGS_KEY);
  render(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  expect(await screen.findByText(/expected well-formed inline MusicXML/)).toBeTruthy();
  expect(screen.queryByText(/Bookmark opened at the beginning, paused/)).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
  expect(localStorage.getItem(SONGS_KEY)).toBe(before);
});
