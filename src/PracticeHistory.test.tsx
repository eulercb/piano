// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeHistory } from "./PracticeHistory";
import { exportPracticeHistory, HISTORY_KEY, PracticeHistoryStore, type PracticePass } from "./practiceHistory";

const sample = (id = "one"): PracticePass => ({
  id, pieceId: "piece", pieceTitle: "My private piece", pieceRevision: "v1-2-revision",
  startedAt: "2026-11-10T12:00:00.000Z", completedAt: "2026-11-10T12:01:00.000Z",
  mode: "melody", hand: "right", tempo: 120, speedMin: 50, speedMax: 50,
  startSeconds: 0, endSeconds: 10, noteCount: 12,
});
const timingPass = (): PracticePass => ({
  ...sample(), mode: "rhythm", hand: "both", noteCount: 4,
  rhythm: { total: 4, onTime: 2, early: 1, late: 0, missed: 1, extra: 3 },
  writtenHands: {
    left: { total: 2, onTime: 1, early: 1, late: 0, missed: 0 },
    right: { total: 2, onTime: 1, early: 0, late: 0, missed: 1 },
  },
});
function setup(passes: PracticePass[] = []) {
  if (passes.length) localStorage.setItem(HISTORY_KEY, exportPracticeHistory(passes));
  const store = new PracticeHistoryStore();
  render(<PracticeHistory store={store} />);
  return store;
}
function chooseBackup(text: string) {
  const file = new File([text], "practice-history.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Import practice history backup"), { target: { files: [file] } });
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("practice history controls", () => {
  it.each(["rhythm", "recital"] as const)("labels saved %s written parts accessibly while keeping extra presses global", (mode) => {
    setup([{ ...timingPass(), mode }]);
    const left = within(screen.getByRole("group", { name: "Written left part" }));
    const right = within(screen.getByRole("group", { name: "Written right part" }));
    expect(left.getByRole("heading", { name: "Written left part" })).toBeTruthy();
    expect(left.getByText("On time").nextElementSibling?.textContent).toBe("1 / 2");
    expect(left.getByText("Early").nextElementSibling?.textContent).toBe("1");
    expect(right.getByText("Missed").nextElementSibling?.textContent).toBe("1");
    expect(screen.getAllByText("Extra presses")).toHaveLength(1);
    expect(screen.getByText("Extra presses").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText(/not which physical hand played/)).toBeTruthy();
  });
  it("explains missing old breakdowns without inventing counts or changing single-hand summaries", () => {
    const timed = timingPass();
    setup([{ ...timed, writtenHands: undefined }, { ...timed, id: "single", hand: "right", writtenHands: undefined }]);
    expect(screen.getAllByText("Written-part breakdown was not saved for this pass.")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Written left part" })).toBeNull();
    expect(screen.getAllByText("Extra presses")).toHaveLength(2);
  });
  it("labels an empty written part without showing a misleading zero denominator", () => {
    const timed = timingPass();
    setup([{ ...timed, writtenHands: {
      left: { total: 0, onTime: 0, early: 0, late: 0, missed: 0 },
      right: { total: 4, onTime: 2, early: 1, late: 0, missed: 1 },
    } }]);
    expect(within(screen.getByRole("group", { name: "Written left part" })).getByText("No selected note starts in this written part.")).toBeTruthy();
    expect(screen.queryByText("0 / 0")).toBeNull();
  });
  it("restores written-part counts only after confirmation and rejects inconsistent replacements", async () => {
    const store = setup();
    chooseBackup(exportPracticeHistory([timingPass()]));
    const merge = await screen.findByRole("button", { name: "Merge backup" });
    expect(screen.queryByRole("group", { name: "Written left part" })).toBeNull();
    await act(async () => { fireEvent.click(merge); });
    expect(store.getSnapshot().passes).toEqual([timingPass()]);
    expect(screen.getByRole("group", { name: "Written left part" })).toBeTruthy();
    const saved = localStorage.getItem(HISTORY_KEY);
    chooseBackup(JSON.stringify({ kind: "piano-practice-history", version: 1, passes: [{
      ...timingPass(), writtenHands: { ...timingPass().writtenHands, left: { total: 2, onTime: 0, early: 2, late: 0, missed: 0 } },
    }] }));
    await screen.findByText(/must add up to the overall timing counts/);
    expect(screen.queryByRole("button", { name: "Merge backup" })).toBeNull();
    expect(localStorage.getItem(HISTORY_KEY)).toBe(saved);
  });
  it("shows the empty state, privacy and scoring limitations without negative pressure", () => {
    setup();
    expect(screen.getByText("Ready for your first pass.")).toBeTruthy();
    expect(screen.getByText(/Note-start feedback only/).textContent).toMatch(/fingering.*expression/);
    expect(screen.getByText(/No account or upload/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Export history" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("labels listening separately and shows partial passage and changing speed honestly", () => {
    setup([{ ...sample(), mode: "listen", startSeconds: 3, speedMax: 75 }]);
    expect(screen.getByText(/no performance score/)).toBeTruthy();
    expect(screen.getByText(/changed during pass/)).toBeTruthy();
    expect(screen.getByText(/From partway/)).toBeTruthy();
  });
  it("does not delete a pass until confirmed, and Cancel leaves saved data intact", async () => {
    const store = setup([sample()]);
    fireEvent.click(screen.getByRole("button", { name: /^Delete My private piece/ }));
    expect(store.getSnapshot().passes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
    expect(screen.queryByRole("group", { name: "Confirm history deletion" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Delete My private piece/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete pass" })); });
    expect(store.getSnapshot().passes).toHaveLength(0);
    expect(screen.getByText("Ready for your first pass.")).toBeTruthy();
  });
  it("requires clear confirmation and does not touch song storage or backups", async () => {
    localStorage.setItem("piano-songs", "keep songs");
    const store = setup([sample()]);
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(store.getSnapshot().passes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
    expect(store.getSnapshot().passes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, clear history" })); });
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem("piano-songs")).toBe("keep songs");
  });
  it("stages valid imports for confirmation, supports Cancel, and deduplicates repeated imports", async () => {
    const store = setup([sample()]);
    const backup = exportPracticeHistory([sample(), sample("two")]);
    chooseBackup(backup);
    await screen.findByRole("button", { name: "Merge backup" });
    expect(store.getSnapshot().passes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(store.getSnapshot().passes).toHaveLength(1);
    chooseBackup(backup);
    const merge = await screen.findByRole("button", { name: "Merge backup" });
    await act(async () => { fireEvent.click(merge); });
    expect(store.getSnapshot().passes).toHaveLength(2);
    chooseBackup(backup);
    const mergeAgain = await screen.findByRole("button", { name: "Merge backup" });
    await act(async () => { fireEvent.click(mergeAgain); });
    expect(store.getSnapshot().passes).toHaveLength(2);
  });
  it("rejects malformed imports without touching existing history", async () => {
    const store = setup([sample()]);
    chooseBackup("{ invalid");
    await screen.findByText(/file is not valid JSON/);
    expect(store.getSnapshot().passes).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Merge backup" })).toBeNull();
  });
  it("does not resurrect a slow import after Clear cancels it", async () => {
    setup([sample()]);
    let resolve!: (value: string) => void;
    const file = new File([], "history.json");
    Object.defineProperty(file, "text", { value: () => new Promise<string>((yes) => { resolve = yes; }) });
    fireEvent.change(screen.getByLabelText("Import practice history backup"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    resolve(exportPracticeHistory([sample("two")]));
    await waitFor(() => expect(screen.queryByText(/Reading backup/)).toBeNull());
    expect(screen.queryByRole("button", { name: "Merge backup" })).toBeNull();
    expect(screen.getByRole("button", { name: "Yes, clear history" })).toBeTruthy();
  });
  it("can clear corrupt history only with confirmation, and surfaces failed persistence", async () => {
    localStorage.setItem(HISTORY_KEY, "broken");
    setup();
    expect(screen.getByText(/has not been overwritten/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(localStorage.getItem(HISTORY_KEY)).toBe("broken");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw Error("denied"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, clear history" })); });
    expect(screen.getByText(/could not be cleared/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, clear history" })).toBeTruthy();
  });
  it("exports a summary-only JSON download and revokes its object URL", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:local");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setup([sample()]);
    fireEvent.click(screen.getByRole("button", { name: "Export history" }));
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/not scores/)).toBeTruthy();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:local");
    vi.useRealTimers();
  });
  it("refreshes an open history view after another tab clears it", async () => {
    const store = setup([sample()]);
    const stop = store.listen();
    const anotherTab = new PracticeHistoryStore();
    await act(async () => {
      await anotherTab.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: HISTORY_KEY, newValue: null }));
    });
    expect(screen.getByText("Ready for your first pass.")).toBeTruthy();
    expect(store.getSnapshot().passes).toHaveLength(0);
    stop();
  });
  it("pages older passes rather than rendering an unbounded list", () => {
    setup(Array.from({ length: 12 }, (_, i) => sample(String(i))));
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show older passes" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });
});
