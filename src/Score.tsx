import { useEffect, useRef, useState } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
export function Score({
  xml,
  editable = false,
}: {
  xml?: string;
  editable?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!xml || !el.current) return;
    let cancelled = false;
    const osmd = new OpenSheetMusicDisplay(el.current, {
      autoResize: true,
      drawTitle: true,
      drawingParameters: "compacttight",
    });
    setError("");
    osmd
      .load(xml)
      .then(() => {
        if (!cancelled) osmd.render();
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "This score could not be rendered. Your MIDI practice is still available.",
          );
      });
    return () => {
      cancelled = true;
      osmd.clear();
    };
  }, [xml]);
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
      {error && <p role="alert">{error}</p>}
      {xml ? (
        <div className="score-sheet" ref={el} />
      ) : (
        <p className="score-empty">
          Import MusicXML or a Piano project with a score to read along. MIDI files
          contain performance notes, not printed score layout.
        </p>
      )}
    </section>
  );
}
