import { useEffect, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { loadScoreRenderer } from "./scoreRenderer";

type RenderState = {
  xml?: string;
  attempt: number;
  phase: "loading" | "ready" | "error";
};

export function Score({
  xml,
  editable = false,
}: {
  xml?: string;
  editable?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RenderState>({
    xml,
    attempt: 0,
    phase: "loading",
  });
  // A changed input must not briefly expose the previous score's error/ready state.
  const phase = state.xml === xml && state.attempt === attempt
    ? state.phase
    : "loading";

  useEffect(() => {
    if (!xml || !el.current) return;
    let cancelled = false;
    let osmd: OpenSheetMusicDisplay | undefined;
    // OSMD load() has no abort API. Give each load its own container so that a
    // late completion cannot write into a newer score's live container.
    const container = document.createElement("div");
    el.current.append(container);
    setState({ xml, attempt, phase: "loading" });

    const release = () => {
      // dispose() removes window listeners; clear() releases the loaded sheet.
      osmd?.dispose();
      osmd?.clear();
    };

    void (async () => {
      try {
        const { OpenSheetMusicDisplay } = await loadScoreRenderer();
        if (cancelled) return;
        osmd = new OpenSheetMusicDisplay(container, {
          // Do not let resize events render a score while its load is pending.
          autoResize: false,
          drawTitle: true,
          drawingParameters: "compacttight",
        });
        await osmd.load(xml);
        if (cancelled) return;
        osmd.render();
        osmd.AutoResizeEnabled = true;
        setState({ xml, attempt, phase: "ready" });
      } catch {
        if (!cancelled) {
          release();
          setState({ xml, attempt, phase: "error" });
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
  }, [xml, attempt]);

  return (
    <section className="score-panel">
      <div>
        <h3>Your reading score</h3>
        <p>
          {editable
            ? "Score-linked Studio: note edits, fingers, transposition and measure trimming update this score and playback together."
            : "Original score reference. Playback edits do not rewrite this attached score. Import MusicXML directly for score-linked editing."}
        </p>
      </div>
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
        <div className="score-sheet" ref={el} aria-busy={phase === "loading"} />
      ) : (
        <p className="score-empty">
          Import MusicXML or a Piano project with a score to read along. MIDI files
          contain performance notes, not printed score layout.
        </p>
      )}
    </section>
  );
}
