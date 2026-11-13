// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
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
function setup() { openPracticeRoom(); fireEvent.click(screen.getByRole("button", { name: "Practice setup" })); }
it("review: does not save a bookmark against a library revision changed during digest", async () => {
  renderPractice(<App />); library(); fireEvent.click(screen.getByRole("button", { name: /Saved passage.*BPM/ }));
  setup();
  let resolve!: (value: ArrayBuffer) => void;
  const bytes = Uint8Array.from(revision.match(/../g)!, value => parseInt(value, 16)).buffer;
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>(r => { resolve = r; }));
  fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Stale save" } });
  fireEvent.click(screen.getByRole("button", { name: "Save practice bookmark" }));
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, tempo: 97 }]));
  resolve(bytes);
  await screen.findByText(/Practice bookmark saved|saved piece changed|library revision/);
  expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1);
});

it("review: refuses a bookmark removed during its asynchronous revision check", async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const bytes = Uint8Array.from(revision.match(/../g)!, value => parseInt(value, 16)).buffer;
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>(r => { resolve = r; }));
  renderPractice(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  localStorage.setItem(BOOKMARKS_KEY, exportBookmarks([])); resolve(bytes);
  await screen.findByText(/bookmark changed while opening/);
  expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});

it("review: rechecks recovered music after confirmation and rejects replaced bytes", async () => {
  localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "recovered" }]));
  vi.mocked(window.confirm).mockImplementation(() => {
    localStorage.setItem(SONGS_KEY, JSON.stringify([{ ...song, id: "recovered", tempo: 99 }]));
    return true;
  });
  renderPractice(<App />); library(); fireEvent.click(screen.getByRole("button", { name: "Open Slow recital" }));
  await screen.findByText(/changed while confirming/);
  expect(screen.getByRole("heading", { name: "On your music stand" })).toBeTruthy();
  expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
});

it("review: cancels a bookmark save still waiting for the storage lock after navigation", async () => {
  let commit!: () => boolean, finish!: (value: boolean) => void;
  vi.stubGlobal("navigator", { locks: { request: (_name: string, callback: () => boolean) => {
    commit = callback;
    return new Promise<boolean>(resolve => { finish = resolve; });
  } } });
  try {
    renderPractice(<App />); setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Canceled save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save practice bookmark" }));
    await waitFor(() => expect(commit).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Prepare a song" }));
    finish(commit());
    expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
