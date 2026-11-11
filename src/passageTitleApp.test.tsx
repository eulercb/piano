// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// @ts-expect-error Node built-in is available to Vitest; the app intentionally has no Node typings.
import { webcrypto } from "node:crypto";
import { App } from "./main";
import { stubDialogs } from "./testDialog";
import { clickDownload } from "./testDownload";
import { parseMusicXml } from "./musicxml";
import { normalizeSong, parseProject } from "./project";
import { SONGS_KEY } from "./songLibrary";
import { BOOKMARKS_KEY, parseBookmarks } from "./practiceBookmarks";
import type { Song } from "./music";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));
const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><notations><technical><fingering>2</fingering></technical></notations></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;
const folderSource = { folderId: "folder", name: "synthetic.musicxml", digest: "a".repeat(64) };
let downloaded: Blob;
beforeEach(() => {
  stubDialogs(); localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) { downloaded = blob; return "blob:synthetic"; }
    static revokeObjectURL() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const saved = (): Song[] => JSON.parse(localStorage.getItem(SONGS_KEY) ?? "[]");
const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject;
  reader.readAsText(blob);
});

it.each([
  ["seconds", 490], ["seconds", 491], ["seconds", 500],
  ["measures", 490], ["measures", 491], ["measures", 500],
] as const)("saves and reimports an edited %s passage with a %i-character original title", async (kind, length) => {
  const title = "T".repeat(length);
  const original = normalizeSong({ ...(kind === "measures" ? parseMusicXml(xml).song : {
    tempo: 120, duration: 1, scoreXml: xml,
    notes: [{ id: "first", pitch: 60, start: 0, duration: 0.5, hand: "right", velocity: 0.7, finger: 2 },
      { id: "second", pitch: 62, start: 0.5, duration: 0.5, hand: "right", velocity: 0.7 }],
  }), id: "original", title, folderSource });
  localStorage.setItem(SONGS_KEY, JSON.stringify([original]));
  const view = render(<App />);
  click("My library"); click(/YOUR COLLECTION/); click("Practice setup"); click("Prepare a song");
  click("Select the beginning half");
  click(kind === "measures" ? "Trim score passage" : "Trim passage");
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "5" } });

  // An unsaved passage export must already be valid, including its edited fingers/source.
  clickDownload(screen.getByRole("button", { name: "Export project + fingers" }));
  const projectText = await read(downloaded);
  const passage = parseProject(projectText);
  expect(passage.title).toBe(length === 490 ? title + " · passage" : title);
  expect(passage.id).not.toBe(original.id);
  expect(passage.notes).toHaveLength(1);
  expect(passage.notes[0].finger).toBe(5);
  expect(passage.folderSource).toEqual(folderSource);
  expect(passage.scoreOrigin).toBe(kind === "measures" ? "musicxml" : undefined);
  expect(passage.scoreXml).toEqual(kind === "measures" ? expect.stringContaining("<fingering>5</fingering>") : xml);
  click("Save");
  await waitFor(() => expect(saved()).toHaveLength(2));
  expect(saved()[0]).toEqual(passage);
  expect(saved()[1]).toEqual(original);

  fireEvent.change(screen.getByRole("textbox", { name: "Bookmark name" }), { target: { value: "Long title passage" } });
  click("Save practice bookmark");
  await waitFor(() => expect(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY))).toHaveLength(1));
  const bookmarks = parseBookmarks(localStorage.getItem(BOOKMARKS_KEY));
  expect(bookmarks[0].title).toBe(passage.title);
  clickDownload(screen.getByRole("button", { name: "Export bookmarks" }));
  expect(parseBookmarks(await read(downloaded))).toEqual(bookmarks);

  const file = new File([projectText], "synthetic-passage.piano.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => projectText });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(saved()).toHaveLength(3));
  const { id: _id, folderSource: _folder, ...music } = passage;
  // Manual imports intentionally detach the old folder identity, while parser backups preserve it.
  expect(saved()[0]).toEqual({ ...music, id: expect.any(String) });
  expect(saved()[0].id).not.toBe(passage.id);
  expect(saved()[1]).toEqual(passage);
  expect(saved()[2]).toEqual(original);

  // A second trim must not overflow the first passage's title or replace any saved copy.
  const reimported = saved()[0];
  click(kind === "measures" ? "Trim score passage" : "Trim passage");
  clickDownload(screen.getByRole("button", { name: "Export project + fingers" }));
  const repeated = parseProject(await read(downloaded));
  expect(repeated.title).toBe(passage.title);
  expect(repeated.id).not.toBe(reimported.id);
  expect(repeated.notes).toEqual(passage.notes);
  expect(repeated.scoreOrigin).toBe(passage.scoreOrigin);
  expect(repeated.scoreXml).toEqual(kind === "measures" ? expect.stringContaining("<fingering>5</fingering>") : xml);
  click("Save");
  await waitFor(() => expect(saved()).toHaveLength(4));
  expect(saved()).toEqual([repeated, reimported, passage, original]);
});
