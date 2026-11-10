import { matchMelodyPitch, melodyPosition } from "./practice";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Piano,
  Library,
  SlidersHorizontal,
  Headphones,
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
import { normalizeSong, parseProject } from "./project";
import { parseMusicXml } from "./musicxml";
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
let audio: AudioContext | undefined;
const voices = new Set<OscillatorNode>();
function silence() {
  for (const o of voices) {
    try {
      o.stop();
    } catch {}
  }
  voices.clear();
}
function sound(p: number, d = 0.3, v = 0.3) {
  audio ??= new AudioContext();
  void audio.resume();
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.type = "triangle";
  o.frequency.value = 440 * 2 ** ((p - 69) / 12);
  g.gain.setValueAtTime(0, audio.currentTime);
  g.gain.linearRampToValueAtTime(v * 0.25, audio.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(
    0.001,
    audio.currentTime + Math.max(0.03, d),
  );
  o.connect(g);
  g.connect(audio.destination);
  voices.add(o);
  o.onended = () => {
    voices.delete(o);
    o.disconnect();
    g.disconnect();
  };
  o.start();
  o.stop(audio.currentTime + Math.max(0.04, d));
}
function load(): Song[] {
  try {
    const songs = JSON.parse(localStorage.getItem("piano-songs") || "[]");
    return Array.isArray(songs)
      ? songs.flatMap((s) => {
          try {
            return [normalizeSong(s)];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}
function App() {
  const [songs, setSongs] = useState<Song[]>(load),
    [song, setSong] = useState<Song>(demoSong),
    [page, setPage] = useState("practice"),
    [hand, setHand] = useState("both"),
    [mode, setMode] = useState("listen"),
    [speed, setSpeed] = useState(50),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [notice, setNotice] = useState(""),
    [from, setFrom] = useState(0),
    [to, setTo] = useState(duration(demoSong)),
    [pressed, setPressed] = useState<number[]>([]),
    [midiStatus, setMidiStatus] = useState("Connect piano"),
    [muted, setMuted] = useState(false),
    [showScore, setShowScore] = useState(true),
    [editIndex, setEditIndex] = useState(0),
    [firstMeasure, setFirstMeasure] = useState(0),
    [lastMeasure, setLastMeasure] = useState(0),
    [repeatPassage, setRepeatPassage] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    clock = useRef(0),
    sounded = useRef(new Set<string>()),
    matched = useRef(new Set<string>()),
    active = useRef<Note[]>([]),
    inputRef = useRef<(p: number) => void>(() => {}),
    midiRef = useRef<any>(null),
    last = useRef(0);
  const measures = useMemo(() => {
    try {
      return song.scoreOrigin === "musicxml" ? scoreMeasures(song) : [];
    } catch {
      return [];
    }
  }, [song]);
  const notes = song.notes.filter((n) => hand === "both" || n.hand === hand),
    total = duration(song);
  active.current = notes;
  function reset(t = 0) {
    silence();
    setPlaying(false);
    clock.current = t;
    setTime(t);
    sounded.current = new Set(
      song.notes.filter((n) => n.start < t).map((n) => n.id),
    );
    matched.current = new Set(
      song.notes.filter((n) => n.start < t).map((n) => n.id),
    );
  }
  function select(s: Song) {
    reset();
    setSong(s);
    setFrom(0);
    setTo(duration(s));
    setFirstMeasure(0);
    setLastMeasure(0);
    setNotice("");
  }
  function input(p: number) {
    sound(p);
    setPressed((old) => [...new Set([...old, p])]);
    window.setTimeout(
      () => setPressed((old) => old.filter((x) => x !== p)),
      180,
    );
    if (!playing || mode !== "melody") return;
    for (const id of matchMelodyPitch(
      active.current,
      matched.current,
      p,
      clock.current,
    ))
      matched.current.add(id);
  }
  inputRef.current = input;
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const i = "awsedftgyhujkolp;".indexOf(e.key.toLowerCase());
      if (i >= 0) {
        e.preventDefault();
        inputRef.current(60 + i);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  useEffect(
    () => () => {
      silence();
      midiRef.current?.inputs.forEach((p: any) => (p.onmidimessage = null));
      if (midiRef.current) midiRef.current.onstatechange = null;
    },
    [],
  );
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const delta = (Math.min((now - last.current) / 1000, 0.08) * speed) / 100;
      last.current = now;
      let next = clock.current + delta;
      if (mode === "melody") {
        next = melodyPosition(active.current, matched.current, next);
      }
      for (const n of song.notes) {
        if (n.start <= next && !sounded.current.has(n.id)) {
          sounded.current.add(n.id);
          if (
            !muted &&
            (mode === "listen"
              ? active.current.includes(n)
              : !active.current.includes(n))
          )
            sound(n.pitch, n.duration / (speed / 100), n.velocity);
        }
      }
      clock.current = next;
      setTime(next);
      if (next >= total) {
        if (repeatPassage) {
          silence();
          clock.current = 0;
          setTime(0);
          sounded.current.clear();
          matched.current.clear();
          id = requestAnimationFrame(tick);
          return;
        }
        setPlaying(false);
        setNotice(
          mode === "melody"
            ? "Beautiful work. You completed this passage."
            : "Playback complete. Make another pass, or prepare a smaller passage.",
        );
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, mode, song, hand, muted, total, repeatPassage]);
  async function connect() {
    try {
      const nav = navigator as any;
      if (!nav.requestMIDIAccess) {
        setNotice(
          "Web MIDI is unavailable in this browser. Try desktop Chrome or Edge, or use the on-screen keys.",
        );
        return;
      }
      const access = await nav.requestMIDIAccess({ sysex: false });
      midiRef.current = access;
      const attach = () => {
        access.inputs.forEach(
          (p: any) =>
            (p.onmidimessage = (e: any) => {
              if ((e.data[0] & 240) === 144 && e.data[2] > 0)
                inputRef.current(e.data[1]);
            }),
        );
        setMidiStatus(
          access.inputs.size
            ? `${access.inputs.size} piano connected`
            : "No MIDI device found",
        );
      };
      access.onstatechange = attach;
      attach();
    } catch {
      setNotice(
        "MIDI access wasn’t available. You can still use the on-screen piano.",
      );
    }
  }
  function save(s: Song) {
    setSongs((previous) => {
      const next = [s, ...previous.filter((x) => x.id !== s.id)];
      try {
        localStorage.setItem("piano-songs", JSON.stringify(next));
        setNotice("Saved to your library on this device.");
        return next;
      } catch {
        setNotice(
          "Device storage is full or unavailable. Export a project to keep a copy.",
        );
        return previous;
      }
    });
  }
  async function chooseFolder() {
    try {
      const picker = (window as any).showDirectoryPicker;
      if (!picker) {
        setNotice(
          "Folder access is unavailable in this browser. Use Import song to select one or more files.",
        );
        file.current?.click();
        return;
      }
      const dir = await picker({ mode: "read" });
      let count = 0;
      for await (const entry of dir.values()) {
        if (
          entry.kind === "file" &&
          /\.(mid|midi|json|xml|musicxml)$/i.test(entry.name)
        ) {
          await importFile(await entry.getFile());
          count++;
          if (count >= 50) break;
        }
      }
      setNotice(
        count
          ? `Imported ${count} files from your chosen folder (up to 50). Re-open the folder to refresh; background scanning is not enabled.`
          : "No MIDI, MusicXML or Piano project files found in this folder.",
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setNotice("Could not open that folder. Try Import song instead.");
    }
  }
  async function importFile(f?: File) {
    if (!f) return;
    try {
      if (f.size > 10 * 1024 * 1024)
        throw Error("Please choose a song file smaller than 10 MB.");
      if (/\.(musicxml|xml)$/i.test(f.name)) {
        const result = parseMusicXml(await f.text());
        const imported = { ...result.song, id: crypto.randomUUID() };
        select(imported);
        save(imported);
        setPage("prepare");
        setNotice(
          result.warnings.length
            ? result.warnings.join(" ")
            : "Score imported with playable notes, hands and printed fingerings.",
        );
        if(file.current)file.current.value="";
        return;
      }
      let s: Song;
      if (f.name.endsWith(".json")) {
        s = { ...parseProject(await f.text()), id: crypto.randomUUID() };
      } else {
        s = parseMidi(await f.arrayBuffer());
        s.title = f.name.replace(/\.mid(i)?$/i, "");
      }
      select(s);
      save(s);
      setPage("prepare");
      setNotice(
        f.name.endsWith(".json")
          ? "Practice project imported with its saved hands and fingerings."
          : "MIDI imported. Hands are estimated by pitch; check the split before practising.",
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not read this song file.",
      );
    }
    if (file.current) file.current.value = "";
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
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, song })], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = song.title + ".piano.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const low = Math.min(48, ...notes.map((n) => n.pitch)),
    high = Math.max(83, ...notes.map((n) => n.pitch)),
    keys = Array.from({ length: high - low + 1 }, (_, i) => low + i),
    width = 100 / keys.length;
  const waiting =
    mode === "melody" && playing
      ? notes.find((n) => !matched.current.has(n.id) && n.start <= time + 0.02)
      : undefined;
  return (
    <div className="shell">
      <aside>
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
          ].map(([id, label, Icon]: any) => (
            <button
              key={id}
              className={page === id ? "nav active" : "nav"}
              onClick={() => {
                reset();
                setPage(id);
              }}
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
        <header>
          <div className="breadcrumb">
            Your workspace <ChevronRight size={14} />{" "}
            <span>
              {page === "practice"
                ? "Practice room"
                : page === "prepare"
                  ? "Prepare a song"
                  : "My library"}
            </span>
          </div>
          <button className="device" onClick={connect}>
            <span
              className={
                midiStatus.includes("connected")
                  ? "status-dot connected"
                  : "status-dot"
              }
            />
            {midiStatus}
            <ChevronRight size={14} />
          </button>
        </header>
        <input
          ref={file}
          hidden
          multiple
          type="file"
          accept=".mid,.midi,.json,.xml,.musicxml"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []).sort(
              (a, b) =>
                Number(/\.(xml|musicxml)$/i.test(a.name)) -
                Number(/\.(xml|musicxml)$/i.test(b.name)),
            );
            for (const f of files) await importFile(f);
          }}
        />
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">MAKE ROOM FOR MUSIC</div>
              <h1>
                {page === "practice"
                  ? "One note closer."
                  : page === "prepare"
                    ? "Make it your own."
                    : "Your next favorite piece."}
              </h1>
              <p>
                {page === "practice"
                  ? "Slow it down. Find your rhythm. Enjoy the practice."
                  : page === "prepare"
                    ? "Turn a whole piece into a passage you can master."
                    : "A small collection. Endless possibilities."}
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
          {page === "library" ? (
            <>
              <div className="section-title">
                <h2>On your music stand</h2>
                <button className="button light" onClick={chooseFolder}>
                  Open song folder
                </button>
                <span>{songs.length + 1} pieces</span>
              </div>
              <div className="song-grid">
                {[demoSong, ...songs].map((s, i) => (
                  <button
                    className="song-card"
                    key={s.id}
                    onClick={() => {
                      select(s);
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
                    reset();
                    setPage("library");
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
                            select(
                              trimScoreMeasures(
                                song,
                                firstMeasure,
                                lastMeasure,
                              ),
                            );
                            setNotice(
                              "Passage created. Score and playback trimmed together; original stays in your library.",
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
                            const s = trimSong(song, from, to);
                            s.id = crypto.randomUUID();
                            s.title = song.title + " · passage";
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
                  <button className="button" onClick={() => save(song)}>
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
              <div className="practice-grid">
                <section className="stage-card">
                  <div className="stage-top">
                    <span>
                      <span className="live-dot" />
                      {waiting
                        ? "Your turn · " + noteName(waiting.pitch)
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
                  <div className="roll" style={{ height: 310 }}>
                    <div className="roll-label">
                      {mode === "melody"
                        ? "PLAY THE HIGHLIGHTED NOTES"
                        : "LISTEN • LEARN • REPEAT"}
                    </div>
                    {keys.map((p) => (
                      <div
                        className="lane"
                        key={p}
                        style={{
                          left: (p - low) * width + "%",
                          width: width + "%",
                          background: [1, 3, 6, 8, 10].includes(p % 12)
                            ? "#ffffff02"
                            : "transparent",
                        }}
                      />
                    ))}
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        className="beat-line"
                        key={i}
                        style={{ bottom: i * 75 + 20 }}
                      />
                    ))}
                    {notes
                      .filter(
                        (n) =>
                          n.start - time < 4.1 &&
                          n.start + n.duration - time > -0.1,
                      )
                      .map((n) => (
                        <div
                          title={noteName(n.pitch)}
                          key={n.id}
                          className={"fall-note " + n.hand}
                          style={{
                            left: (n.pitch - low) * width + 0.15 + "%",
                            width: Math.max(0.4, width - 0.3) + "%",
                            bottom: (n.start - time) * 70 + 20,
                            height: Math.max(8, n.duration * 70),
                          }}
                        >
                          {n.finger
                            ? String(n.finger)
                            : width > 2.3
                              ? noteName(n.pitch).replace(/\d/g, "")
                              : ""}
                        </div>
                      ))}
                    <div className="strike-line" />
                  </div>
                  <div className="keyboard">
                    {keys.map((p) => (
                      <button
                        aria-label={"Play " + noteName(p)}
                        key={p}
                        onPointerDown={() => input(p)}
                        className={
                          ([1, 3, 6, 8, 10].includes(p % 12)
                            ? "black"
                            : "white") + (pressed.includes(p) ? " pressed" : "")
                        }
                        style={{ width: width + "%" }}
                      >
                        {p % 12 === 0 ? <span>{noteName(p)}</span> : null}
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
                      aria-label={playing ? "Pause" : "Play"}
                      onClick={() => {
                        if (playing) silence();
                        if (time >= total) reset();
                        audio ??= new AudioContext();
                        void audio.resume();
                        setPlaying(!playing);
                      }}
                    >
                      {playing ? <Pause size={20} /> : <Play size={20} />}
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
                      onClick={() => setMuted(!muted)}
                    >
                      <Volume2 size={19} />
                    </button>
                  </div>
                </section>
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
                        onClick={() => {
                          reset();
                          setHand(id);
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
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  />
                  <div className="speed-presets">
                    {[25, 50, 75, 100].map((v) => (
                      <button
                        key={v}
                        className={speed === v ? "chosen" : ""}
                        onClick={() => setSpeed(v)}
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
                      "Melody practice",
                      "The music waits for your next note.",
                    ],
                  ].map(([id, title, desc]) => (
                    <button
                      key={id}
                      className={"mode " + (mode === id ? "selected" : "")}
                      onClick={() => {
                        reset();
                        setMode(id);
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
                    Coming next: rhythm & recital scoring.
                  </p>
                </section>
              </div>
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
                    reset();
                    setPage(page === "prepare" ? "practice" : "prepare");
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
          <footer>
            <span>
              Piano studio <span className="footer-dot">•</span> Made for the
              joy of learning
            </span>
            <span>Your music stays on this device</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
