// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
import { parseMidi, type Song } from "./music";
import { parseProject } from "./project";
import { SONGS_KEY } from "./songLibrary";
import { stubDialogs } from "./testDialog";
import { clickDownload } from "./testDownload";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock("./Score", () => ({ Score: () => null }));
vi.mock("./MidiConnection", () => ({ MidiConnection: () => null }));

const source: Song = { id: "guarded-midi", title: "Synthetic mapped export", tempo: 10000, duration: 3,
  midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 6000 }, { seconds: 1, microsecondsPerQuarter: 0xffffff }],
  notes: [{ id: "note", pitch: 60, start: 1.1, duration: .000256, velocity: .7, hand: "right", finger: 2 }],
  scoreXml: '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>' };
let downloads: Blob[], blobCount: number;
beforeEach(() => {
  stubDialogs(); localStorage.clear(); downloads = []; blobCount = 0;
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const BaseBlob = Blob;
  vi.stubGlobal("Blob", class extends BaseBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) { super(parts, options); blobCount++; }
  });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob) { downloads.push(blob); return "blob:synthetic"; }
    static revokeObjectURL() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const button = (name: string) => screen.getByRole("button", { name });
async function open(container: HTMLElement, song = source) {
  const text = JSON.stringify({ version: 1, song });
  const file = Object.assign(new File([text], "synthetic.piano.json"), { text: async () => text });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByRole("heading", { name: song.title });
  await screen.findByRole("heading", { name: "Add, delete & retime notes" });
}
const readBlob = (blob: Blob, binary = false) => new Promise<string | ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result!); reader.onerror = reject;
  if (binary) reader.readAsArrayBuffer(blob); else reader.readAsText(blob);
});

it("fails before Blob/download, keeps repeated attempts and dirty fingers intact, and exports a complete project", async () => {
  const view = render(<App />); await open(view.container);
  const savedBefore = localStorage.getItem(SONGS_KEY);
  fireEvent.change(screen.getByRole("combobox", { name: "Finger" }), { target: { value: "4" } });
  for (let i = 0; i < 2; i++) {
    fireEvent.click(button("Export MIDI"));
    expect(screen.getByText(/No MIDI file was created\. Your song is unchanged/)).toBeTruthy();
    expect(screen.getByText(/Choose Export project \+ fingers/)).toBeTruthy();
    expect(downloads).toHaveLength(0); expect(blobCount).toBe(0);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("4");
    expect(localStorage.getItem(SONGS_KEY)).toBe(savedBefore);
  }
  const closing = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(true);
  clickDownload(button("Export project + fingers"));
  const project = parseProject(await readBlob(downloads[0]) as string);
  expect(project.midiTempoMap).toEqual(source.midiTempoMap);
  expect(project.duration).toBe(source.duration); expect(project.scoreXml).toBe(source.scoreXml);
  expect(project.notes).toEqual([{ ...source.notes[0], finger: 4 }]);
  expect(localStorage.getItem(SONGS_KEY)).toBe(savedBefore);
  expect(downloads[0].type).toBe("application/json"); expect(blobCount).toBe(1);
});

it("exports actual mapped MIDI for the currently selected piece after an earlier refusal", async () => {
  const view = render(<App />); await open(view.container);
  fireEvent.click(button("Export MIDI")); expect(downloads).toHaveLength(0);
  const next: Song = { ...source, id: "second", title: "Representable second piece", tempo: 120,
    midiTempoMap: [{ seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: 1, microsecondsPerQuarter: 750000 }],
    notes: [{ ...source.notes[0], start: .25, duration: 2 }] };
  await open(view.container, next);
  const savedBefore = localStorage.getItem(SONGS_KEY);
  clickDownload(button("Export MIDI"));
  expect(downloads).toHaveLength(1); expect(downloads[0].type).toBe("audio/midi");
  const restored = parseMidi(await readBlob(downloads[0], true) as ArrayBuffer);
  expect(restored.title).toBe(next.title);
  expect(restored.midiTempoMap!.map(entry => entry.microsecondsPerQuarter)).toEqual([500000, 750000]);
  expect(restored.notes[0].start).toBeCloseTo(.25, 3);
  expect(restored.notes[0].duration).toBeCloseTo(2, 3);
  expect(localStorage.getItem(SONGS_KEY)).toBe(savedBefore);
  expect((screen.getByRole("combobox", { name: "Finger" }) as HTMLSelectElement).value).toBe("2");
});
