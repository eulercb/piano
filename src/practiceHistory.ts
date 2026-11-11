import { songDuration, type Song } from "./music";
import { PracticeSession, type NoteStartCounts, type PracticeHand, type PracticeMode, type RhythmSummary, type WrittenHandSummary } from "./session";

export const HISTORY_KEY = "piano-practice-history";
export const MAX_HISTORY_PASSES = 200;
export const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_SECONDS = 86400;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

export type PracticePass = {
  id: string;
  pieceId: string;
  pieceRevision: string;
  pieceTitle: string;
  startedAt: string;
  completedAt: string;
  mode: PracticeMode;
  hand: PracticeHand;
  tempo: number;
  speedMin: number;
  speedMax: number;
  startSeconds: number;
  endSeconds: number;
  noteCount: number;
  rhythm?: RhythmSummary;
  /** Optional for older backups; only completed both-hand timing passes save this. */
  writtenHands?: WrittenHandSummary;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const count = (value: unknown, max = MAX_COUNT): value is number =>
  inRange(value, 0, max) && Number.isInteger(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function invalid(reason: string): never {
  throw new Error(`Invalid practice history: ${reason}`);
}

const noteStartFields = ["total", "onTime", "early", "late", "missed"] as const;
function normalizeWrittenPart(value: unknown): NoteStartCounts {
  if (!isRecord(value) || Object.keys(value).length !== noteStartFields.length ||
    !count(value.total) || !count(value.onTime) || !count(value.early) || !count(value.late) || !count(value.missed) ||
    value.onTime + value.early + value.late + value.missed !== value.total)
    return invalid("written-part counts must describe completed note starts without hand-attributed extra presses.");
  return { total: value.total, onTime: value.onTime, early: value.early, late: value.late, missed: value.missed };
}

/** Only allow summary fields: never retain score XML, notes, or arbitrary imported data. */
export function normalizePracticePass(value: unknown): PracticePass {
  if (!isRecord(value)) return invalid("a pass must be an object.");
  if (!text(value.id, 200) || !text(value.pieceId, 200) || !text(value.pieceRevision, 200) || !text(value.pieceTitle, 500))
    return invalid("a pass needs valid identifiers and a piece title.");
  if (!timestamp(value.startedAt) || !timestamp(value.completedAt) || value.startedAt > value.completedAt)
    return invalid("a pass needs valid, ordered dates.");
  if (value.mode !== "listen" && value.mode !== "melody" && value.mode !== "rhythm" && value.mode !== "recital")
    return invalid("unknown practice mode.");
  if (value.hand !== "left" && value.hand !== "right" && value.hand !== "both")
    return invalid("unknown hand selection.");
  if ((!inRange(value.tempo, 0, 10000) || value.tempo === 0) || !inRange(value.speedMin, 25, 125) || !inRange(value.speedMax, value.speedMin, 125))
    return invalid("tempo or speed is outside supported limits.");
  if (!inRange(value.startSeconds, 0, MAX_SECONDS) || !inRange(value.endSeconds, 0, MAX_SECONDS) || value.startSeconds >= value.endSeconds)
    return invalid("a pass needs a nonempty passage.");
  if (!count(value.noteCount) || value.noteCount === 0)
    return invalid("a completed pass needs at least one selected note.");
  let rhythm: RhythmSummary | undefined;
  if (value.mode === "rhythm" || value.mode === "recital") {
    const r = value.rhythm;
    if (!isRecord(r) || !count(r.total) || r.total !== value.noteCount ||
      !count(r.onTime) || !count(r.early) || !count(r.late) || !count(r.missed) || !count(r.extra, Number.MAX_SAFE_INTEGER) ||
      r.onTime + r.early + r.late + r.missed !== r.total)
      return invalid("rhythm counts must describe a completed pass.");
    rhythm = { total: r.total, onTime: r.onTime, early: r.early, late: r.late, missed: r.missed, extra: r.extra };
  } else if (value.rhythm !== undefined) return invalid("only rhythm or recital passes have timing counts.");
  let writtenHands: WrittenHandSummary | undefined;
  if (value.writtenHands !== undefined) {
    if (!rhythm || value.hand !== "both") return invalid("only both-hand rhythm or recital passes have written-part counts.");
    const parts = value.writtenHands;
    if (!isRecord(parts) || Object.keys(parts).length !== 2)
      return invalid("written-part counts need left and right parts.");
    const left = normalizeWrittenPart(parts.left), right = normalizeWrittenPart(parts.right);
    if (noteStartFields.some((field) => left[field] + right[field] !== rhythm![field]))
      return invalid("written-part counts must add up to the overall timing counts.");
    writtenHands = { left, right };
  }
  return {
    id: value.id, pieceId: value.pieceId, pieceRevision: value.pieceRevision,
    pieceTitle: value.pieceTitle, startedAt: value.startedAt, completedAt: value.completedAt,
    mode: value.mode, hand: value.hand, tempo: value.tempo,
    speedMin: value.speedMin, speedMax: value.speedMax,
    startSeconds: value.startSeconds, endSeconds: value.endSeconds, noteCount: value.noteCount,
    ...(rhythm ? { rhythm } : {}),
    ...(writtenHands ? { writtenHands } : {}),
  };
}

export function parsePracticeHistory(source: string): PracticePass[] {
  if (new TextEncoder().encode(source).byteLength > MAX_HISTORY_BYTES)
    return invalid("backup is larger than 1 MiB.");
  let value: unknown;
  try { value = JSON.parse(source); } catch { return invalid("file is not valid JSON."); }
  if (!isRecord(value) || value.kind !== "piano-practice-history" || value.version !== 1)
    return invalid("unsupported backup format or version.");
  if (!Array.isArray(value.passes) || value.passes.length > MAX_HISTORY_PASSES)
    return invalid(`a backup can contain at most ${MAX_HISTORY_PASSES} passes.`);
  const passes = value.passes.map(normalizePracticePass);
  if (new Set(passes.map((pass) => pass.id)).size !== passes.length)
    return invalid("duplicate pass identifiers.");
  return newestFirst(passes);
}

function newestFirst(passes: PracticePass[]) {
  return [...passes].sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id));
}
export function exportPracticeHistory(passes: PracticePass[]) {
  const source = JSON.stringify({ kind: "piano-practice-history", version: 1, passes }, null, 2);
  // Export uses the same bounded, field-allowlisting validation as import.
  const valid = parsePracticeHistory(source);
  return JSON.stringify({ kind: "piano-practice-history", version: 1, passes: valid }, null, 2);
}
export function mergePracticeHistory(current: PracticePass[], incoming: PracticePass[]) {
  const byId = new Map(current.map((pass) => [pass.id, pass]));
  for (const pass of incoming) {
    const existing = byId.get(pass.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(pass))
      return invalid("a backup conflicts with an existing pass. Nothing was changed.");
    byId.set(pass.id, pass);
  }
  return newestFirst([...byId.values()]).slice(0, MAX_HISTORY_PASSES);
}

/** A local content marker avoids comparing different edits of one saved piece. Not a security hash. */
export function practicePieceRevision(song: Song) {
  let hash = 2166136261;
  const add = (value: string) => {
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  };
  add(`${song.tempo}|${songDuration(song)}|`);
  for (const n of song.notes) add(`${n.pitch},${n.start},${n.duration},${n.hand};`);
  return `v1-${song.notes.length}-${(hash >>> 0).toString(16)}`;
}

/** Observes actual transport completion, including loops. Reset/seek discards unfinished work. */
export class PracticePassRecorder {
  private pending?: { startedAt: string; startSeconds: number; speedMin: number; speedMax: number };
  private readonly revision: string;
  constructor(
    readonly session: PracticeSession,
    private readonly song: Song,
    private readonly now = () => new Date().toISOString(),
    private readonly makeId: () => string = () => crypto.randomUUID(),
  ) { this.revision = practicePieceRevision(song); }

  reset() { this.pending = undefined; }

  advanceFrame(elapsedSeconds: number, speed: number, repeat: boolean) {
    const running = this.session.running;
    if (running && !this.pending) {
      this.pending = { startedAt: this.now(), startSeconds: this.session.position, speedMin: speed, speedMax: speed };
    }
    const result = this.session.advanceFrame(elapsedSeconds, speed, repeat);
    let completedPass: PracticePass | undefined;
    let historyError: string | undefined;
    if (running && this.pending && !result.interrupted) {
      this.pending.speedMin = Math.min(this.pending.speedMin, speed);
      this.pending.speedMax = Math.max(this.pending.speedMax, speed);
      if (result.looped || this.session.completed) {
        const pending = this.pending;
        this.pending = undefined;
        const noteCount = this.session.notes.filter((n) => n.start >= pending.startSeconds).length;
        if (noteCount && pending.startSeconds < this.session.options.duration) {
          try {
            completedPass = normalizePracticePass({
              id: this.makeId(), pieceId: this.song.id, pieceTitle: this.song.title,
              pieceRevision: this.revision, ...pending,
              completedAt: [this.now(), pending.startedAt].sort().at(-1),
              mode: this.session.options.mode, hand: this.session.options.hand,
              tempo: this.song.tempo, endSeconds: this.session.options.duration, noteCount,
              ...((this.session.options.mode === "rhythm" || this.session.options.mode === "recital")
                ? {
                  rhythm: result.looped ? this.session.previousResult : this.session.summary,
                  writtenHands: result.looped ? this.session.previousWrittenHands : this.session.writtenHands,
                } : {}),
            });
          } catch {
            historyError = "This completed pass could not be recorded because its piece details are outside the history format. Playing is still available; existing history is unchanged.";
          }
        }
      }
    }
    return { ...result, completedPass, historyError };
  }
}

export type HistorySnapshot = {
  passes: PracticePass[];
  message: string;
  temporary: boolean;
  blocked: boolean;
};
type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const TEMPORARY_MESSAGE = "History could not be saved on this device. These passes are temporary until saved; export a backup before closing the app.";

/** Storage failures must not interrupt playing or silently replace unreadable user data. */
export class PracticeHistoryStore {
  private snapshot: HistorySnapshot = { passes: [], message: "", temporary: false, blocked: false };
  private listeners = new Set<() => void>();
  private lastStored: string | null | undefined;
  private unsaved: PracticePass[] = [];
  private externalConflict = false;
  constructor(private readonly storage: () => HistoryStorage = () => localStorage) {
    this.readLatest();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<HistorySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  report(message: string) { this.update({ message }); }

  /** Storage events keep an open history view current; writes also re-read for missed events. */
  listen() {
    const changed = (event: StorageEvent) => {
      if (event.key === HISTORY_KEY || event.key === null) this.readLatest();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }

  private readLatest(): PracticePass[] | undefined {
    let source: string | null;
    try { source = this.storage().getItem(HISTORY_KEY); } catch {
      this.update({ temporary: true, blocked: true,
        message: "Device history storage is unavailable. New passes stay temporary; export a backup before closing the app." });
      return;
    }
    let saved: PracticePass[];
    try { saved = source === null ? [] : parsePracticeHistory(source); } catch {
      this.lastStored = source;
      this.update({ temporary: true, blocked: true,
        message: "Saved history could not be read and has not been overwritten. New passes stay temporary. Export them, then clear history to start fresh." });
      return;
    }
    if (this.externalConflict || (source !== this.lastStored && this.unsaved.length > 0)) {
      this.externalConflict = true;
      this.update({ passes: mergePracticeHistory(saved.filter((pass) => !this.unsaved.some((pending) => pending.id === pass.id)), this.unsaved), temporary: true, blocked: true,
        message: "Another tab changed history while passes here were unsaved. Saving is paused to protect those changes. Export these temporary passes, then reload or clear history before saving again." });
      return;
    }
    if (source === this.lastStored && !this.snapshot.blocked) return saved;
    const changed = this.lastStored !== undefined && source !== this.lastStored;
    this.lastStored = source;
    this.update({ passes: mergePracticeHistory(saved, this.unsaved), blocked: false, temporary: this.unsaved.length > 0,
      ...(changed ? { message: "History was updated in another tab." } : {}) });
    return saved;
  }

  private persist(passes: PracticePass[]) {
    if (this.snapshot.blocked) return false;
    try {
      const source = exportPracticeHistory(passes);
      this.storage().setItem(HISTORY_KEY, source);
      this.lastStored = source;
      this.unsaved = [];
      return true;
    } catch { return false; }
  }
  /** Web Locks serialize read/modify/write across tabs on supported secure browsers. */
  private exclusive<T>(action: () => T, failedAction?: () => T): T | false | Promise<T | false> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks?.request) return action();
    const failed = () => {
      this.report("History could not be updated safely. Existing history is unchanged. Try again in one app tab.");
      return failedAction ? failedAction() : false;
    };
    try { return locks.request("piano-practice-history-write", action).catch(failed); }
    catch { return failed(); }
  }
  append(pass: PracticePass) {
    return this.exclusive(() => this.appendNow(pass), () => {
      try {
        const valid = normalizePracticePass(pass);
        this.unsaved = mergePracticeHistory(this.unsaved, [valid]);
        this.update({ passes: mergePracticeHistory(this.snapshot.passes, [valid]), temporary: true,
          message: "Tab coordination was unavailable. This pass is temporary; export history before closing the app." });
      } catch { this.report("This pass could not be recorded. Playing is still available; existing history is unchanged."); }
    });
  }
  restore(incoming: PracticePass[]) { return this.exclusive(() => this.restoreNow(incoming)); }
  remove(id: string) { return this.exclusive(() => this.removeNow(id)); }
  clear() { return this.exclusive(() => this.clearNow()); }

  private appendNow(pass: PracticePass) {
    try {
      const valid = normalizePracticePass(pass);
      const saved = this.readLatest();
      const passes = mergePracticeHistory(saved === undefined ? this.snapshot.passes : mergePracticeHistory(saved, this.unsaved), [valid]);
      const persisted = saved !== undefined && this.persist(passes);
      if (!persisted) this.unsaved = mergePracticeHistory(this.unsaved, [valid]);
      this.update({ passes, temporary: !persisted, message: persisted ? "" : this.snapshot.blocked ? this.snapshot.message : TEMPORARY_MESSAGE });
    } catch {
      this.report("This pass could not be added to history. Playing is still available; existing history is unchanged.");
    }
  }
  private restoreNow(incoming: PracticePass[]) {
    const valid = incoming.map(normalizePracticePass);
    const saved = this.readLatest();
    if (saved === undefined) return false;
    const passes = mergePracticeHistory(mergePracticeHistory(saved, this.unsaved), valid);
    if (!this.persist(passes)) {
      this.update({ message: "Backup was not imported because device storage is unavailable or full. Existing history was not changed." });
      return false;
    }
    this.update({ passes, temporary: false, message: "Backup merged. Duplicate passes were skipped; only the newest 200 passes are kept." });
    return true;
  }
  private removeNow(id: string) {
    const saved = this.readLatest();
    if (saved === undefined) return false;
    const passes = mergePracticeHistory(saved, this.unsaved).filter((pass) => pass.id !== id);
    if (!this.persist(passes)) {
      this.update({ message: "The pass could not be deleted from device storage. History was not changed." });
      return false;
    }
    this.update({ passes, temporary: false, message: "Pass deleted from this device." });
    return true;
  }
  private clearNow() {
    try { this.storage().removeItem(HISTORY_KEY); } catch {
      this.update({ message: "History could not be cleared from device storage. Nothing was changed." });
      return false;
    }
    this.lastStored = null;
    this.unsaved = [];
    this.externalConflict = false;
    this.update({ passes: [], temporary: false, blocked: false, message: "Practice history cleared from this device. Exported backups are unchanged." });
    return true;
  }
}

/** Suggestions are optional and conservative, never a score for musical ability. */
export function practiceSuggestion(passes: PracticePass[]) {
  const latest = passes.find((pass) => pass.mode !== "listen");
  if (!latest) return "When you feel ready, try a short melody passage with one hand at 25–50%. Listening is useful preparation too.";
  if (latest.mode === "melody") return "You reached the end in melody practice. Repeat until it feels comfortable, or try the same passage in rhythm mode at a relaxed speed.";
  const comparable = passes.filter((pass) => pass.mode === latest.mode && pass.pieceId === latest.pieceId &&
    pass.pieceRevision === latest.pieceRevision && pass.hand === latest.hand && pass.startSeconds === latest.startSeconds &&
    pass.endSeconds === latest.endSeconds && pass.speedMin === latest.speedMin && pass.speedMax === latest.speedMax).slice(0, 3);
  const steady = comparable.length === 3 && comparable.every((pass) => pass.rhythm &&
    pass.rhythm.onTime / pass.noteCount >= 0.85 && pass.rhythm.missed === 0 && pass.rhythm.extra === 0);
  if (steady && latest.speedMin === latest.speedMax && latest.speedMax < 100)
    return `Three recent passes at ${latest.speedMax}% had mostly on-time note starts. If playing feels comfortable, try ${Math.min(100, latest.speedMax + 5)}%. Staying here is fine too.`;
  return "Keep a comfortable pace. Try the same passage again, slow it down, or practise one hand. Timing counts are a guide, not a grade.";
}
