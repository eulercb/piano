// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PracticeBookmarks } from "./PracticeBookmarks";
import { exportBookmarks, PracticeBookmarksStore, type PracticeBookmark } from "./practiceBookmarks";
const bookmark: PracticeBookmark = { id: "one", name: "Retained practice", songId: "song", title: "Saved piece", revision: "a".repeat(64), hand: "both", mode: "melody", speed: 50, countIn: true, repeat: false };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["corrupt", "unavailable"])("review: exports validated retained bookmarks after storage becomes %s without enabling writes", async failure => {
  let source = exportBookmarks([bookmark]), unavailable = false;
  const write = vi.fn();
  const store = new PracticeBookmarksStore(() => ({ getItem: () => {
    if (unavailable) throw Error("Storage unavailable");
    return source;
  }, setItem: write }));
  render(<PracticeBookmarks store={store} onRestore={vi.fn()} onSave={vi.fn()} canSave />);
  source = "damaged bytes"; unavailable = failure === "unavailable";
  act(() => store.refresh());
  expect(screen.getByText(/Saved bytes have not been overwritten/)).toBeTruthy();
  for (const name of ["Open Retained practice", "Delete Retained practice", "Save practice bookmark"])
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Import bookmark backup") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Export bookmarks" }) as HTMLButtonElement).disabled).toBe(false);
  const create = vi.fn((_blob: Blob) => "blob:retained"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Export bookmarks" }));
  expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
  vi.runOnlyPendingTimers(); expect(revoke).toHaveBeenCalledWith("blob:retained");
  vi.useRealTimers();
  const blob = create.mock.calls[0][0] as Blob;
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
  });
  expect(text).toBe(exportBookmarks([bookmark]));
  expect(write).not.toHaveBeenCalled(); expect(source).toBe("damaged bytes");
});

it("review: keeps export disabled when corrupt storage has no validated snapshot", () => {
  const store = new PracticeBookmarksStore(() => ({ getItem: () => "bad", setItem: vi.fn() }));
  render(<PracticeBookmarks store={store} onRestore={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Export bookmarks" }) as HTMLButtonElement).disabled).toBe(true);
});
