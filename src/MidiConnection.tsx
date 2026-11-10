import { useEffect, useRef, useState } from "react";
import { MidiInputController, initialMidiSnapshot, midiStatusText } from "./midiInput";

const noteName = (pitch: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]
  + (Math.floor(pitch / 12) - 1);

export function MidiConnection({ onNote }: { onNote: (pitch: number) => void }) {
  const [state, setState] = useState(initialMidiSnapshot);
  const controller = useRef<MidiInputController | null>(null);
  const noteCallback = useRef(onNote);
  noteCallback.current = onNote;
  useEffect(() => {
    const midi = new MidiInputController(
      typeof navigator.requestMIDIAccess === "function"
        ? (options) => navigator.requestMIDIAccess(options)
        : undefined,
      setState,
      (pitch) => noteCallback.current(pitch),
    );
    controller.current = midi;
    return () => { controller.current = null; midi.dispose(); };
  }, []);
  const requesting = state.status === "requesting";
  const missingSelection = state.selectedId && !state.inputs.some((input) => input.id === state.selectedId);
  return (
    <section className="midi-device" aria-label="Piano connection">
      <div className="midi-actions">
        <button className="device" disabled={requesting} onClick={() => { void controller.current?.connect(); }}>
          <span className={state.status === "connected" ? "status-dot connected" : "status-dot"} aria-hidden="true" />
          {requesting ? "Connecting…" : state.hasAccess ? "Reconnect piano" : "Connect piano"}
        </button>
        {(state.hasAccess || requesting) && (
          <button className="device" onClick={() => controller.current?.disconnect()}>
            {requesting ? "Cancel connection" : "Disconnect"}
          </button>
        )}
      </div>
      <p id="midi-status" className="midi-status" role="status">{midiStatusText(state)}</p>
      {state.hasAccess && (
        <>
          <label className="midi-input-label" htmlFor="midi-input">Piano input</label>
          <select id="midi-input" value={state.selectedId ?? ""} aria-describedby="midi-status"
            onChange={(event) => controller.current?.select(event.target.value)}>
            <option value="">{state.inputs.length ? "Choose a MIDI input" : "No MIDI inputs available"}</option>
            {missingSelection && <option value={state.selectedId!}>{state.selectedName} (disconnected)</option>}
            {state.inputs.map((input) => <option key={input.id} value={input.id}>{input.label}</option>)}
          </select>
        </>
      )}
      {state.status === "connected" && (
        <p className="midi-activity" aria-live="off">
          <span key={state.noteCount} className={state.noteCount ? "midi-pulse received" : "midi-pulse"} aria-hidden="true" />
          {state.lastNote === null ? "Play a key to test input."
            : `Last note: ${noteName(state.lastNote)} · ${state.noteCount} ${state.noteCount === 1 ? "note" : "notes"} received`}
        </p>
      )}
    </section>
  );
}
