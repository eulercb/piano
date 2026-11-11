import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "./music";
import { PracticeSession, type PracticeMode } from "./session";
import {
  exportPracticeHistory, HISTORY_KEY, MAX_HISTORY_BYTES, MAX_HISTORY_PASSES, mergePracticeHistory,
  normalizePracticePass, parsePracticeHistory, practicePieceRevision, PracticeHistoryStore,
  PracticePassRecorder, practiceSuggestion, type PracticePass,
} from "./practiceHistory";

beforeEach(() => vi.stubGlobal("navigator", {}));
afterEach(() => vi.unstubAllGlobals());

const song: Song = { id: "song", title: "A private piece", tempo: 120, notes: [
  { id: "a", pitch: 60, start: 0, duration: 0.2, hand: "right", velocity: 0.7 },
  { id: "b", pitch: 62, start: 0.2, duration: 0.2, hand: "right", velocity: 0.7 },
] };
const date = "2026-11-10T12:00:00.000Z";
const pass = (id = "pass"): PracticePass => ({
  id, pieceId: "song", pieceTitle: "A private piece", pieceRevision: "revision", startedAt: date, completedAt: date,
  mode: "rhythm", hand: "right", tempo: 120, speedMin: 50, speedMax: 50,
  startSeconds: 0, endSeconds: 0.4, noteCount: 2,
  rhythm: { total: 2, onTime: 2, early: 0, late: 0, missed: 0, extra: 0 },
});
function transport(mode: PracticeMode, countIn = false) {
  const session = new PracticeSession({ notes: song.notes, duration: 0.4, tempo: 120, mode, hand: "right", countIn });
  let id = 0;
  const recorder = new PracticePassRecorder(session, song, () => date, () => `pass-${++id}`);
  return { session, recorder };
}
function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
  };
}

const writtenSong: Song = { id: "written-parts", title: "Synthetic written parts", tempo: 120, duration: 1.5, notes: [
  { id: "left-unison", pitch: 72, start: 0, duration: 0.1, hand: "left", velocity: 0.7 },
  { id: "right-unison", pitch: 72, start: 0, duration: 0.1, hand: "right", velocity: 0.7 },
  { id: "right-early", pitch: 48, start: 0.5, duration: 0.1, hand: "right", velocity: 0.7 },
  { id: "left-late", pitch: 52, start: 0.7, duration: 0.1, hand: "left", velocity: 0.7 },
  { id: "right-missed", pitch: 67, start: 1, duration: 0.1, hand: "right", velocity: 0.7 },
] };
const writtenPass = (): PracticePass => ({
  ...pass(), hand: "both", noteCount: 5,
  rhythm: { total: 5, onTime: 2, early: 1, late: 1, missed: 1, extra: 1 },
  writtenHands: {
    left: { total: 2, onTime: 1, early: 0, late: 1, missed: 0 },
    right: { total: 3, onTime: 1, early: 1, late: 0, missed: 1 },
  },
});

describe("completed written-part recording", () => {
  it.each(["rhythm", "recital"] as const)("records %s by saved assignments, including crossed pitches and doubled unisons", (mode) => {
    const session = new PracticeSession({ notes: writtenSong.notes, duration: 1.5, tempo: 120, mode, hand: "both", countIn: false });
    const recorder = new PracticePassRecorder(session, writtenSong, () => date, () => "written");
    session.start(); recorder.advanceFrame(0, 100, false);
    session.press(72, 100); session.press(99, 100);
    recorder.advanceFrame(0.2, 100, false); recorder.advanceFrame(0.1, 100, false);
    session.press(48, 100);
    for (let i = 0; i < 3; i++) recorder.advanceFrame(0.2, 100, false);
    session.press(52, 100);
    expect(session.writtenHands).toBeUndefined();
    if (mode === "recital") expect(session.grades.size).toBe(0);
    session.pause();
    expect(recorder.advanceFrame(30, 100, false).completedPass).toBeUndefined();
    session.start();
    expect(recorder.advanceFrame(2, 100, false).interrupted).toBe(true);
    expect(session.writtenHands).toBeUndefined();
    session.start();
    recorder.advanceFrame(0.2, 100, false); recorder.advanceFrame(0.2, 100, false);
    const completed = recorder.advanceFrame(0.21, 100, false).completedPass;
    expect(completed?.rhythm).toEqual(writtenPass().rhythm);
    expect(completed?.writtenHands).toEqual(writtenPass().writtenHands);
    expect(parsePracticeHistory(exportPracticeHistory([completed!]))).toEqual([completed]);
    expect(recorder.advanceFrame(0.1, 100, false).completedPass).toBeUndefined();
    session.restart(); recorder.reset();
    expect(session.writtenHands).toBeUndefined();
    expect(session.previousWrittenHands).toBeUndefined();
  });

  it.each(["rhythm", "recital"] as const)("captures %s loop counts before resetting and excludes earlier notes after seek", (mode) => {
    const session = new PracticeSession({ notes: writtenSong.notes, duration: 1.5, tempo: 120, mode, hand: "both", countIn: false });
    let id = 0;
    const recorder = new PracticePassRecorder(session, writtenSong, () => date, () => `loop-${++id}`);
    session.start(); recorder.advanceFrame(0, 100, true); session.press(72, 100);
    session.restart(0.5); recorder.reset(); session.start();
    recorder.advanceFrame(0, 100, true); session.press(48, 100);
    for (let i = 0; i < 3; i++) recorder.advanceFrame(0.25, 100, true);
    const first = recorder.advanceFrame(0.25, 100, true).completedPass!;
    expect(first).toMatchObject({ startSeconds: 0.5, noteCount: 3, writtenHands: {
      left: { total: 1, onTime: 0, early: 0, late: 0, missed: 1 },
      right: { total: 2, onTime: 1, early: 0, late: 0, missed: 1 },
    } });
    expect(session.writtenHands).toBeUndefined();
    expect(session.previousWrittenHands).toEqual(first.writtenHands);
    expect(session.grades.size).toBe(0);
    for (let i = 0; i < 5; i++) recorder.advanceFrame(0.25, 100, true);
    const second = recorder.advanceFrame(0.25, 100, true).completedPass!;
    expect(second).toMatchObject({ startSeconds: 0, noteCount: 5, writtenHands: {
      left: { total: 2, onTime: 0, early: 0, late: 0, missed: 2 },
      right: { total: 3, onTime: 0, early: 0, late: 0, missed: 3 },
    } });
    expect(second.id).not.toBe(first.id);
    expect(first.writtenHands?.right.onTime).toBe(1);
    expect(session.previousWrittenHands).toEqual(second.writtenHands);
    session.restart(1.1); recorder.reset(); session.start();
    recorder.advanceFrame(0.2, 100, false);
    expect(recorder.advanceFrame(0.2, 100, false).completedPass).toBeUndefined();
    expect(session.previousWrittenHands).toBeUndefined();
  });

  it.each(["rhythm", "recital"] as const)("keeps %s single-hand counts unchanged and records an empty written part honestly", (mode) => {
    for (const hand of ["right", "both"] as const) {
      const session = new PracticeSession({ notes: song.notes, duration: 0.6, tempo: 120, mode, hand, countIn: false });
      const recorder = new PracticePassRecorder(session, song, () => date, () => hand);
      session.start();
      recorder.advanceFrame(0.2, 100, false); recorder.advanceFrame(0.2, 100, false);
      const completed = recorder.advanceFrame(0.2, 100, false).completedPass!;
      expect(completed.rhythm).toEqual({ total: 2, onTime: 0, early: 0, late: 0, missed: 2, extra: 0 });
      if (hand === "right") expect(completed.writtenHands).toBeUndefined();
      else expect(completed.writtenHands).toEqual({
        left: { total: 0, onTime: 0, early: 0, late: 0, missed: 0 },
        right: { total: 2, onTime: 0, early: 0, late: 0, missed: 2 },
      });
    }
  });
});

describe("completed-pass recording", () => {
  it("records one listening pass, without inventing performance counts, and never repeats a completion", () => {
    const { session, recorder } = transport("listen");
    session.start();
    expect(recorder.advanceFrame(0.2, 100, false).completedPass).toBeUndefined();
    const result = recorder.advanceFrame(0.2, 100, false);
    expect(result.completedPass).toMatchObject({ mode: "listen", noteCount: 2, startSeconds: 0, endSeconds: 0.4 });
    expect(result.completedPass?.rhythm).toBeUndefined();
    expect(recorder.advanceFrame(0.2, 100, false).completedPass).toBeUndefined();
    session.start();
    recorder.advanceFrame(0.2, 100, false);
    expect(recorder.advanceFrame(0.2, 100, false).completedPass?.id).toBe("pass-2");
  });
  it("does not record during count-in or melody waits; completion requires all selected note starts", () => {
    const { session, recorder } = transport("melody", true);
    session.start();
    for (let i = 0; i < 8; i++) expect(recorder.advanceFrame(0.25, 100, false).completedPass).toBeUndefined();
    expect(recorder.advanceFrame(0.2, 100, false).completedPass).toBeUndefined();
    session.press(61, 100);
    expect(recorder.advanceFrame(0.2, 100, false).completedPass).toBeUndefined();
    session.press(60, 100);
    recorder.advanceFrame(0.2, 100, false);
    session.press(62, 100);
    const completed = recorder.advanceFrame(0.2, 100, false).completedPass;
    expect(completed?.mode).toBe("melody");
    expect(completed?.noteCount).toBe(2);
    expect(completed?.rhythm).toBeUndefined();
  });
  it("retains timing summary before a repeated pass resets, with a distinct record per loop", () => {
    const { session, recorder } = transport("rhythm");
    session.start();
    recorder.advanceFrame(0, 100, true);
    session.press(60, 100);
    recorder.advanceFrame(0.2, 100, true);
    session.press(62, 100);
    recorder.advanceFrame(0.2, 100, true);
    const first = recorder.advanceFrame(0.11, 100, true).completedPass;
    expect(first?.rhythm).toEqual({ total: 2, onTime: 2, early: 0, late: 0, missed: 0, extra: 0 });
    expect(session.pass).toBe(2);
    recorder.advanceFrame(0.25, 100, true);
    recorder.advanceFrame(0.25, 100, true);
    const second = recorder.advanceFrame(0.01, 100, true).completedPass;
    expect(second?.rhythm?.missed).toBe(2);
    expect(second?.id).not.toBe(first?.id);
  });
  it("preserves pauses and interruptions without counting them as completed or as musical errors", () => {
    const { session, recorder } = transport("listen");
    session.start();
    recorder.advanceFrame(0.1, 100, false);
    session.pause();
    expect(recorder.advanceFrame(100, 100, false).completedPass).toBeUndefined();
    session.start();
    expect(recorder.advanceFrame(2, 100, false).interrupted).toBe(true);
    expect(session.position).toBe(0.1);
    session.start();
    recorder.advanceFrame(0.2, 100, false);
    expect(recorder.advanceFrame(0.1, 100, false).completedPass?.startSeconds).toBe(0);
  });
  it("discards restart/seek attempts and labels a completion from partway through", () => {
    const { session, recorder } = transport("listen");
    session.start(); recorder.advanceFrame(0.1, 100, false);
    session.restart(0.2); recorder.reset(); session.start();
    const result = recorder.advanceFrame(0.2, 100, false).completedPass;
    expect(result).toMatchObject({ startSeconds: 0.2, noteCount: 1 });
  });
  it("does not record a seek beyond the last selected onset as a fresh achievement", () => {
    const { session, recorder } = transport("listen");
    session.restart(0.3); recorder.reset(); session.start();
    expect(recorder.advanceFrame(0.2, 100, false).completedPass).toBeUndefined();
  });
  it("records the speed range, rather than mislabelling a changing-tempo pass", () => {
    const { session, recorder } = transport("listen");
    session.start(); recorder.advanceFrame(0.2, 50, false);
    recorder.advanceFrame(0.2, 100, false);
    expect(recorder.advanceFrame(0.2, 75, false).completedPass).toMatchObject({ speedMin: 50, speedMax: 100 });
  });
  it.each([
    { title: "x".repeat(510) }, { tempo: 20000 }, { id: "   " },
  ])("isolates unsupported live piece metadata from playback: %j", (patch) => {
    const { session } = transport("listen");
    const recorder = new PracticePassRecorder(session, { ...song, ...patch }, () => date, () => "test");
    session.start(); recorder.advanceFrame(0.2, 100, false);
    const result = recorder.advanceFrame(0.2, 100, false);
    expect(session.completed).toBe(true);
    expect(result.completedPass).toBeUndefined();
    expect(result.historyError).toMatch(/Playing is still available/);
    expect(recorder.advanceFrame(0.2, 100, false).historyError).toBeUndefined();
  });
  it("a changed score gets a distinct comparison marker, without storing notes or score content", () => {
    const revision = practicePieceRevision(song);
    expect(practicePieceRevision({ ...song, scoreXml: "private notation" })).toBe(revision);
    expect(practicePieceRevision({ ...song, notes: song.notes.map((n) => ({ ...n, pitch: n.pitch + 1 })) })).not.toBe(revision);
    expect(practicePieceRevision({ ...song, tempo: 80 })).not.toBe(revision);
  });
});

describe("bounded backup validation", () => {
  it.each(["rhythm", "recital"] as const)("round trips optional %s written-part counts and preserves old backups without inventing them", (mode) => {
    const current = { ...writtenPass(), mode };
    const legacy = { ...current, id: "legacy", writtenHands: undefined };
    const restored = parsePracticeHistory(exportPracticeHistory([current, legacy]));
    expect(restored.find((item) => item.id === current.id)).toEqual(current);
    expect(restored.find((item) => item.id === "legacy")).not.toHaveProperty("writtenHands");
    const memory = storage(exportPracticeHistory(restored));
    expect(new PracticeHistoryStore(() => memory).getSnapshot().passes).toEqual(restored);
  });
  it.each([
    null, [], {}, { left: {} }, { left: null, right: {} },
    { ...writtenPass().writtenHands, extra: 1 },
    { ...writtenPass().writtenHands, left: { ...writtenPass().writtenHands!.left, extra: 0 } },
    { ...writtenPass().writtenHands, left: { ...writtenPass().writtenHands!.left, total: -1 } },
    { ...writtenPass().writtenHands, left: { ...writtenPass().writtenHands!.left, onTime: 0.5 } },
    { ...writtenPass().writtenHands, left: { ...writtenPass().writtenHands!.left, late: "1" } },
    { ...writtenPass().writtenHands, left: { ...writtenPass().writtenHands!.left, missed: null } },
    { ...writtenPass().writtenHands, left: { ...writtenPass().writtenHands!.left, total: Number.MAX_SAFE_INTEGER + 1 } },
    // Each part is complete, but the distribution no longer matches the aggregate.
    { ...writtenPass().writtenHands, left: { total: 2, onTime: 0, early: 0, late: 2, missed: 0 } },
    { ...writtenPass().writtenHands, left: { total: 1, onTime: 0, early: 0, late: 1, missed: 0 } },
  ])("rejects invalid or mismatched written-part backup data: %j", (writtenHands) => {
    const source = JSON.stringify({ kind: "piano-practice-history", version: 1, passes: [{ ...writtenPass(), writtenHands }] });
    expect(() => parsePracticeHistory(source)).toThrow(/Invalid practice history/);
  });
  it.each([
    { hand: "left" }, { hand: "right" }, { mode: "listen", rhythm: undefined }, { mode: "melody", rhythm: undefined },
  ])("rejects written-part counts outside both-hand timing passes: %j", (patch) => {
    expect(() => normalizePracticePass({ ...writtenPass(), ...patch })).toThrow(/only both-hand/);
  });
  it("round trips summaries while stripping arbitrary and score-bearing data", () => {
    const source = JSON.stringify({ kind: "piano-practice-history", version: 1, passes: [{ ...pass(), scoreXml: "private score", notes: song.notes, rhythm: { ...pass().rhythm, secret: "no" } }] });
    const parsed = parsePracticeHistory(source);
    expect(parsed).toEqual([pass()]);
    expect(exportPracticeHistory(parsed)).not.toContain("private score");
    expect(parsePracticeHistory(exportPracticeHistory(parsed))).toEqual(parsed);
  });
  it.each([
    { mode: "exam" }, { hand: "other" }, { speedMin: NaN }, { speedMax: 10 }, { tempo: 0 },
    { noteCount: 0 }, { noteCount: 1.5 }, { startSeconds: 1 }, { endSeconds: Infinity },
    { startedAt: "tomorrow" }, { completedAt: "2026-11-09T12:00:00.000Z" },
    { completedAt: "2026-02-30T12:00:00.000Z" }, { pieceTitle: "x".repeat(501) },
    { rhythm: { total: 2, onTime: 1, early: 0, late: 0, missed: 0, extra: 0 } },
    { rhythm: { total: 2, onTime: 2, early: 0, late: 0, missed: 0, extra: -1 } },
    { mode: "melody" },
  ])("rejects invalid pass metadata or unfinished rhythm counts: %j", (patch) => {
    expect(() => normalizePracticePass({ ...pass(), ...patch })).toThrow(/Invalid practice history/);
  });
  it("rejects unknown versions, malformed/oversized input, excessive records, and duplicate IDs", () => {
    expect(() => parsePracticeHistory("not JSON")).toThrow(/JSON/);
    expect(() => parsePracticeHistory(JSON.stringify({ kind: "piano-practice-history", version: 2, passes: [] }))).toThrow(/version/);
    expect(() => parsePracticeHistory(" ".repeat(MAX_HISTORY_BYTES + 1))).toThrow(/1 MiB/);
    expect(() => exportPracticeHistory(Array.from({ length: MAX_HISTORY_PASSES + 1 }, (_, i) => pass(`p-${i}`)))).toThrow(/at most/);
    expect(() => exportPracticeHistory([pass(), pass()])).toThrow(/duplicate/);
  });
  it("deduplicates identical backups and refuses conflicting history instead of replacing it", () => {
    expect(mergePracticeHistory([pass()], [pass()])).toEqual([pass()]);
    expect(() => mergePracticeHistory([pass()], [{ ...pass(), pieceTitle: "changed" }])).toThrow(/conflicts/);
  });
  it("keeps newest records within the bound", () => {
    const older = Array.from({ length: 200 }, (_, i) => ({ ...pass(`old-${i}`), completedAt: `2026-11-09T12:00:00.${String(i).padStart(3, "0")}Z`, startedAt: "2026-11-09T12:00:00.000Z" }));
    const combined = mergePracticeHistory(older, [pass("new")]);
    expect(combined).toHaveLength(200);
    expect(combined[0].id).toBe("new");
    expect(combined.some((item) => item.id === "old-0")).toBe(false);
  });
});

describe("local storage failure safety", () => {
  it("saves and reloads completed passes and notifies subscribers", () => {
    const memory = storage(); const store = new PracticeHistoryStore(() => memory); const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.append(pass());
    expect(memory.setItem).toHaveBeenCalledWith(HISTORY_KEY, expect.any(String));
    expect(new PracticeHistoryStore(() => memory).getSnapshot().passes).toEqual([pass()]);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe(); store.append(pass("two")); expect(changed).toHaveBeenCalledTimes(1);
  });
  it.each(["{broken", '{"version":99}'])("preserves unreadable storage %s until an explicit clear", (initial) => {
    const memory = storage(initial); const store = new PracticeHistoryStore(() => memory);
    store.append(pass());
    expect(memory.setItem).not.toHaveBeenCalled();
    expect(memory.getItem()).toBe(initial);
    expect(store.getSnapshot()).toMatchObject({ temporary: true, blocked: true, passes: [pass()] });
    expect(store.restore([pass("backup")])).toBe(false);
    expect(store.clear()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ blocked: false, temporary: false, passes: [] });
    store.append(pass("new")); expect(memory.setItem).toHaveBeenCalledTimes(1);
  });
  it("keeps quota-failed completions in memory for export without crashing playback", () => {
    const memory = storage(exportPracticeHistory([pass("old")]));
    memory.setItem.mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    const store = new PracticeHistoryStore(() => memory);
    store.append(pass("new"));
    expect(store.getSnapshot().passes).toHaveLength(2);
    expect(store.getSnapshot().temporary).toBe(true);
    expect(parsePracticeHistory(exportPracticeHistory(store.getSnapshot().passes))).toHaveLength(2);
    expect(new PracticeHistoryStore(() => memory).getSnapshot().passes).toHaveLength(1);
  });
  it("does not pretend a failed delete, clear, or import succeeded", () => {
    const memory = storage(exportPracticeHistory([pass()])); const store = new PracticeHistoryStore(() => memory);
    memory.setItem.mockImplementation(() => { throw Error("no storage"); });
    memory.removeItem.mockImplementation(() => { throw Error("no storage"); });
    expect(store.remove("pass")).toBe(false);
    expect(store.clear()).toBe(false);
    expect(store.restore([pass("backup")])).toBe(false);
    expect(store.getSnapshot().passes).toEqual([pass()]);
  });
  it("handles localStorage getters denied by browser privacy settings", () => {
    const store = new PracticeHistoryStore(() => { throw new DOMException("denied", "SecurityError"); });
    expect(() => store.append(pass())).not.toThrow();
    expect(store.getSnapshot().temporary).toBe(true);
    expect(store.clear()).toBe(false);
  });
  it("reconciles stale tabs without losing newer passes or resurrecting deleted/cleared history", () => {
    const memory = storage();
    const first = new PracticeHistoryStore(() => memory);
    const second = new PracticeHistoryStore(() => memory);
    first.append(pass("first")); second.append(pass("second"));
    expect(parsePracticeHistory(memory.getItem()!).map((p) => p.id).sort()).toEqual(["first", "second"]);
    first.remove("second"); second.append(pass("third"));
    expect(parsePracticeHistory(memory.getItem()!).map((p) => p.id).sort()).toEqual(["first", "third"]);
    first.clear(); second.append(pass("fourth"));
    expect(parsePracticeHistory(memory.getItem()!).map((p) => p.id)).toEqual(["fourth"]);
  });
  it("merges imports with current storage rather than overwriting another tab's records", () => {
    const memory = storage(); const first = new PracticeHistoryStore(() => memory); const second = new PracticeHistoryStore(() => memory);
    first.append(pass("first")); second.restore([pass("backup")]);
    expect(parsePracticeHistory(memory.getItem()!)).toHaveLength(2);
    first.remove("first"); second.remove("backup");
    expect(parsePracticeHistory(memory.getItem()!)).toHaveLength(0);
  });
  it("protects another tab's clear when local quota failures left unsaved passes", () => {
    const memory = storage(exportPracticeHistory([pass("old")]));
    const first = new PracticeHistoryStore(() => memory);
    const second = new PracticeHistoryStore(() => memory);
    const setter = memory.setItem.getMockImplementation()!;
    memory.setItem.mockImplementation(() => { throw Error("full"); });
    first.append(pass("unsaved"));
    second.clear();
    memory.setItem.mockImplementation(setter);
    first.append(pass("new"));
    expect(memory.getItem()).toBeNull();
    expect(first.getSnapshot()).toMatchObject({ blocked: true, temporary: true });
    expect(first.getSnapshot().message).toMatch(/Another tab changed history/);
    expect(first.getSnapshot().passes.map((p) => p.id).sort()).toEqual(["new", "unsaved"]);
  });
  it("serializes simultaneous writes through the browser's cross-tab Web Lock", async () => {
    let queue = Promise.resolve();
    const request = vi.fn((_name: string, task: () => unknown) => {
      const next = queue.then(task);
      queue = next.then(() => undefined);
      return next;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const memory = storage(); const first = new PracticeHistoryStore(() => memory); const second = new PracticeHistoryStore(() => memory);
    await Promise.all([first.append(pass("first")), second.append(pass("second"))]);
    expect(parsePracticeHistory(memory.getItem()!)).toHaveLength(2);
    await Promise.all([first.clear(), second.append(pass("third"))]);
    expect(parsePracticeHistory(memory.getItem()!).map((p) => p.id)).toEqual(["third"]);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.every(([name]) => name === "piano-practice-history-write")).toBe(true);
  });
  it("keeps a completion exportable if tab coordination fails", async () => {
    vi.stubGlobal("navigator", { locks: { request: () => Promise.reject(new Error("lock unavailable")) } });
    const memory = storage(); const store = new PracticeHistoryStore(() => memory);
    await store.append(pass());
    expect(memory.getItem()).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ passes: [pass()], temporary: true });
    expect(store.getSnapshot().message).toMatch(/Tab coordination/);
  });
  it("imports only after persistence succeeds, deduplicates, and clears only the history key", () => {
    const memory = storage(); const store = new PracticeHistoryStore(() => memory);
    store.append(pass()); expect(store.restore([pass(), pass("two")])).toBe(true);
    expect(store.getSnapshot().passes).toHaveLength(2);
    expect(store.remove("two")).toBe(true);
    expect(store.getSnapshot().passes).toEqual([pass()]);
    expect(store.clear()).toBe(true);
    expect(memory.removeItem).toHaveBeenCalledExactlyOnceWith(HISTORY_KEY);
  });
});

describe("gentle suggestions", () => {
  it("never treats listening or melody completion as a timing performance", () => {
    expect(practiceSuggestion([])).toMatch(/25–50%/);
    expect(practiceSuggestion([{ ...pass(), mode: "listen", rhythm: undefined }])).toMatch(/Listening/);
    expect(practiceSuggestion([{ ...pass(), mode: "melody", rhythm: undefined }])).toMatch(/relaxed speed/);
  });
  it("suggests a small optional increase only after three comparable steady passes", () => {
    const three = [pass("a"), pass("b"), pass("c")];
    expect(practiceSuggestion(three)).toMatch(/try 55%.*Staying here is fine/);
    expect(practiceSuggestion(three.slice(0, 2))).toMatch(/comfortable pace/);
    for (const patch of [{ speedMax: 75 }, { hand: "both" }, { pieceRevision: "edited" }, { startSeconds: 0.2 }, { rhythm: { ...pass().rhythm!, extra: 1 } }]) {
      expect(practiceSuggestion([three[0], three[1], { ...three[2], ...patch } as PracticePass])).toMatch(/comfortable pace/);
    }
  });
});

describe("recital history integration", () => {
  it("records completed recital counts and round-trips backup without mixing modes", () => {
    const { session, recorder } = transport("recital");
    session.start();
    recorder.advanceFrame(0, 100, false);
    session.press(60, 100);
    recorder.advanceFrame(0.2, 100, false);
    session.press(62, 100);
    recorder.advanceFrame(0.2, 100, false);
    const completed = recorder.advanceFrame(0.11, 100, false).completedPass;
    expect(completed).toMatchObject({ mode: "recital", rhythm: { total: 2, onTime: 2, missed: 0 } });
    expect(parsePracticeHistory(JSON.stringify({ kind: "piano-practice-history", version: 1, passes: [completed] }))[0]).toEqual(completed);
  });
  it("does not use rhythm sessions to suggest recital speed progression", () => {
    const recital = { ...pass("recital"), mode: "recital" as const };
    expect(practiceSuggestion([recital, pass("rhythm1"), pass("rhythm2")])).not.toContain("55%");
    expect(() => normalizePracticePass({ ...recital, rhythm: undefined })).toThrow();
  });
});
