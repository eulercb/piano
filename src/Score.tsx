import { safeDocument } from "./scoreSource";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { loadScoreRenderer } from "./scoreRenderer";
import type { Song } from "./music";
import { parseMusicXml } from "./musicxml";
import { ScoreCursorFollower, scorePlaybackMatches } from "./scoreCursor";
import "./scoreCursor.css";

type RenderState = {
  xml?: string;
  attempt: number;
  compact: boolean;
  phase: "loading" | "ready" | "error";
};

export function Score({
  xml,
  editable = false,
  sourceSong,
  playbackTime = 0,
  playing = false,
  compact = false,
}: {
  xml?: string;
  editable?: boolean;
  /** Full, unfiltered song, not the selected-hand or melody target list. */
  sourceSong?: Song;
  /** Position in the source song in seconds, already accounting for playback speed. */
  playbackTime?: number;
  playing?: boolean;
  /** Viewport-contained practice guide; Studio keeps the full explanation. */
  compact?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const renderer = useRef<OpenSheetMusicDisplay | undefined>(undefined);
  const follower = useRef<ScoreCursorFollower | undefined>(undefined);
  // Reading preferences are local to this mounted view, never written into a song.
  const [zoom, setZoom] = useState(100);
  const zoomRef = useRef(100);
  const redraw = useRef<(() => void) | undefined>(undefined);
  const [follow, setFollow] = useState(false);
  const [cursorReady, setCursorReady] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);
  const timeline = useMemo(() => {
    if (!xml || sourceSong?.scoreOrigin !== "musicxml" || sourceSong.scoreXml !== xml) return undefined;
    try {
      const parsed = parseMusicXml(xml);
      return scorePlaybackMatches(parsed.song.notes, sourceSong.notes) ? parsed.scoreTimeline : undefined;
    } catch { return undefined; }
  }, [xml, sourceSong?.scoreOrigin, sourceSong?.scoreXml, sourceSong?.notes]);
  const hasGraces = useMemo(() => timeline?.entries.some(entry => entry.grace), [timeline]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RenderState>({
    xml,
    attempt: 0,
    compact,
    phase: "loading",
  });
  // A changed input must not briefly expose the previous score's error/ready state.
  const phase = state.xml === xml && state.attempt === attempt && state.compact === compact
    ? state.phase
    : "loading";

  useEffect(() => {
    if (!xml || !el.current) return;
    let cancelled = false;
    let osmd: OpenSheetMusicDisplay | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    // OSMD load() has no abort API. Give each load its own container so that a
    // late completion cannot write into a newer score's live container.
    const container = document.createElement("div");
    el.current.append(container);
    setState({ xml, attempt, compact, phase: "loading" });

    const renderAgain = () => {
      clearTimeout(resizeTimer);
      if (cancelled || !osmd || renderer.current !== osmd) return;
      try {
        // OSMD replaces cursor objects during render(). Rebind and reposition it
        // even when React batches cursorReady=false/true into one update.
        follower.current?.dispose();
        follower.current = undefined;
        setCursorReady(false);
        const viewport = el.current;
        const scrollTop = viewport?.scrollTop ?? 0, scrollLeft = viewport?.scrollLeft ?? 0;
        osmd.Zoom = zoomRef.current / 100;
        osmd.render();
        if (viewport) { viewport.scrollTop = scrollTop; viewport.scrollLeft = scrollLeft; }
        setRenderVersion(value => value + 1);
      } catch {
        release();
        setState({ xml, attempt, compact, phase: "error" });
      }
    };
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderAgain, 120);
    };
    const release = () => {
      clearTimeout(resizeTimer);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      if (redraw.current === renderAgain) redraw.current = undefined;
      // dispose() removes window listeners; clear() releases the loaded sheet.
      if (renderer.current === osmd) {
        follower.current?.dispose();
        follower.current = undefined;
        renderer.current = undefined;
      }
      osmd?.dispose();
      osmd?.clear();
    };

    void (async () => {
      try {
        // OSMD.load(string) also accepts URLs. Never pass unvalidated cache or project data.
        safeDocument(xml);
        const scoreDocument = new DOMParser().parseFromString(xml, "application/xml");
        if (scoreDocument.querySelector("parsererror")) throw new Error("Invalid score XML");
        const { OpenSheetMusicDisplay } = await loadScoreRenderer();
        if (cancelled) return;
        osmd = new OpenSheetMusicDisplay(container, {
          // Do not let resize events render a score while its load is pending.
          autoResize: false,
          drawTitle: !compact,
          drawingParameters: "compacttight",
          // Cursor visibility is explicit. Never let OSMD scroll the outer page.
          disableCursor: false,
          followCursor: false,
          cursorsOptions: [{ type: 0, color: "#3578c8", alpha: 0.35, follow: false }],
        });
        await osmd.load(scoreDocument);
        if (cancelled) return;
        osmd.Zoom = zoomRef.current / 100;
        osmd.render();
        renderer.current = osmd;
        redraw.current = renderAgain;
        // OSMD's built-in auto-resize calls window.scrollTo(). Own resizing so
        // only the opt-in follower can scroll, and only inside the score pane.
        window.addEventListener("resize", resize);
        if (typeof ResizeObserver !== "undefined") {
          let width = container.clientWidth;
          observer = new ResizeObserver(entries => {
            const nextWidth = entries[0]?.contentRect.width;
            if (nextWidth !== undefined && Math.abs(nextWidth - width) > 1) {
              width = nextWidth;
              resize();
            }
          });
          observer.observe(container);
        }
        setState({ xml, attempt, compact, phase: "ready" });
      } catch {
        if (!cancelled) {
          release();
          setState({ xml, attempt, compact, phase: "error" });
        }
      } finally {
        // An in-flight load can repopulate internal sheet state after cleanup.
        if (cancelled) release();
      }
    })();

    return () => {
      cancelled = true;
      release();
      container.remove();
    };
  }, [xml, attempt, compact]);

  useEffect(() => {
    zoomRef.current = zoom;
    redraw.current?.();
  }, [zoom]);

  useEffect(() => {
    setCursorReady(false);
    const osmd = renderer.current;
    if (!timeline || phase !== "ready" || !osmd || !el.current) return;
    let active: ScoreCursorFollower | undefined;
    try {
      active = new ScoreCursorFollower(osmd.cursor, timeline, el.current);
      follower.current = active;
      setCursorReady(true);
    } catch {
      // Engraving remains useful even if a renderer cannot map a cursor.
      osmd.cursor?.hide();
    }
    return () => {
      active?.dispose();
      if (follower.current === active) follower.current = undefined;
    };
  }, [timeline, phase, xml, attempt, compact, renderVersion]);

  useEffect(() => {
    if (phase !== "ready") return;
    try {
      follower.current?.position(playbackTime, follow && playing);
    } catch {
      // A cursor failure must not stop playback or remove the readable score.
      follower.current?.dispose();
      follower.current = undefined;
      setCursorReady(false);
    }
  }, [playbackTime, follow, playing, phase, cursorReady, timeline, renderVersion]);

  // Enabling follow is explicit; pausing/seeking/loading never scrolls the page.
  useEffect(() => {
    if (follow && playing && cursorReady) follower.current?.reveal();
  }, [follow, playing, cursorReady, renderVersion]);

  const measureIndex = timeline?.measures.findIndex((measure, index, all) =>
    playbackTime >= measure.start && (index === all.length - 1 || playbackTime < all[index + 1].start));
  const synchronized = !!timeline && cursorReady && phase === "ready";

  return (
    <section className={compact ? "score-panel compact-score" : "score-panel"}>
      {!compact && <div>
        <h3>Your reading score</h3>
        <p>
          {editable
            ? "Score-linked Studio: note edits, fingers, transposition and measure trimming update this score and playback together."
            : "Original score reference. Playback edits do not rewrite this attached score. Import MusicXML directly for score-linked editing."}
        </p>
      </div>
      }
      {xml && <div className="score-reading-controls" role="group" aria-label="Reading controls" tabIndex={compact ? 0 : undefined}>
          <div className="score-size-controls" role="group" aria-label="Reading score size">
            <label>Score size
              <select value={zoom} disabled={phase !== "ready"} onChange={event => setZoom(Number(event.target.value))}>
                {[75, 100, 125, 150, 175, 200].map(value => <option key={value} value={value}>{value}%</option>)}
              </select>
            </label>
            <button type="button" disabled={phase !== "ready" || zoom === 100} onClick={() => setZoom(100)}>Reset size</button>
          </div>
        {sourceSong && phase === "ready" && (
          <div className="score-follow-controls">
            {synchronized ? <>
              <p className="score-position">Reading position: measure {(measureIndex ?? -1) + 1 || 1} of {timeline.measures.length}</p>
              <label>
                <input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />
                Follow score while playing
              </label>
              {!compact && <p className="score-follow-hint">The blue cursor follows written positions. Scrolling is off until you enable it.
                {hasGraces && " Grace notes share their principal written position; their playback timing is approximate."}
              </p>}
            </> : <p className="score-follow-hint">Playback cursor unavailable for this score. Direct MusicXML imports with matching playback support synchronized reading.</p>}
          </div>
        )}
      </div>}
      {xml && phase === "loading" && <p role="status">Loading reading score…</p>}
      {xml && phase === "error" && (
        <div>
          <p role="alert">
            This score could not be rendered. Your MIDI practice is still available.
          </p>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>
            Retry score
          </button>
        </div>
      )}
      {xml ? (
        <div className="score-sheet score-follow-viewport" ref={el} role="region" aria-label="Reading score" tabIndex={0} aria-busy={phase === "loading"} />
      ) : (
        <p className="score-empty">
          Import MusicXML or a Piano project with a score to read along. MIDI files
          contain performance notes, not printed score layout.
        </p>
      )}
    </section>
  );
}
