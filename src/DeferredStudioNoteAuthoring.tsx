import { useEffect, useRef, useState, type ComponentProps } from "react";
import { loadedStudioAuthoring, loadStudioAuthoring } from "./preparationModules";

type Editor = typeof import("./StudioNoteAuthoring").StudioNoteAuthoring;
type Props = ComponentProps<Editor>;

export function DeferredStudioNoteAuthoring(props: Props) {
  const [Editor, setEditor] = useState<Editor | undefined>(() => loadedStudioAuthoring()?.StudioNoteAuthoring);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    if (Editor) return;
    let cancelled = false;
    loadStudioAuthoring().then(module => {
      if (cancelled) return;
      setEditor(() => module.StudioNoteAuthoring);
    }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [Editor, attempt]);

  return (
    <section ref={region} aria-label="Note authoring tools" tabIndex={-1}>
      {Editor ? <Editor {...props} /> : <>
        <p role={failed ? "alert" : "status"}>
          {failed
            ? "Note authoring could not load. Your piece is unchanged. Retry to use these tools; you can still practise, save or export."
            : "Loading note authoring tools…"}
        </p>
        {(failed || attempt > 0) && <button
          type="button"
          className="button light"
          disabled={!failed}
          onClick={() => {
            // Disabling/removing a focused button can blur it to the document.
            // Move focus only on this explicit click, never on async completion.
            region.current?.focus();
            setFailed(false); setAttempt(value => value + 1);
          }}
        >Retry note authoring</button>}
      </>}
    </section>
  );
}
