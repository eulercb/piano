// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeferredStudioNoteAuthoring } from "./DeferredStudioNoteAuthoring";
import { loadedStudioAuthoring, loadStudioAuthoring } from "./preparationModules";
import { demoSong, type Song } from "./music";

vi.mock("./preparationModules", () => ({ loadedStudioAuthoring: vi.fn(), loadStudioAuthoring: vi.fn() }));
type Module = Awaited<ReturnType<typeof loadStudioAuthoring>>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function Editor({ song }: { song: Song }) {
  const [draft, setDraft] = useState("");
  return <><h3>{song.title}</h3><label>Unapplied draft<input value={draft} onChange={event => setDraft(event.target.value)} /></label></>;
}
const module: Module = { StudioNoteAuthoring: Editor };
const props = { song: demoSong, onChange: vi.fn() };
beforeEach(() => { vi.mocked(loadedStudioAuthoring).mockReset(); vi.mocked(loadStudioAuthoring).mockReset(); props.onChange.mockReset(); });
afterEach(cleanup);

it("shows an accessible loading state and renders the latest props without changing the piece or stealing focus", async () => {
  const pending = deferred<Module>();
  vi.mocked(loadStudioAuthoring).mockReturnValue(pending.promise);
  const view = render(<><button>Elsewhere</button><DeferredStudioNoteAuthoring {...props} /></>);
  expect(screen.getByRole("status").textContent).toMatch(/Loading note authoring/);
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" }); elsewhere.focus();
  view.rerender(<><button>Elsewhere</button><DeferredStudioNoteAuthoring {...props} song={{ ...demoSong, title: "Newer piece" }} /></>);
  await act(async () => pending.resolve(module));
  expect(screen.getByRole("heading", { name: "Newer piece" })).toBeTruthy();
  expect(document.activeElement).toBe(elsewhere);
  expect(props.onChange).not.toHaveBeenCalled();
  expect(loadStudioAuthoring).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "unfinished timing" } });
  view.rerender(<><button>Elsewhere</button><DeferredStudioNoteAuthoring {...props} song={{ ...demoSong, title: "Renamed piece" }} /></>);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("unfinished timing");
  expect(loadStudioAuthoring).toHaveBeenCalledTimes(1);
});

it("retries failed loading without resetting parent data and retains keyboard focus when retry succeeds", async () => {
  const pending = deferred<Module>();
  vi.mocked(loadStudioAuthoring).mockRejectedValueOnce(Error("Chunk unavailable")).mockReturnValueOnce(pending.promise);
  render(<DeferredStudioNoteAuthoring {...props} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/piece is unchanged/);
  const retry = screen.getByRole("button", { name: "Retry note authoring" }); retry.focus(); fireEvent.click(retry);
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  expect(loadStudioAuthoring).toHaveBeenCalledTimes(2);
  fireEvent.click(retry); expect(loadStudioAuthoring).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(module));
  expect(screen.getByRole("heading", { name: demoSong.title })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("region", { name: "Note authoring tools" }));
  expect(props.onChange).not.toHaveBeenCalled();
});

it("does not pull focus back after the user leaves a pending retry", async () => {
  const pending = deferred<Module>();
  vi.mocked(loadStudioAuthoring).mockRejectedValueOnce(Error("Chunk unavailable")).mockReturnValueOnce(pending.promise);
  render(<><button>Elsewhere</button><DeferredStudioNoteAuthoring {...props} /></>);
  await screen.findByRole("alert");
  const retry = screen.getByRole("button", { name: "Retry note authoring" }); retry.focus(); fireEvent.click(retry);
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" }); elsewhere.focus();
  await act(async () => pending.resolve(module));
  expect(document.activeElement).toBe(elsewhere);
});

it("keeps retry available through repeated errors", async () => {
  vi.mocked(loadStudioAuthoring).mockRejectedValue(Error("Chunk unavailable"));
  render(<DeferredStudioNoteAuthoring {...props} />);
  for (let index = 1; index <= 3; index++) {
    await screen.findByRole("alert");
    expect(loadStudioAuthoring).toHaveBeenCalledTimes(index);
    fireEvent.click(screen.getByRole("button", { name: "Retry note authoring" }));
  }
  await screen.findByRole("alert");
  expect(loadStudioAuthoring).toHaveBeenCalledTimes(4);
});

it("ignores completion and failure from a departed page and uses only a newer mount", async () => {
  const stale = deferred<Module>(), current = deferred<Module>();
  vi.mocked(loadStudioAuthoring).mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
  const first = render(<DeferredStudioNoteAuthoring {...props} />); first.unmount();
  render(<DeferredStudioNoteAuthoring {...props} song={{ ...demoSong, title: "Current piece" }} />);
  await act(async () => stale.reject(Error("Old failed request")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
  await act(async () => current.resolve(module));
  expect(screen.getByRole("heading", { name: "Current piece" })).toBeTruthy();
  expect(props.onChange).not.toHaveBeenCalled();
});

it("reuses a successfully loaded module synchronously on re-entry", () => {
  vi.mocked(loadedStudioAuthoring).mockReturnValue(module);
  const first = render(<DeferredStudioNoteAuthoring {...props} />); first.unmount();
  render(<DeferredStudioNoteAuthoring {...props} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("heading", { name: demoSong.title })).toBeTruthy();
  expect(loadStudioAuthoring).not.toHaveBeenCalled();
});

it("ignores the cleaned-up Strict Mode load rather than showing its stale failure", async () => {
  const stale = deferred<Module>(), current = deferred<Module>();
  vi.mocked(loadStudioAuthoring).mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><DeferredStudioNoteAuthoring {...props} /></StrictMode>);
  await act(async () => current.resolve(module));
  await act(async () => stale.reject(Error("Stale Strict Mode request")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading", { name: demoSong.title })).toBeTruthy();
  expect(props.onChange).not.toHaveBeenCalled();
});
