// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Score } from "./Score";
import { loadScoreRenderer } from "./scoreRenderer";
import { parseMusicXml } from "./musicxml";

vi.mock("./scoreRenderer", () => ({ loadScoreRenderer: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const instances: FakeRenderer[] = [];
let load = vi.fn<(xml: string) => Promise<void>>();
let draw = vi.fn<() => void>();

class FakeCursor {
  index = 0;
  cursorElement = document.createElement("div");
  get Iterator() {
    return { EndReached: this.index >= 3, CurrentMeasureIndex: 0,
      CurrentRelativeInMeasureTimestamp: { RealValue: this.index / 4 } };
  }
  reset = vi.fn(() => { this.index = 0; });
  next = vi.fn(() => { this.index++; });
  hide = vi.fn();
  show = vi.fn();
}

class FakeRenderer {
  cursor = new FakeCursor();
  private resizing = false;
  private onResize = () => this.render();
  xml = "";
  constructor(
    readonly container: HTMLElement,
    readonly options: { autoResize: boolean },
  ) {
    instances.push(this);
    this.AutoResizeEnabled = options.autoResize;
  }
  load = vi.fn(async (xml: string) => {
    this.xml = xml;
    await load(xml);
    // Model load() writing state/DOM even if cleanup ran while it was pending.
    this.container.textContent = `Loaded ${xml}`;
  });
  render = vi.fn(() => {
    draw();
    this.cursor = new FakeCursor();
    this.container.textContent = `Rendered ${this.xml}`;
  });
  clear = vi.fn(() => { this.container.replaceChildren(); });
  dispose = vi.fn(() => { this.AutoResizeEnabled = false; });
  set AutoResizeEnabled(enabled: boolean) {
    if (this.resizing === enabled) return;
    this.resizing = enabled;
    if (enabled) window.addEventListener("resize", this.onResize);
    else window.removeEventListener("resize", this.onResize);
  }
}

type RendererModule = Awaited<ReturnType<typeof loadScoreRenderer>>;
const rendererModule = { OpenSheetMusicDisplay: FakeRenderer } as unknown as RendererModule;
const importRenderer = vi.mocked(loadScoreRenderer);

beforeEach(() => {
  instances.length = 0;
  load = vi.fn().mockResolvedValue(undefined);
  draw = vi.fn();
  importRenderer.mockReset().mockResolvedValue(rendererModule);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("lazy reading score", () => {
  it("does not request the engraving module without XML", () => {
    const view = render(<Score />);
    view.rerender(<Score xml="" />);
    expect(importRenderer).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
    expect(screen.getByText(/Import MusicXML or a Piano project/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces loading until the module and score are ready", async () => {
    const module = deferred<RendererModule>();
    const score = deferred<void>();
    importRenderer.mockReturnValue(module.promise);
    load.mockReturnValue(score.promise);
    const view = render(<Score xml="first" editable />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading reading score/);
    expect(view.container.querySelector(".score-sheet")?.getAttribute("aria-busy")).toBe("true");
    expect(instances).toHaveLength(0);
    await act(async () => { module.resolve(rendererModule); });
    expect(instances[0].options.autoResize).toBe(false);
    window.dispatchEvent(new Event("resize"));
    expect(instances[0].render).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
    await act(async () => { score.resolve(); });
    expect(instances[0].load).toHaveBeenCalledWith("first");
    expect(instances[0].render).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Rendered first")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(view.container.querySelector(".score-sheet")?.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText(/Score-linked Studio/)).toBeTruthy();
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(instances[0].render).toHaveBeenCalledTimes(2));
  });

  it("offers an accessible retry when the module download fails", async () => {
    importRenderer.mockRejectedValueOnce(new Error("offline"));
    render(<Score xml="first" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/MIDI practice is still available/);
    expect(screen.queryByRole("status")).toBeNull();
    expect(instances).toHaveLength(0);
    const retry = deferred<RendererModule>();
    importRenderer.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole("button", { name: "Retry score" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
    await act(async () => { retry.resolve(rendererModule); });
    expect(importRenderer).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Rendered first")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry score" })).toBeNull();
  });

  it.each(["load", "render"])("cleans up a %s failure and retries with a fresh instance", async (step) => {
    if (step === "load") load.mockRejectedValueOnce(new Error("bad score"));
    else draw.mockImplementationOnce(() => { throw new Error("drawing failed"); });
    render(<Score xml="first" />);
    await screen.findByRole("alert");
    const failed = instances[0];
    expect(failed.dispose).toHaveBeenCalled();
    expect(failed.clear).toHaveBeenCalled();
    expect(failed.container.childNodes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry score" }));
    await screen.findByText("Rendered first");
    expect(instances).toHaveLength(2);
    expect(failed.container.isConnected).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores an obsolete module import after XML changes", async () => {
    const oldImport = deferred<RendererModule>();
    importRenderer.mockReturnValueOnce(oldImport.promise);
    const view = render(<Score xml="first" />);
    view.rerender(<Score xml="second" />);
    await screen.findByText("Rendered second");
    await act(async () => { oldImport.resolve(rendererModule); });
    expect(instances).toHaveLength(1);
    expect(load).toHaveBeenCalledExactlyOnceWith("second");
  });

  it.each(["resolve", "reject"])("ignores an obsolete score load that later %ss", async (outcome) => {
    const oldLoad = deferred<void>();
    load.mockReturnValueOnce(oldLoad.promise);
    const view = render(<Score xml="first" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const old = instances[0];
    view.rerender(<Score xml="second" />);
    await screen.findByText("Rendered second");
    expect(old.dispose).toHaveBeenCalled();
    expect(old.clear).toHaveBeenCalled();
    expect(old.container.isConnected).toBe(false);
    await act(async () => {
      if (outcome === "resolve") oldLoad.resolve();
      else oldLoad.reject(new Error("late failure"));
    });
    expect(old.render).not.toHaveBeenCalled();
    expect(old.container.childNodes).toHaveLength(0);
    expect(screen.getByText("Rendered second")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    window.dispatchEvent(new Event("resize"));
    expect(old.render).not.toHaveBeenCalled();
    await waitFor(() => expect(instances[1].render).toHaveBeenCalledTimes(2));
  });

  it("does not initialize a renderer when unmounted during import", async () => {
    const module = deferred<RendererModule>();
    importRenderer.mockReturnValue(module.promise);
    const view = render(<Score xml="first" />);
    view.unmount();
    await act(async () => { module.resolve(rendererModule); });
    expect(instances).toHaveLength(0);
  });

  it.each(["resolve", "reject"])("cleans up when a load %ss after unmount", async (outcome) => {
    const score = deferred<void>();
    load.mockReturnValue(score.promise);
    const view = render(<Score xml="first" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const instance = instances[0];
    view.unmount();
    expect(instance.dispose).toHaveBeenCalled();
    expect(instance.clear).toHaveBeenCalled();
    await act(async () => {
      if (outcome === "resolve") score.resolve();
      else score.reject(new Error("late failure"));
    });
    expect(instance.render).not.toHaveBeenCalled();
    expect(instance.container.isConnected).toBe(false);
    expect(instance.container.childNodes).toHaveLength(0);
  });

  it("releases a rendered score and its resize listener when XML is removed", async () => {
    const view = render(<Score xml="first" />);
    await screen.findByText("Rendered first");
    const instance = instances[0];
    view.rerender(<Score />);
    window.dispatchEvent(new Event("resize"));
    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(instance.dispose).toHaveBeenCalled();
    expect(instance.clear).toHaveBeenCalled();
    expect(instance.container.isConnected).toBe(false);
    expect(screen.getByText(/Import MusicXML or a Piano project/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not retain an error when XML is removed or replaced", async () => {
    importRenderer.mockRejectedValueOnce(new Error("offline"));
    const view = render(<Score xml="first" />);
    await screen.findByRole("alert");
    view.rerender(<Score />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry score" })).toBeNull();
    view.rerender(<Score xml="second" />);
    await screen.findByText("Rendered second");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("supports Strict Mode setup/cleanup and releases the active renderer on unmount", async () => {
    const view = render(<StrictMode><Score xml="first" /></StrictMode>);
    await screen.findByText("Rendered first");
    expect(importRenderer).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(1);
    const instance = instances[0];
    view.unmount();
    window.dispatchEvent(new Event("resize"));
    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(instance.dispose).toHaveBeenCalled();
    expect(instance.clear).toHaveBeenCalled();
    expect(instance.container.childNodes).toHaveLength(0);
  });
});

const linkedXml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;

function rectangle(top: number, bottom: number) {
  return { top, bottom, left: 0, right: 400, width: 400, height: bottom - top } as DOMRect;
}

describe("synchronized reading score", () => {
  it("shows a source-linked cursor, updates without reloading, and leaves follow off", async () => {
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} playbackTime={0} playing />);
    const follow = await screen.findByRole("checkbox", { name: "Follow score while playing" }) as HTMLInputElement;
    expect(follow.checked).toBe(false);
    const instance = instances[0];
    expect(instance.options).toMatchObject({ disableCursor: false, followCursor: false });
    expect(instance.cursor.index).toBe(0);
    expect(instance.cursor.show).toHaveBeenCalledTimes(1);
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={.5} playing />);
    expect(instance.cursor.index).toBe(1);
    expect(instance.cursor.show).toHaveBeenCalledTimes(2);
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={.7} playing={false} />);
    expect(instance.cursor.show).toHaveBeenCalledTimes(2);
    expect(instance.load).toHaveBeenCalledTimes(1);
    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reading position: measure 1 of 1")).toBeTruthy();
  });

  it.each(["reference", "mismatched notes", "mismatched XML"])("does not claim a cursor for %s", async reason => {
    const { song } = parseMusicXml(linkedXml);
    if (reason === "reference") song.scoreOrigin = undefined;
    if (reason === "mismatched notes") song.notes[0].start += .1;
    if (reason === "mismatched XML") song.scoreXml += " ";
    render(<Score xml={linkedXml} sourceSong={song} playbackTime={1} />);
    await screen.findByText(/Playback cursor unavailable/);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(instances[0].cursor.show).not.toHaveBeenCalled();
    expect(instances[0].render).toHaveBeenCalledTimes(1);
  });

  it("limits opt-in scrolling to the pane and never scrolls on a paused seek", async () => {
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} playbackTime={0} playing={false} />);
    const follow = await screen.findByRole("checkbox");
    const viewport = view.container.querySelector(".score-sheet") as HTMLElement;
    viewport.getBoundingClientRect = () => rectangle(0, 400);
    instances[0].cursor.cursorElement.getBoundingClientRect = () => ({ ...rectangle(500, 600), left: 50, right: 70 });
    fireEvent.click(follow);
    expect(viewport.scrollTop).toBe(0);
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={.5} playing={false} />);
    expect(viewport.scrollTop).toBe(0);
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={.5} playing />);
    expect(viewport.scrollTop).toBe(224);
    viewport.scrollTop = 0;
    fireEvent.click(follow);
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={1} playing />);
    expect(viewport.scrollTop).toBe(0);
  });

  it("keeps the new cursor alive after an obsolete load completes", async () => {
    const oldLoad = deferred<void>();
    load.mockReturnValueOnce(oldLoad.promise);
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const nextXml = linkedXml.replace('<step>D</step>', '<step>E</step>');
    const nextSong = parseMusicXml(nextXml).song;
    view.rerender(<Score xml={nextXml} sourceSong={nextSong} playbackTime={1} playing />);
    await screen.findByRole("checkbox");
    const next = instances[1];
    const hides = next.cursor.hide.mock.calls.length;
    await act(async () => { oldLoad.resolve(); });
    expect(next.cursor.hide).toHaveBeenCalledTimes(hides);
    view.rerender(<Score xml={nextXml} sourceSong={nextSong} playbackTime={.5} playing />);
    expect(next.cursor.index).toBe(1);
    expect(next.cursor.show).toHaveBeenCalledTimes(2);
  });

  it("removes correspondence when playback changes and releases on unmount", async () => {
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} />);
    await screen.findByRole("checkbox");
    const cursor = instances[0].cursor;
    const hides = cursor.hide.mock.calls.length;
    view.rerender(<Score xml={linkedXml} sourceSong={{ ...song, notes: song.notes.slice(1) }} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(cursor.hide.mock.calls.length).toBeGreaterThan(hides);
    expect(screen.getByText(/Playback cursor unavailable/)).toBeTruthy();
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={1} />);
    await screen.findByRole("checkbox");
    const cleanupHides = cursor.hide.mock.calls.length;
    view.unmount();
    expect(cursor.hide.mock.calls.length).toBeGreaterThan(cleanupHides);
    expect(instances[0].dispose).toHaveBeenCalled();
  });

  it("rebinds a replaced cursor after resize without scrolling the page", async () => {
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} playbackTime={1} playing />);
    await screen.findByRole("checkbox");
    const oldCursor = instances[0].cursor;
    expect(oldCursor.index).toBe(2);
    const viewport = view.container.querySelector(".score-sheet") as HTMLElement;
    viewport.scrollTop = 123;
    viewport.scrollLeft = 45;
    draw.mockImplementationOnce(() => { viewport.scrollTop = 0; viewport.scrollLeft = 0; });
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(instances[0].render).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(instances[0].cursor.show).toHaveBeenCalledTimes(1));
    const current = instances[0].cursor;
    expect(current).not.toBe(oldCursor);
    expect(current.index).toBe(2);
    expect(viewport.scrollTop).toBe(123);
    expect(viewport.scrollLeft).toBe(45);
    expect(oldCursor.hide).toHaveBeenCalled();
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={.5} playing />);
    expect(current.index).toBe(1);
    expect(current.show).toHaveBeenCalledTimes(2);
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it.each(["replace", "unmount"])("cancels a pending resize on %s", async action => {
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} />);
    await screen.findByRole("checkbox");
    window.dispatchEvent(new Event("resize"));
    if (action === "unmount") view.unmount();
    else {
      const nextXml = linkedXml.replace('<step>D</step>', '<step>E</step>');
      view.rerender(<Score xml={nextXml} sourceSong={parseMusicXml(nextXml).song} />);
      await screen.findByRole("checkbox");
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(instances[0].render).toHaveBeenCalledTimes(1);
  });

  it("observes width changes without rerendering for height-only changes", async () => {
    let resized!: ResizeObserverCallback;
    const disconnect = vi.fn(), observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} playbackTime={1} />);
    await screen.findByRole("checkbox");
    expect(observe).toHaveBeenCalledWith(instances[0].container);
    const trigger = (width: number) => resized([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    trigger(500);
    await waitFor(() => expect(instances[0].render).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(instances[0].cursor.index).toBe(2));
    trigger(500);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(instances[0].render).toHaveBeenCalledTimes(2);
    trigger(800);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(instances[0].render).toHaveBeenCalledTimes(2);
  });

  it("keeps playback and engraving available if a later cursor draw fails", async () => {
    const { song } = parseMusicXml(linkedXml);
    const view = render(<Score xml={linkedXml} sourceSong={song} />);
    await screen.findByRole("checkbox");
    instances[0].cursor.show.mockImplementationOnce(() => { throw new Error("drawing failed"); });
    view.rerender(<Score xml={linkedXml} sourceSong={song} playbackTime={1} playing />);
    expect(screen.getByText(/Playback cursor unavailable/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(instances[0].container.isConnected).toBe(true);
    expect(instances[0].render).toHaveBeenCalledTimes(1);
  });

  it("keeps engraving available if cursor indexing fails", async () => {
    const { song } = parseMusicXml(linkedXml);
    const next = vi.spyOn(FakeCursor.prototype, "Iterator", "get").mockImplementation(() => { throw new Error("bad iterator"); });
    render(<Score xml={linkedXml} sourceSong={song} />);
    await screen.findByText(/Playback cursor unavailable/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(instances[0].container.isConnected).toBe(true);
    next.mockRestore();
  });
});
