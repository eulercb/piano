import { safeDocument } from "./scoreSource";
import { PianoAudio } from "./audio";
import { pianoShortcutPitch, isPianoVirtualClick } from "./pianoKeyboard";
import { pianoKeyGeometry, fallingNoteGeometry, ROLL_LOOKAHEAD_SECONDS } from "./pianoGeometry";
import { PracticeSession, frameTime, type PracticeHand, type PracticeMode, type RhythmSummary } from "./session";
import React, { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Piano,
  Library,
  SlidersHorizontal,
  Headphones,
  History,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Download,
  ArrowRight,
  Music2,
  Check,
  ChevronRight,
  Volume2,
  WifiOff,
} from "lucide-react";
import {
  demoSong,
  parseMidi,
  exportMidi,
  trimSong,
  transposeSong,
  formatTime,
  songDuration,
  type Song,
  type Note,
} from "./music";
import "./style.css";
import { Score } from "./Score";
import { DeferredStudioNoteAuthoring } from "./DeferredStudioNoteAuthoring";
import { ScorePreparationGuide } from "./ScorePreparationGuide";
import { PracticeRoom, PracticePanel } from "./PracticeRoom";
import { MidiConnection } from "./MidiConnection";
import { initialMidiSnapshot, type MidiSnapshot } from "./midiInput";
import { PracticeHistory } from "./PracticeHistory";
import { PracticeHistoryStore, PracticePassRecorder, type PracticePass } from "./practiceHistory";
import { PracticeNextSteps } from "./PracticeNextSteps";
import { practiceHandName, practiceModeName, type PracticeStep } from "./practiceNextSteps";
import { parseProject } from "./project";
import { passageTitle } from "./songTitle";
import { storedFolder, fileDigest, contentDigest, readPermission, supportedSong, type FolderConnection, type FolderSource } from "./songFolder";
import { SongLibrary } from "./songLibrary";
import { PracticeBookmarks } from "./PracticeBookmarks";
import { PracticeBookmarksStore, songRevision, type PracticeBookmark } from "./practiceBookmarks";
import { loadScoreImporter } from "./preparationModules";
import { songTempoMap } from "./songTempo";
import { serializeProject } from "./projectFormat";
import {
  scoreMeasures,
  editScoreNote,
  trimScoreMeasures,
  transposeScore,
} from "./scoreEditing";
const noteName = (p: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][p % 12] +
  (Math.floor(p / 12) - 1);
const duration = songDuration;
function TimingSummary({ summary }: { summary: RhythmSummary }) {
  return (
    <dl className="timing-summary">
      <div><dt>On time</dt><dd>{summary.onTime} / {summary.total}</dd></div>
      <div><dt>Early</dt><dd>{summary.early}</dd></div>
      <div><dt>Late</dt><dd>{summary.late}</dd></div>
      <div><dt>Missed</dt><dd>{summary.missed}</dd></div>
      <div><dt>Extra presses</dt><dd>{summary.extra}</dd></div>
    </dl>
  );
}
export function App() {
  const [audio] = useState(() => new PianoAudio());
  const [startingAudio, setStartingAudio] = useState(false);
  const startingAudioRef = useRef(false), playbackGeneration = useRef(0);
  function silence() { audio.silence(); }
  function sound(pitch: number, length?: number, velocity?: number) { audio.sound(pitch, length, velocity); }
  function cancelAudioStart() {
    playbackGeneration.current++;
    startingAudioRef.current = false;
    setStartingAudio(false);
  }
  const [midiState, setMidiState] = useState(initialMidiSnapshot);
  const previousMidiState = useRef(midiState);
  const [midiPaused, setMidiPaused] = useState(false);
  const [history] = useState(() => new PracticeHistoryStore());
  const [lastCompletedPass, setLastCompletedPass] = useState<PracticePass>();
  const historySnapshot = useSyncExternalStore(history.subscribe, history.getSnapshot);
  useEffect(() => history.listen(), [history]);
  const [bookmarks] = useState(() => new PracticeBookmarksStore());
  useEffect(() => bookmarks.listen(), [bookmarks]);
  const [library] = useState(() => new SongLibrary());
  const librarySnapshot = useSyncExternalStore(library.subscribe, library.getSnapshot);
  const songs = librarySnapshot.songs;
  useEffect(() => library.listen(), [library]);
  const [cleanSong, setCleanSong] = useState<Song>(demoSong);
  const savedVersion = useRef<Song | null>(null);
  const [saving, setSaving] = useState(false);
  const importGeneration = useRef(0);
  const [folder, setFolder] = useState<FolderConnection>();
  const folderRef = useRef<FolderConnection | undefined>(undefined);
  const folderStorageHealthy = useRef(true);
  useEffect(() => {
    let live = true;
    storedFolder().then(saved => {
      if (live && !folderRef.current && saved) { folderRef.current = saved; setFolder(saved); }
    }).catch(() => { folderStorageHealthy.current = false; });
    return () => { live = false; };
  }, []);
  const editingSession = useRef(0);
  const [song, setSong] = useState<Song>(demoSong),
    [page, setPage] = useState("practice"),
    [hand, setHand] = useState<PracticeHand>("both"),
    [mode, setMode] = useState<PracticeMode>("listen"),
    [speed, setSpeed] = useState(50),
    [playing, setPlaying] = useState(false),
    [, refreshSession] = useState(0),
    [countIn, setCountIn] = useState(true),
    [metronome, setMetronome] = useState(false),
    [notice, setNotice] = useState(""),
    [from, setFrom] = useState(0),
    [to, setTo] = useState(duration(demoSong)),
    [pressed, setPressed] = useState<number[]>([]),
    [muted, setMuted] = useState(false),
    [showScore, setShowScore] = useState(true),
    [practiceScore, setPracticeScore] = useState(false),
    [showFingers, setShowFingers] = useState(true),
    [connectionOpen, setConnectionOpen] = useState(false),
    [editIndex, setEditIndex] = useState(0),
    [firstMeasure, setFirstMeasure] = useState(0),
    [lastMeasure, setLastMeasure] = useState(0),
    [repeatPassage, setRepeatPassage] = useState(false);
  const bookmarkSettings = JSON.stringify({ hand, mode, speed, countIn, repeatPassage });
  const currentBookmarkSettings = useRef(bookmarkSettings);
  currentBookmarkSettings.current = bookmarkSettings;
  const currentSong = useRef(song);
  currentSong.current = song;
  const dirty = song !== cleanSong;
  const temporaryHistory = historySnapshot.temporary && historySnapshot.passes.length > 0;
  useEffect(() => {
    if (!dirty && !temporaryHistory) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, temporaryHistory]);
  useEffect(() => () => { importGeneration.current++; }, []);
  function mayReloadCurrent() {
    if (!dirty && !temporaryHistory) return true;
    return window.confirm(`Reload and discard ${[dirty ? "unsaved song changes" : "", temporaryHistory ? "temporary practice history" : ""].filter(Boolean).join(" and ")}? Cancel to save or export first.`);
  }
  function mayReplaceCurrent() {
    return !dirty || window.confirm("Discard unsaved changes to this piece? Cancel to save or export your project first.");
  }
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError() {
      setNotice("Offline support could not be updated. You can continue practising online.");
    },
  });
  const file = useRef<HTMLInputElement>(null),
    inputRef = useRef<(p: number) => void>(() => {}),
    inputTimers = useRef(new Map<number, number>()),
    last = useRef(0);
  const measures = useMemo(() => {
    try {
      return song.scoreOrigin === "musicxml" ? scoreMeasures(song) : [];
    } catch {
      return [];
    }
  }, [song]);
  const tempoMap = useMemo(() => songTempoMap(song), [song]);
  const session = useMemo(() => new PracticeSession({
    notes: song.notes, duration: duration(song), tempo: song.tempo,
    hand, mode, countIn, metronome, tempoMap,
  }), [song, hand, mode, countIn, metronome, tempoMap]);
  const recorder = useMemo(() => new PracticePassRecorder(session, song), [session, song]);
  const notes = session.notes, total = duration(song),
    time = Math.min(total, session.position);
  function redraw() {
    refreshSession((v) => v + 1);
  }
  function reset(t = 0) {
    cancelAudioStart();
    silence();
    session.restart(t);
    recorder.reset();
    setLastCompletedPass(undefined);
    setPlaying(false);
    setMidiPaused(false);
    setNotice("");
    redraw();
  }
  function pauseForAudio() {
    cancelAudioStart();
    session.pause();
    silence();
    setPlaying(false);
    setNotice("Audio interrupted. Press Play to resume, or choose Mute to practise without sound.");
    redraw();
  }
  useEffect(() => audio.subscribe(() => {
    if (!muted && (session.running || startingAudioRef.current)) pauseForAudio();
  }), [audio, session, muted]);
  function step(now: number) {
    // State events can arrive after an already-queued frame or piano input.
    if (session.running && !muted && !audio.running) { pauseForAudio(); return; }
    const wasRunning = session.running;
    const timing = frameTime(last.current, now);
    const result = recorder.advanceFrame(timing.seconds, speed, repeatPassage);
    if (result.completedPass) {
      setLastCompletedPass(result.completedPass);
      history.append(result.completedPass);
    }
    if (result.historyError) history.report(result.historyError);
    last.current = timing.timestamp;
    if (result.interrupted) {
      silence();
      setPlaying(false);
      setNotice("Practice paused after an interruption. Press Play to continue from here.");
    }
    if (result.looped) silence();
    if (!muted) {
      // A delayed frame should not produce a burst of old count-in clicks.
      if ((result.countBeats.length && session.countingIn) || result.metronomeBeat)
        sound(84, 0.045, 0.5);
      if (!result.looped)
        for (const n of result.audioNotes)
          sound(n.pitch, n.duration / (speed / 100), n.velocity);
    }
    if (wasRunning && session.completed) {
      setPlaying(false);
      setNotice((mode === "rhythm" || mode === "recital")
        ? "Pass complete. Open Results to review your timing, then try another pass."
        : mode === "melody"
          ? "Beautiful work. You completed this passage. Open Results to choose a small next step."
          : "Playback complete. Open Results to try waiting for notes or repeat this passage.");
    }
    redraw();
  }
  function togglePlayback() {
    if (startingAudioRef.current) {
      cancelAudioStart();
      silence();
      setNotice("Audio start canceled. Press Play when you’re ready.");
    } else if (session.running) {
      step(performance.now());
      session.pause();
      silence();
      setPlaying(false);
    } else {
      if (!notes.length) {
        setNotice("This passage has no notes for this hand. Choose another hand or piece.");
        return;
      }
      const generation = ++playbackGeneration.current;
      const start = (ready: boolean) => {
        if (generation !== playbackGeneration.current) return;
        startingAudioRef.current = false;
        setStartingAudio(false);
        if (document.hidden) return;
        if (!ready || (!muted && !audio.running)) {
          setNotice("Audio could not start. Press Play to retry, or choose Mute to practise without sound.");
          return;
        }
        setNotice("");
        setMidiPaused(false);
        last.current = performance.now();
        session.start();
        setPlaying(true);
        step(last.current);
        redraw();
      };
      const ready = muted || audio.ensureRunning();
      if (typeof ready === "boolean") start(ready);
      else {
        startingAudioRef.current = true;
        setStartingAudio(true);
        setNotice("Starting audio. Press the pause button to cancel.");
        void ready.then(start);
      }
    }
    redraw();
  }
  function changeSpeed(next: number) {
    if (next !== speed) setLastCompletedPass(undefined);
    if (next !== speed && startingAudioRef.current) {
      cancelAudioStart();
      silence();
      setNotice("Tempo changed. Press Play when you’re ready.");
    }
    setSpeed(next);
  }
  function toggleMute() {
    if (startingAudioRef.current) setNotice("");
    cancelAudioStart();
    silence();
    // Muted practice is independent of browser audio. Unmuting an unavailable
    // context must pause first rather than silently grading an inaudible pass.
    if (muted && session.running && !audio.running) pauseForAudio();
    setMuted(!muted);
  }
  function select(s: Song, saved = false, importing = false) {
    if (!importing) importGeneration.current++;
    if (saved || s.id !== song.id) editingSession.current++;
    reset();
    if (saved || s.id !== song.id) savedVersion.current = songs.find(item => item.id === s.id) ?? null;
    if (saved) setCleanSong(s);
    setSong(s);
    setPracticeScore(false);
    setFrom(0);
    setTo(duration(s));
    setFirstMeasure(0);
    setLastMeasure(0);
    setNotice("");
  }
  function savedBookmarkSong(id: string) {
    library.refresh();
    const fresh = library.getSnapshot();
    if (fresh.blocked) throw Error("The saved library could not be read. Bookmark was not opened.");
    const saved = id === demoSong.id ? demoSong : fresh.songs.find(item => item.id === id);
    // Recovery warnings about other songs do not invalidate a safe bookmark.
    // A selected unsafe source is never silently replaced with another piece.
    if (saved?.scoreXml !== undefined) safeDocument(saved.scoreXml);
    return saved;
  }
  async function saveBookmark(name: string) {
    const generation = importGeneration.current, playback = playbackGeneration.current;
    const current = () => generation === importGeneration.current && playback === playbackGeneration.current && currentSong.current === song && currentBookmarkSettings.current === bookmarkSettings;
    try {
      const saved = savedBookmarkSong(song.id);
      if (dirty || !saved) throw Error("Save this piece in Studio before bookmarking it. Your draft is unchanged.");
      const revision = await songRevision(saved), draftRevision = await songRevision(song);
      if (!current()) return false;
      if (revision !== draftRevision) throw Error("Reopen the current library revision before bookmarking it. Your draft is unchanged.");
      const ok = await bookmarks.change([{ id: crypto.randomUUID(), name, songId: saved.id, title: saved.title,
        revision, hand, mode, speed, countIn, repeat: repeatPassage }], undefined, () => {
        if (!current()) return false;
        const latest = savedBookmarkSong(saved.id);
        if (!latest || JSON.stringify(latest) !== JSON.stringify(saved))
          throw Error("This saved piece changed while saving the bookmark. Reopen its current library revision before bookmarking it.");
        return true;
      });
      if (ok && current()) setNotice("Practice bookmark saved on this device.");
      return ok;
    } catch (error) { if (current()) setNotice(error instanceof Error ? error.message : "Bookmark could not be saved."); return false; }
  }
  async function restoreBookmark(bookmark: PracticeBookmark) {
    const generation = ++importGeneration.current, playback = playbackGeneration.current;
    const current = () => generation === importGeneration.current && playback === playbackGeneration.current && currentSong.current === song && currentBookmarkSettings.current === bookmarkSettings;
    try {
      bookmarks.refresh();
      const fresh = bookmarks.getSnapshot();
      if (fresh.blocked || !fresh.bookmarks.some(item => JSON.stringify(item) === JSON.stringify(bookmark)))
        throw Error("This bookmark changed or was deleted in another tab. Choose it again from the refreshed list.");
      let saved = savedBookmarkSong(bookmark.songId);
      if (!saved) {
        const matches: Song[] = [];
        for (const candidate of library.getSnapshot().songs) {
          // Skip blocked notation during missing-ID recovery, not hashing errors:
          // an unavailable digest API or a newer selection must still stop restore.
          try { if (candidate.scoreXml !== undefined) safeDocument(candidate.scoreXml); }
          catch { continue; }
          if (await songRevision(candidate) === bookmark.revision) matches.push(candidate);
          if (!current()) return;
        }
        if (matches.length > 1) throw Error("Several saved pieces match this missing bookmark exactly. Open your chosen piece from Library and save a new bookmark; no piece was chosen automatically.");
        if (!matches.length) throw Error("This bookmark’s saved piece is missing. Import its original Piano project backup first, then open the bookmark again to confirm the matching piece. No music was substituted.");
        saved = matches[0];
        if (!window.confirm(`The original library entry is missing. Open matching saved piece “${saved.title}” for bookmark “${bookmark.name}”? Its notes, score, fingers and source tempo match exactly. This does not change the bookmark.`)) return;
      }
      const revision = await songRevision(saved);
      if (!current()) return;
      if (revision !== bookmark.revision) throw Error("This saved piece has changed since the bookmark was made. Open it from Library and create a new bookmark, or restore its original project backup. No music was substituted.");
      if (!mayReplaceCurrent()) return;
      // Re-read after the asynchronous digest and any native confirmation.
      const confirmed = savedBookmarkSong(saved.id);
      if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(saved)) throw Error("The saved piece changed while confirming. Bookmark was not opened.");
      bookmarks.refresh();
      if (bookmarks.getSnapshot().blocked || !bookmarks.getSnapshot().bookmarks.some(item => JSON.stringify(item) === JSON.stringify(bookmark)))
        throw Error("The bookmark changed while opening. Choose it again.");
      select(confirmed, true);
      setHand(bookmark.hand); setMode(bookmark.mode); setSpeed(bookmark.speed);
      setCountIn(bookmark.countIn); setRepeatPassage(bookmark.repeat); setPage("practice");
      setNotice("Bookmark opened at the beginning, paused. Close Setup if open, then press Play when ready.");
    } catch (error) { if (current()) setNotice(error instanceof Error ? error.message : "Bookmark could not be opened."); }
  }
  function input(p: number) {
    if (!muted) {
      if (session.running && !audio.running) pauseForAudio();
      audio.preview(p);
    }
    setPressed((old) => [...new Set([...old, p])]);
    // A repeated note owns a fresh highlight, not the previous note's expiry.
    window.clearTimeout(inputTimers.current.get(p));
    inputTimers.current.set(p, window.setTimeout(() => {
      inputTimers.current.delete(p);
      setPressed((old) => old.filter((x) => x !== p));
    }, 180));
    if (!session.running) return;
    // Grade against the input's actual time rather than the last animation frame.
    step(performance.now());
    session.press(p, speed);
    redraw();
  }
  inputRef.current = input;
  function midiStateChanged(next: MidiSnapshot) {
    const previous = previousMidiState.current;
    previousMidiState.current = next;
    setMidiState(next);
    // Disconnect/clearing the input is an explicit choice to use the fallback.
    // Keep transport paused, but do not keep telling the user to reconnect.
    if (!next.selectedId) setMidiPaused(false);
    if (previous.status === "connected" && next.status !== "connected"
      && previous.selectedId && next.selectedId === previous.selectedId
      && (session.running || startingAudioRef.current) && mode !== "listen") {
      // Keep the last visible position, count-in and partial matches. Do not
      // catch up to the loss event and create misses or a completed pass.
      if (startingAudioRef.current) setNotice("");
      cancelAudioStart();
      session.pause();
      silence();
      setPressed([]);
      setPlaying(false);
      setMidiPaused(true);
      redraw();
    }
  }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const pitch = pianoShortcutPitch(e);
      if (pitch !== undefined) {
        e.preventDefault();
        inputRef.current(pitch);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  useEffect(
    () => () => {
      playbackGeneration.current++;
      session.pause();
      audio.dispose();
      for (const timer of inputTimers.current.values()) window.clearTimeout(timer);
      inputTimers.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (playing) last.current = performance.now();
    let id = 0;
    const tick = (now: number) => {
      step(now);
      if (session.running) id = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (document.hidden && (session.running || startingAudioRef.current)) {
        cancelAudioStart();
        session.pause();
        silence();
        setPlaying(false);
        setNotice("Practice paused while the app was hidden. Press Play when you’re ready.");
        redraw();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (playing) id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [playing, speed, session, recorder, muted, repeatPassage]);
  async function save(s: Song) {
    if (saving) return;
    setSaving(true);
    const editing = editingSession.current;
    const copy = s.id === demoSong.id;
    const result = await library.save(copy ? { ...s, id: crypto.randomUUID(), title: s.title + " · copy" } : s,
      copy ? null : savedVersion.current);
    setSaving(false);
    // A Save requested in an older selection must not rebase a reopened draft.
    if (editing !== editingSession.current) return;
    if (result.ok) {
      savedVersion.current = result.song;
      if (copy) {
        reset();
        const updated = currentSong.current === s ? result.song
          : { ...currentSong.current, id: result.song.id, title: result.song.title };
        setSong(updated);
        setCleanSong(result.song);
        if (currentSong.current === s) setNotice("Saved to your library on this device.");
        return;
      }
      if (currentSong.current !== s) return;
      setCleanSong(s);
      setNotice("Saved to your library on this device.");
    } else if (currentSong.current === s) setNotice(result.error);
  }
  function mayTrimCurrent() {
    return !dirty || window.confirm("Create a passage from unsaved changes? This replaces the full-piece draft and loses edits outside the passage. Cancel to save or export the full piece first.");
  }
  function startImport() {
    if (!mayReplaceCurrent()) return;
    return ++importGeneration.current;
  }
  async function chooseFolder(reconnect = false) {
    const picker = (window as any).showDirectoryPicker;
    if (!picker && !folderRef.current) {
      setNotice("Folder access is unavailable in this browser. Use Import song to select one or more files.");
      file.current?.click();
      return;
    }
    const generation = startImport();
    if (generation === undefined) return;
    const current = () => generation === importGeneration.current;
    try {
      let connection = reconnect ? folderRef.current : undefined;
      if (!connection) {
        const handle = await picker({ mode: "read" });
        if (!current()) return;
        const previous = folderRef.current;
        let same = false;
        try { same = !!previous && !!handle.isSameEntry && await handle.isSameEntry(previous.handle); } catch { /* Reconnect as a new folder; exact-file deduplication still applies. */ }
        if (!current()) return;
        connection = { id: same ? previous!.id : crypto.randomUUID(), handle };
      }
      if (!await readPermission(connection.handle, current)) {
        if (current()) setNotice("Folder permission was not granted. Your saved songs are unchanged. Reconnect the folder or use Import song.");
        return;
      }
      if (!current()) return;
      folderRef.current = connection; setFolder(connection);
      let persistence = "Folder access lasts for this session; choose it again next time.";
      if (typeof indexedDB !== "undefined" && connection.handle.queryPermission && folderStorageHealthy.current) {
        try { await storedFolder(connection, current); persistence = "A folder shortcut is saved; browser permission may need reconnecting."; }
        catch { persistence = "Folder shortcut could not be saved; choose it again next time."; }
      }
      if (!current()) return;
      let count = 0, attempted = 0, unchanged = 0, kept = 0;
      const failures: string[] = [];
      for await (const entry of connection.handle.values()) {
        if (!current()) return;
        if (entry.kind !== "file" || !supportedSong(entry.name)) continue;
        if (attempted >= 50) break;
        attempted++;
        try {
          const f = await entry.getFile();
          if (!current()) return;
          const digest = await fileDigest(f);
          if (!current()) return;
          library.refresh();
          const known = library.getSnapshot().songs.filter(s => s.folderSource?.name === entry.name);
          if (known.some(s => s.folderSource!.digest === digest)) { unchanged++; continue; }
          // A session-only reconnect may have lost folder identity. Same-name
          // source changes must still be reviewed rather than silently duplicated.
          const changed = known.length > 0;
          if (changed && !window.confirm(`${entry.name} differs from a previously imported file with this name. Import the updated file as a separate copy? Your existing saved piece and edits will be kept. Cancel to keep only the existing piece; you can refresh again later.`)) {
            kept++; continue;
          }
          const result = await importFile(f, generation, { folderId: connection.id, name: entry.name, digest });
          if (!current()) return;
          if (result.ok) count++;
          else { failures.push(`${entry.name}: ${result.error}`); if (result.stop) return; }
        } catch (error) { failures.push(`${entry.name}: ${error instanceof Error ? error.message : "Could not read file."}`); }
      }
      if (!current()) return;
      setNotice(attempted
        ? `Folder refresh: ${count} imported, ${unchanged} unchanged, ${kept} kept existing. Checked up to 50 supported files in this folder only. ${failures.length ? `${failures.length} rejected. ${failures.slice(0, 3).join(" ")} ` : ""}${persistence} Refresh is manual; missing files never remove saved songs.`
        : "No MIDI, MusicXML or Piano project files found in this folder.");
    } catch (e) {
      if (current() && (e as Error).name !== "AbortError")
        setNotice("Could not read that folder. Your saved songs are unchanged. Choose the folder again or use Import song.");
    }
  }
  async function importFile(f: File, generation: number, folderSource?: FolderSource): Promise<{ ok: true } | { ok: false; error: string; stop?: boolean }> {
    const current = () => generation === importGeneration.current;
    try {
      if (!current()) return { ok: false, error: "Import canceled.", stop: true };
      if (f.size > 10 * 1024 * 1024) throw Error("Please choose a song file smaller than 10 MB.");
      let s: Song, message: string;
      if (/\.(musicxml|xml|mxl)$/i.test(f.name)) {
        let importer;
        try { importer = await loadScoreImporter(); }
        catch { throw Error("Score import tools could not load. Your piece is unchanged. Choose the file again to retry."); }
        if (!current()) return { ok: false, error: "Import canceled.", stop: true };
        const result = await importer.importScoreFile(f);
        s = { ...result.song, id: crypto.randomUUID() };
        message = result.warnings.length ? result.warnings.join(" ")
          : "Score imported with playable notes, hands and printed fingerings.";
      } else if (/\.json$/i.test(f.name)) {
        s = { ...parseProject(await f.text()), id: crypto.randomUUID() };
        message = "Practice project imported with its saved hands and fingerings.";
      } else {
        s = parseMidi(await f.arrayBuffer());
        s.title = f.name.replace(/\.mid(i)?$/i, "");
        message = "MIDI imported. Hands are estimated by pitch; check the split before practising.";
      }
      if (!current()) return { ok: false, error: "Import canceled.", stop: true };
      delete s.folderSource;
      if (folderSource) {
        s.folderSource = folderSource;
        // Stable import identity prevents concurrent tabs from making duplicate copies.
        s.id = "folder-" + await contentDigest(new TextEncoder().encode(folderSource.name + "\n" + folderSource.digest).buffer);
      }
      const result = await library.save(s, null, current);
      if (!current()) return { ok: false, error: "Import canceled.", stop: true };
      select(result.ok ? result.song : s, result.ok, true);
      savedVersion.current = result.ok ? result.song : null;
      setPage("prepare");
      setNotice(result.ok ? message : `Import is open but not saved. ${result.error} Remaining files were not imported.`);
      return result.ok ? { ok: true } : { ok: false, error: result.error, stop: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : "Could not read this song file.";
      if (current()) setNotice(error);
      return { ok: false, error };
    }
  }
  function download() {
    const blob = new Blob([new Uint8Array(exportMidi(song))], {
        type: "audio/midi",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = song.title + ".mid";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadScore() {
    if (!song.scoreXml) return;
    const url = URL.createObjectURL(
      new Blob([song.scoreXml], { type: "application/xml" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = song.title + ".musicxml";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadProject() {
    let text: string;
    try { text = serializeProject(song); }
    catch (error) { setNotice((error as Error).message); return; }
    const url = URL.createObjectURL(
      new Blob([text], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = song.title + ".piano.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const keys = useMemo(() => {
    let low = 48, high = 83;
    for (const note of notes) {
      low = Math.min(low, note.pitch);
      high = Math.max(high, note.pitch);
    }
    return pianoKeyGeometry(low, high);
  }, [notes]);
  const keysByPitch = useMemo(() => new Map(keys.map(key => [key.pitch, key])), [keys]);
  const waiting =
    mode === "melody" && playing && !session.countingIn
      ? notes.find((n) => !session.matched.has(n.id) && n.start <= time + 0.02)
      : undefined;
  function pauseForPanel() {
    if (startingAudioRef.current) setNotice("");
    cancelAudioStart();
    silence();
    if (session.running) {
      step(performance.now());
      session.pause();
      silence();
      setPlaying(false);
      redraw();
    }
  }
  function navigate(next: string) { importGeneration.current++; reset(); setPage(next); }
  function chooseNextStep(step: PracticeStep) {
    reset();
    setHand(step.hand);
    setMode(step.mode);
    setSpeed(step.speed);
    setNotice(`Ready from the beginning: ${practiceHandName(step.hand)} · ${step.speed}% · ${practiceModeName(step.mode)}. Press Play when you’re ready.`);
  }
  const practiceStage = (
    <section className="stage-card">
      <div className="stage-top">
        <span role={page === "practice" ? "status" : undefined} aria-live={page === "practice" ? "polite" : undefined} aria-atomic={page === "practice" ? true : undefined}>
          <span className="live-dot" />
          {playing && session.countingIn
            ? `Get ready · ${session.countBeat} of 4 beats`
            : waiting
            ? "Your turn · " + noteName(waiting.pitch)
            : mode === "rhythm" && session.feedback
              ? `${session.feedback.kind === "on-time" ? "On time" : session.feedback.kind === "extra" ? "No matching note" : session.feedback.kind} · ${noteName(session.feedback.pitch)}`
              : playing
              ? "Follow the music"
              : "Ready when you are"}
        </span>
        <div>
          <span className="legend left" />
          Left hand <span className="legend right" />
          Right hand
        </div>
      </div>
      <div className="guide-surface">
        {session.countingIn && playing && (
          <div className="count-in" role={page === "practice" ? undefined : "status"} aria-live={page === "practice" ? undefined : "polite"} aria-hidden={page === "practice" ? true : undefined}>
            <span>Get ready</span>
            <strong>{session.countBeat}</strong>
            <span>of 4 beats · then play</span>
          </div>
        )}
        {page === "practice" && practiceScore ? (
          <Score xml={song.scoreXml} editable={song.scoreOrigin === "musicxml"}
            sourceSong={song} playbackTime={time} playing={playing && !session.countingIn} compact />
        ) : <div className="roll" aria-label="Falling notes">
        <div className="roll-label">
          {mode === "melody"
            ? "PLAY THE HIGHLIGHTED NOTES"
            : (mode === "rhythm" || mode === "recital")
              ? "PLAY AS NOTES REACH THE LINE"
              : "LISTEN • LEARN • REPEAT"}
        </div>
        {keys.map((key) => (
          <div
            className="lane"
            key={key.pitch}
            data-pitch={key.pitch}
            style={{
              left: key.left + "%",
              width: key.width + "%",
              background: key.black
                ? "#ffffff02"
                : "transparent",
            }}
          />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <div
            className="beat-line"
            key={i}
            style={{ bottom: `${i * 25}%` }}
          />
        ))}
        {notes
          .filter(
            (n) =>
              n.start - time < ROLL_LOOKAHEAD_SECONDS &&
              n.start + n.duration - time > -0.1,
          )
          .map((n) => {
            const key = keysByPitch.get(n.pitch)!;
            const vertical = fallingNoteGeometry(n, time);
            return (
              <div
                title={noteName(n.pitch)}
                key={n.id}
                data-pitch={n.pitch}
                className={"fall-note " + n.hand + (key.black ? " accidental" : "")}
                style={{
                  left: key.left + "%",
                  width: key.width + "%",
                  bottom: vertical.bottom + "%",
                  height: vertical.height + "%",
                }}
              >
                {(page !== "practice" || showFingers) && n.finger
                  ? String(n.finger)
                  : key.width > 2.3
                    ? noteName(n.pitch).replace(/\d/g, "")
                    : ""}
              </div>
            );
          })}
        <div className="strike-line" />
        </div>}

      </div>
      <div className="keyboard">
        {keys.map((key) => (
          <button
            aria-label={"Play " + noteName(key.pitch)}
            key={key.pitch}
            data-pitch={key.pitch}
            onPointerDown={(e) => { if (e.button === 0) input(key.pitch); }}
            onClick={(e) => { if (isPianoVirtualClick(e)) input(key.pitch); }}
            className={
              (key.black ? "black" : "white") + (pressed.includes(key.pitch) ? " pressed" : "")
            }
            style={{ left: key.left + "%", width: key.width + "%" }}
          >
            {key.pitch % 12 === 0 ? <span>{noteName(key.pitch)}</span> : null}
          </button>
        ))}
      </div>
      <div className="transport">
        <button
          className="icon-button"
          aria-label="Restart"
          onClick={() => reset()}
        >
          <RotateCcw size={18} />
        </button>
        <button
          className="play-button"
          aria-label={startingAudio ? "Cancel audio start" : playing ? "Pause" : "Play"}
          aria-busy={startingAudio}
          onClick={togglePlayback}
        >
          {playing || startingAudio ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <span className="time">{formatTime(time)}</span>
        <input
          aria-label="Playback position"
          type="range"
          min="0"
          max={total}
          step=".01"
          value={time}
          onChange={(e) => reset(Number(e.target.value))}
        />
        <span className="time">{formatTime(total)}</span>
        <button
          className={"icon-button " + (muted ? "muted" : "")}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          onClick={toggleMute}
        >
          <Volume2 size={19} />
        </button>
      </div>
    </section>
  );
  const practiceSettings = (
    <section className="settings">
      <h3>Your practice, your pace</h3>
      <label className="control-label">
        01 <span>Choose your hands</span>
      </label>
      <div className="hand-options">
        {[
          ["left", "Left"],
          ["both", "Both"],
          ["right", "Right"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={hand === id ? "selected" : ""}
            aria-pressed={hand === id}
            onClick={() => {
              reset();
              setHand(id as PracticeHand);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="control-label">
        02 <span>Find your tempo</span>
        <b>{speed}%</b>
      </label>
      <input
        aria-label="Tempo percentage"
        type="range"
        min="25"
        max="125"
        step="5"
        value={speed}
        onChange={(e) => changeSpeed(Number(e.target.value))}
      />
      <div className="speed-presets">
        {[25, 50, 75, 100].map((v) => (
          <button
            key={v}
            className={speed === v ? "chosen" : ""}
            aria-pressed={speed === v}
            onClick={() => changeSpeed(v)}
          >
            {v}%
          </button>
        ))}
      </div>
      <div className="range-ends">
        <span>Take it slow</span>
        <span>{Math.round((song.tempo * speed) / 100)} BPM</span>
      </div>
      <label className="control-label">
        03 <span>Pick your approach</span>
      </label>
      {[
        [
          "listen",
          "Listen & explore",
          "Hear the piece. Get to know the notes.",
        ],
        [
          "melody",
          "Melody practice · wait for notes",
          "The music waits for your next note.",
        ],
        [
          "rhythm",
          "Rhythm practice",
          "Practice note starts. Get early, on-time or late feedback.",
        ],
        [
          "recital",
          "Recital practice",
          "Keep going. Review pitch and note starts after the pass.",
        ],
      ].map(([id, title, desc]) => (
        <button
          key={id}
          className={"mode " + (mode === id ? "selected" : "")}
          aria-pressed={mode === id}
          onClick={() => {
            reset();
            setMode(id as PracticeMode);
          }}
        >
          <span className="radio" />
          <span>
            <b>{title}</b>
            <small>{desc}</small>
          </span>
        </button>
      ))}
      <label className="repeat-control">
        <input
          type="checkbox"
          checked={countIn}
          onChange={(e) => { reset(); setCountIn(e.target.checked); }}
        />
        Count in 4 beats
      </label>
      <p className="coming">
        Four quarter-note beats at the starting tempo and selected speed,
        before each pass. This is a beat count, not a measure.
      </p>
      <label className="repeat-control">
        <input
          type="checkbox"
          checked={metronome}
          aria-describedby="metronome-help"
          onChange={(e) => { reset(); setMetronome(e.target.checked); }}
        />
        Metronome
      </label>
      <p className="coming" id="metronome-help">
        {tempoMap
          ? song.scoreOrigin === "musicxml"
            ? "Quarter-note clicks follow numeric tempo changes in this piece’s source MusicXML × practice speed. While Melody waits, clicks keep the tempo at that score position."
            : "Quarter-note clicks follow retained MIDI tempo changes × practice speed. While Melody waits, clicks keep the tempo at that playback position. Export a Piano project to retain these changes; MIDI export flattens them while preserving note seconds."
          : "Quarter-note clicks use the piece’s starting tempo × practice speed and keep ticking while Melody waits. This piece has no verified source tempo map; an attached reference-only score does not change playback."}
        {" "}Begins after any count-in. No meter accents. Mute silences the clicks.
        Changing this setting starts a fresh attempt.
      </p>
      <label className="repeat-control">
        <input
          type="checkbox"
          checked={repeatPassage}
          onChange={(e) => setRepeatPassage(e.target.checked)}
        />
        Repeat this passage
      </label>
      <p className="coming">
        Tip: choose one hand at 25–50%. Repeat a few notes
        comfortably before speeding up.
      </p>
      <p className="coming">
        Completed passes appear in Practice history. Recital saves feedback for the end so you can keep going.
      </p>
      <PracticeBookmarks store={bookmarks} onSave={saveBookmark} onRestore={restoreBookmark}
        canSave={!dirty && (song.id === demoSong.id || songs.some(item => item.id === song.id))} />
    </section>
  );
  const recitalPanel = (
    <section className="rhythm-panel" aria-label="Recital feedback">
      <h3>Recital · keep the music moving</h3>
      {session.completed ? <TimingSummary summary={session.summary} /> :
        <p>Feedback appears after the pass. Keep going at your comfortable pace; you can pause whenever needed.</p>}
      {session.previousResult && <div className="previous-pass"><b>Previous completed pass</b><TimingSummary summary={session.previousResult} /></div>}
      <p className="rhythm-help">Only the selected hand’s pitch and note starts are assessed. Correct pitches within 100 ms count as on time; up to 300 ms early or late gets timing feedback. Note lengths, touch, fingering, pedal and expression are not graded. Device/audio latency is not calibrated.</p>
    </section>
  );
  const rhythmPanel = (
    <section className="rhythm-panel" aria-label="Rhythm feedback">
      <div className="rhythm-heading">
        <div>
          <h3>Note-onset timing · pass {session.pass}</h3>
          <p>{hand === "both" ? "Both hands" : `${hand === "left" ? "Left" : "Right"} hand`} · {speed}% speed</p>
        </div>
        <div className="timing-feedback" role="status" aria-live="polite" aria-atomic="true">
          {session.countingIn && playing ? "Get ready. Notes are not graded yet."
            : session.feedback ? `${session.feedback.kind === "on-time" ? "On time" : session.feedback.kind === "extra" ? "No matching note" : session.feedback.kind[0].toUpperCase() + session.feedback.kind.slice(1)} · ${noteName(session.feedback.pitch)}${session.feedback.offsetMs !== undefined && session.feedback.kind !== "on-time" ? ` · ${Math.abs(session.feedback.offsetMs)} ms` : ""}`
              : "Play the shown notes as they reach the line."}
        </div>
      </div>
      <TimingSummary summary={session.summary} />
      {session.previousResult && (
        <div className="previous-pass">
          <b>Previous pass</b>
          <TimingSummary summary={session.previousResult} />
        </div>
      )}
      <p className="rhythm-help">
        Note-onset feedback only. Correct pitches within 100 ms count as on time. Up to 300 ms early
        or late gets timing feedback; unmatched notes are missed.
        Only the selected hand’s notes are targets. Note length and pedal
        are not graded. Device/audio latency is not calibrated.
      </p>
    </section>
  );
  return (
    <div className={page === "practice" ? "shell practice-shell" : "shell"}>
      <PracticePanel open={connectionOpen} title="Piano connection" onClose={() => setConnectionOpen(false)}>
        <MidiConnection onNote={(pitch) => inputRef.current(pitch)} onStateChange={midiStateChanged} />
      </PracticePanel>
      <aside hidden={page === "practice"}>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <Piano size={23} />
          </span>
          Piano<span className="brand-light">studio</span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav>
          {[
            ["library", "My library", Library],
            ["prepare", "Prepare a song", SlidersHorizontal],
            ["practice", "Practice room", Headphones],
            ["history", "Practice history", History],
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              className={page === id ? "nav active" : "nav"}
              aria-current={page === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {label}
              {page === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-piano">♩</div>
          <b>A little, every day.</b>
          <p>
            Progress happens one
            <br />
            beautiful note at a time.
          </p>
          <div className="local">
            <WifiOff size={14} /> Local-first. Just your music.
          </div>
        </div>
      </aside>
      <main>
        <header hidden={page === "practice"}>
          <div className="breadcrumb">
            Your workspace <ChevronRight size={14} />{" "}
            <span>
              {page === "practice"
                ? "Practice room"
                : page === "prepare"
                  ? "Prepare a song"
                  : page === "history" ? "Practice history" : "My library"}
            </span>
          </div>
          <button className="button light" onClick={() => { pauseForPanel(); setConnectionOpen(true); }}>Piano connection</button>
        </header>
        <input
          ref={file}
          hidden
          multiple
          type="file"
          accept=".mid,.midi,.json,.xml,.musicxml,.mxl"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []).sort(
              (a, b) =>
                Number(/\.(xml|musicxml|mxl)$/i.test(a.name)) -
                Number(/\.(xml|musicxml|mxl)$/i.test(b.name)),
            );
            e.target.value = "";
            if (!files.length) return;
            const generation = startImport();
            if (generation === undefined) return;
            for (const f of files) {
              const result = await importFile(f, generation);
              if (generation !== importGeneration.current || (!result.ok && result.stop)) break;
            }
          }}
        />
        <div className="content">
          {page !== "practice" && <div className="heading">
            <div>
              <div className="eyebrow">MAKE ROOM FOR MUSIC</div>
              <h1>
                {page === "practice"
                  ? "One note closer."
                  : page === "prepare"
                    ? "Make it your own."
                    : page === "history" ? "Every pass has a place." : "Your next favorite piece."}
              </h1>
              <p>
                {page === "practice"
                  ? "Slow it down. Find your rhythm. Enjoy the practice."
                  : page === "prepare"
                    ? "Turn a whole piece into a passage you can master."
                    : page === "history" ? "A private record of the music you spent time with." : "A small collection. Endless possibilities."}
              </p>
            </div>
            <button
              className="button light"
              onClick={() => file.current?.click()}
            >
              <Upload size={16} />
              Import song
            </button>
          </div>
          }
          {(page === "prepare" || page === "library") && <ScorePreparationGuide />}
          <div className="app-messages">
          {(midiPaused || (midiState.selectedId && ["disconnected", "error"].includes(midiState.status))) && (
            <div className="midi-recovery">
              <div role="status" aria-live="polite" aria-atomic="true">
                <b>{midiState.status === "connected"
                  ? "Piano ready · press Play to continue"
                  : `${["requesting", "opening"].includes(midiState.status) ? "Connecting piano" : "Piano not connected"}${midiPaused ? " · practice paused" : ""}`}</b>
                <p>{midiState.status === "connected"
                  ? "Your position is kept. Practice will not resume automatically."
                  : "Check power and USB-C/OTG cable. Reconnect in Piano, then press Play. Touch/typing keys also work."}</p>
              </div>
              <button className="room-button" onClick={() => { pauseForPanel(); setConnectionOpen(true); }}>Open Piano</button>
            </div>
          )}
          {needRefresh && (
            <div role="status" className="update-notice">
              <div>
                <b>A new version is ready.</b>
                <p>Save or export your song first. Reloading discards unsaved edits; saved library songs stay on this device.</p>
              </div>
              <button className="button" onClick={async () => {
                if (!mayReloadCurrent()) return;
                importGeneration.current++;
                session.pause();
                silence();
                setPlaying(false);
                try { await updateServiceWorker(true); }
                catch { setNotice("The update could not be loaded. Save your work, then reload the app manually."); }
              }}>Reload update</button>
            </div>
          )}
          {librarySnapshot.message && librarySnapshot.message !== notice && (
            <div className="notice" role="status">{librarySnapshot.message}</div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {page !== "history" && historySnapshot.message && (
            <div className="notice" role="status">{historySnapshot.message}</div>
          )}
          </div>
          {page === "practice" ? (
            <PracticeRoom title={song.title} hand={hand} mode={mode} speed={speed}
              showScore={practiceScore} hasScore={!!song.scoreXml} showFingers={showFingers}
              onScore={() => setPracticeScore(value => !value)}
              onFingers={() => setShowFingers(value => !value)}
              onNavigate={navigate} onConnection={() => { pauseForPanel(); setConnectionOpen(true); }}
              onSetup={pauseForPanel} settings={practiceSettings} guide={practiceStage}
              results={close => <>
                {lastCompletedPass ? <PracticeNextSteps pass={lastCompletedPass} song={song} speed={speed}
                  onChoose={step => { chooseNextStep(step); close(); }}
                  onPrepare={() => { close(); navigate("prepare"); }} />
                  : mode !== "rhythm" && mode !== "recital" && <p>Complete a listening or wait-for-notes pass to see gentle next-step choices here. Pauses and unfinished attempts are not failures.</p>}
                {mode === "rhythm" && rhythmPanel}
                {mode === "recital" && recitalPanel}
              </>} />
          ) : page === "history" ? <PracticeHistory store={history} /> : page === "library" ? (
            <>
              <div className="section-title">
                <h2>On your music stand</h2>
                <button className="button light" onClick={() => chooseFolder()}>
                  Open song folder
                </button>
                {folder && <button className="button light" onClick={() => chooseFolder(true)}>Refresh / reconnect folder</button>}
                <span>{songs.length + 1} pieces</span>
              </div>
              {folder && <p role="status">Folder: {folder.handle.name || "Selected folder"}. Read-only, manual refresh. Changed sources are offered as separate copies; saved edits are never overwritten.</p>}
              <PracticeBookmarks store={bookmarks} onRestore={restoreBookmark} />
              <div className="song-grid">
                {[demoSong, ...songs].map((s, i) => (
                  <button
                    className="song-card"
                    key={i === 0 ? "builtin-demo" : s.id}
                    onClick={() => {
                      if (!mayReplaceCurrent()) return;
                      select(s, true);
                      setPage("practice");
                    }}
                  >
                    <div className={"cover cover-" + (i % 3)}>
                      <Music2 size={48} />
                      <span>
                        {i === 0 ? "A STUDIO ORIGINAL" : "YOUR COLLECTION"}
                      </span>
                    </div>
                    <h3>{s.title}</h3>
                    <p>
                      {s.notes.length} notes · {formatTime(duration(s))} ·{" "}
                      {s.tempo} BPM
                    </p>
                    <span className="card-link">
                      Open in practice room <ArrowRight size={16} />
                    </span>
                  </button>
                ))}
                <button
                  className="import-card"
                  onClick={() => file.current?.click()}
                >
                  <Upload size={28} />
                  <h3>Bring your own music</h3>
                  <p>
                    Drop into a new piece.
                    <br />
                    MIDI or a saved Piano project.
                  </p>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="song-heading">
                <div className="song-icon">
                  <Music2 size={26} />
                </div>
                <div>
                  <div className="song-kicker">
                    {song.id === demoSong.id ? "STUDIO ORIGINAL" : "YOUR MIDI"}
                  </div>
                  <h2>{song.title}</h2>
                  <p>
                    {song.tempo} BPM <span>·</span> {formatTime(total)}{" "}
                    <span>·</span> {song.notes.length} notes
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    navigate("library");
                  }}
                >
                  Change piece <ChevronRight size={16} />
                </button>
              </div>
              {page === "prepare" && (
                <div className="editor">
                  <div>
                    <h3>A passage, not a mountain.</h3>
                    <p>
                      {measures.length
                        ? "Choose a few measures. Score and playback stay together."
                        : "Trim in seconds. Your original stays in the library."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        if (measures.length) {
                          setFirstMeasure(0);
                          setLastMeasure(
                            Math.max(0, Math.ceil(measures.length / 2) - 1),
                          );
                        } else {
                          setFrom(0);
                          setTo(total / 2);
                        }
                      }}
                    >
                      Select the beginning half
                    </button>
                  </div>
                  {measures.length ? (
                    <>
                      <label>
                        First measure
                        <select
                          value={firstMeasure}
                          onChange={(e) =>
                            setFirstMeasure(Number(e.target.value))
                          }
                        >
                          {measures.map((m, i) => (
                            <option key={i} value={i}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Last measure
                        <select
                          value={lastMeasure}
                          onChange={(e) =>
                            setLastMeasure(Number(e.target.value))
                          }
                        >
                          {measures.map((m, i) => (
                            <option key={i} value={i}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button light"
                        onClick={() => {
                          try {
                            if (!mayTrimCurrent()) return;
                            select(
                              trimScoreMeasures(
                                song,
                                firstMeasure,
                                lastMeasure,
                              ),
                            );
                            setNotice(
                              "Passage created. Score and playback trimmed together; saved library pieces were not changed. Save or export this passage to keep it.",
                            );
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      >
                        Trim score passage
                      </button>
                    </>
                  ) : (
                    <>
                      <label>
                        From (seconds)
                        <input
                          aria-label="Trim start"
                          type="number"
                          min="0"
                          max={total}
                          step=".1"
                          value={from}
                          onChange={(e) => setFrom(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        To (seconds)
                        <input
                          aria-label="Trim end"
                          type="number"
                          min="0"
                          max={total}
                          step=".1"
                          value={to}
                          onChange={(e) => setTo(Number(e.target.value))}
                        />
                      </label>
                      <button
                        className="button light"
                        onClick={() => {
                          try {
                            if (from < 0 || to <= from || to > total)
                              throw Error(
                                "Choose an end after the start, within this piece.",
                              );
                            if (!mayTrimCurrent()) return;
                            const s = trimSong(song, from, to);
                            s.id = crypto.randomUUID();
                            s.title = passageTitle(song.title);
                            select(s);
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      >
                        Trim passage
                      </button>
                    </>
                  )}
                  <button
                    className="button light"
                    onClick={() => {
                      try {
                        select(
                          song.scoreOrigin === "musicxml"
                            ? transposeScore(song, -1)
                            : transposeSong(song, -1),
                        );
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    − Semitone
                  </button>
                  <button
                    className="button light"
                    onClick={() => {
                      try {
                        select(
                          song.scoreOrigin === "musicxml"
                            ? transposeScore(song, 1)
                            : transposeSong(song, 1),
                        );
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    + Semitone
                  </button>
                  <button className="button" disabled={saving} onClick={() => save(song)}>
                    <Check size={16} />
                    Save
                  </button>
                  <button className="button light" onClick={download}>
                    <Download size={16} />
                    Export MIDI
                  </button>
                </div>
              )}
              <div className="view-toggle">
                {song.scoreXml && (
                  <button className="text-button" onClick={downloadScore}>
                    Export MusicXML <Download size={14} />
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => setShowScore(!showScore)}
                  aria-expanded={showScore}
                >
                  {showScore ? "Hide reading score" : "Show reading score"}
                </button>
                <button className="text-button" onClick={downloadProject}>
                  Export project + fingers <Download size={14} />
                </button>
              </div>
              {showScore && (
                <Score
                  xml={song.scoreXml}
                  editable={song.scoreOrigin === "musicxml"}
                  sourceSong={song}
                  playbackTime={time}
                  playing={playing && !session.countingIn}
                />
              )}
              {page === "prepare" && (
                <DeferredStudioNoteAuthoring
                  song={song}
                  timingOnly
                  selectedNoteId={song.notes[Math.min(editIndex, song.notes.length - 1)]?.id}
                  onSelectNote={id => setEditIndex(Math.max(0, song.notes.findIndex(note => note.id === id)))}
                  onChange={(updated, change) => {
                    importGeneration.current++;
                    reset();
                    setSong(updated);
                    setEditIndex(Math.max(0, updated.notes.findIndex(note => note.id === change.noteId)));
                    // Keep a full-piece trim selection inclusive after extending playback.
                    setTo(previous => previous === total ? duration(updated) : Math.min(previous, duration(updated)));
                    setFrom(previous => Math.min(previous, duration(updated)));
                  }}
                />
              )}
              {page === "prepare" && (
                <div className="note-editor">
                  <div>
                    <h3>Notes & fingerings</h3>
                    <p>
                      Choose a note to edit. Finger numbers: 1 thumb, 5 little
                      finger. Export a project to retain fingers.
                    </p>
                  </div>
                  <label>
                    Note
                    <select
                      value={Math.min(editIndex, song.notes.length - 1)}
                      onChange={(e) => setEditIndex(Number(e.target.value))}
                    >
                      {song.notes.map((n, i) => (
                        <option key={n.id} value={i}>
                          {i + 1}. {noteName(n.pitch)} · {formatTime(n.start)} ·{" "}
                          {n.hand}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const i = Math.min(editIndex, song.notes.length - 1),
                      n = song.notes[i];
                    if (!n) return null;
                    const edit = (patch: Partial<Note>) => {
                      try {
                        importGeneration.current++;
                        reset();
                        const updated = song.scoreOrigin === "musicxml"
                          ? editScoreNote(song, n.id, patch)
                          : { ...song, notes: song.notes.map((x, j) => j === i ? { ...x, ...patch } : x) };
                        const sourceId = n.sourceNoteIds?.[0];
                        const nextIndex = updated.notes.findIndex(x => sourceId
                          ? x.sourceNoteIds?.includes(sourceId)
                          : x.id === n.id);
                        setEditIndex(Math.max(0, nextIndex));
                        setSong(updated);
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    };
                    return (
                      <>
                        <label>
                          Pitch (MIDI)
                          <input
                            type="number"
                            min="0"
                            max="127"
                            value={n.pitch}
                            onChange={(e) => {
                              const p = Number(e.target.value);
                              if (Number.isInteger(p) && p >= 0 && p <= 127)
                                edit({ pitch: p });
                            }}
                          />
                        </label>
                        <label>
                          Hand
                          <select
                            value={n.hand}
                            onChange={(e) =>
                              edit({ hand: e.target.value as Note["hand"] })
                            }
                          >
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                        </label>
                        <label>
                          Finger
                          <select
                            value={n.finger || ""}
                            onChange={(e) =>
                              edit({
                                finger: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                          >
                            <option value="">Unspecified</option>
                            {[1, 2, 3, 4, 5].map((f) => (
                              <option key={f}>{f}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    );
                  })()}
                </div>
              )}
              <div className="practice-grid">{practiceStage}{practiceSettings}</div>
              {mode === "rhythm" && rhythmPanel}
              {mode === "recital" && recitalPanel}
              <div className="below-stage">
                <div>
                  <span className="tip-icon">✦</span>
                  <p>
                    <b>Small steps sound good.</b> Try one hand at 50% speed,
                    then bring them together.
                  </p>
                </div>
                <span>Keyboard demo: A–; · C4–E5</span>
              </div>
              <div className="next-strip">
                <div>
                  <h3>
                    {page === "prepare"
                      ? "Ready for a little practice?"
                      : "Find your favorite four bars."}
                  </h3>
                  <p>
                    {page === "prepare"
                      ? "Take your prepared passage into the practice room."
                      : "A shorter passage makes a big piece feel possible."}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    navigate(page === "prepare" ? "practice" : "prepare");
                  }}
                >
                  {page === "prepare"
                    ? "Start practising"
                    : "Prepare this piece"}
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {page !== "practice" && <footer>
            <span>
              Piano studio <span className="footer-dot">•</span> Made for the
              joy of learning
            </span>
            <span>Your music stays on this device</span>
          </footer>}
        </div>
      </main>
    </div>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
