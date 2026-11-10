// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Score } from "./Score";
import { loadScoreRenderer } from "./scoreRenderer";

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

class FakeRenderer {
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
afterEach(cleanup);

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
    expect(instances[0].render).toHaveBeenCalledTimes(2);
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
    expect(instances[1].render).toHaveBeenCalledTimes(2);
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
