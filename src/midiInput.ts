/** The small part of Web MIDI used by practice. Tests supply ports without hardware. */
export interface MidiInputPort {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer: string | null;
  readonly state: MIDIPortDeviceState;
  readonly connection: MIDIPortConnectionState;
  onmidimessage: MIDIInput["onmidimessage"];
  open(): Promise<unknown>;
  close(): Promise<unknown>;
}
export interface MidiAccess {
  readonly inputs: { values(): IterableIterator<MidiInputPort> };
  onstatechange: MIDIAccess["onstatechange"];
}
export type RequestMidiAccess = (options: { sysex: false }) => Promise<MidiAccess>;
export type MidiStatus = "idle" | "requesting" | "unavailable" | "denied" | "error"
  | "no-inputs" | "choosing" | "opening" | "connected" | "disconnected";
export interface MidiInputChoice { id: string; label: string }
export interface MidiSnapshot {
  status: MidiStatus;
  inputs: MidiInputChoice[];
  selectedId: string | null;
  selectedName: string;
  hasAccess: boolean;
  lastNote: number | null;
  noteCount: number;
  error: string;
}
export function initialMidiSnapshot(): MidiSnapshot {
  return {
    status: "idle", inputs: [], selectedId: null, selectedName: "", hasAccess: false,
    lastNote: null, noteCount: 0, error: "",
  };
}
export function midiStatusText(state: MidiSnapshot): string {
  switch (state.status) {
    case "idle": return "Connect your USB piano, then allow MIDI access. On-screen keys also work.";
    case "requesting": return "Waiting for MIDI permission. Allow access in your browser, or cancel below.";
    case "unavailable": return "Web MIDI is unavailable. Open the HTTPS app in Chrome or Edge, or use the on-screen keys.";
    case "denied": return "MIDI access was denied. Allow MIDI in this site’s browser settings, then try again. On-screen keys still work.";
    case "error": return state.error;
    case "no-inputs": return "No MIDI inputs found. Check the piano’s power and USB-C/OTG cable, then choose it when it appears.";
    case "choosing": return "Choose a piano input. Only the selected input will be used for practice.";
    case "opening": return `Connecting to ${state.selectedName}…`;
    case "connected": return `Connected to ${state.selectedName}. Only this input is used for practice.`;
    case "disconnected": return state.selectedId
      ? `${state.selectedName} disconnected. Reconnect the same piano or choose another input.`
      : "Piano disconnected. Connect again when you’re ready; on-screen keys still work.";
  }
}

/** Accept complete note-on messages on any channel, never note-offs or velocity-zero releases. */
export function midiNoteOn(data: Uint8Array | null): number | null {
  if (!data || data.length !== 3 || (data[0] & 0xf0) !== 0x90
    || data[1] > 127 || data[2] === 0 || data[2] > 127) return null;
  return data[1];
}

type Binding = { port: MidiInputPort; handler: MIDIInput["onmidimessage"]; opened: boolean };

/** Owns one selected input, with no persistent device IDs or permission requests until connect(). */
export class MidiInputController {
  private state = initialMidiSnapshot();
  private access: MidiAccess | null = null;
  private stateListener: MIDIAccess["onstatechange"] = null;
  private binding: Binding | null = null;
  private requestVersion = 0;
  private pending: Promise<void> | null = null;
  private disposed = false;
  private closingPort = false;
  private portOperations = new WeakMap<MidiInputPort, Promise<void>>();

  constructor(
    private readonly requestAccess: RequestMidiAccess | undefined,
    private readonly onState: (state: MidiSnapshot) => void,
    private readonly onNote: (pitch: number) => void,
  ) {}

  get snapshot(): MidiSnapshot { return this.state; }

  private update(patch: Partial<MidiSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  private portOperation(port: MidiInputPort, operation: () => Promise<unknown> | undefined) {
    // Web MIDI close() is asynchronous. Serialize each port's lifecycle so an old
    // close can never shut down a newer selection of that same input.
    const pending = (this.portOperations.get(port) ?? Promise.resolve()).then(operation);
    this.portOperations.set(port, pending.then(() => {}, () => {}));
    return pending;
  }

  private close(port: MidiInputPort) {
    // Failed closes must not block a later explicit retry or leave a listener attached.
    void this.portOperation(port, () => {
      this.closingPort = true;
      try { return port.close(); }
      finally { this.closingPort = false; }
    });
  }

  private releaseInput() {
    const previous = this.binding;
    this.binding = null;
    if (!previous) return;
    if (previous.port.onmidimessage === previous.handler) previous.port.onmidimessage = null;
    this.close(previous.port);
  }

  private releaseAccess() {
    const access = this.access;
    this.access = null;
    if (access && access.onstatechange === this.stateListener) access.onstatechange = null;
    this.stateListener = null;
    this.releaseInput();
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    const version = ++this.requestVersion;
    this.releaseAccess();
    this.update({ status: "requesting", hasAccess: false, inputs: [], lastNote: null, noteCount: 0, error: "" });
    if (!this.requestAccess) {
      this.update({ status: "unavailable" });
      return Promise.resolve();
    }
    // Call synchronously inside the click handler so browser user activation is preserved.
    let request: Promise<MidiAccess>;
    try { request = this.requestAccess({ sysex: false }); }
    catch (error) { request = Promise.reject(error); }
    const pending = request.then((access) => {
      if (this.disposed || version !== this.requestVersion) return;
      this.access = access;
      this.stateListener = () => {
        if (!this.disposed && !this.closingPort && this.access === access && version === this.requestVersion)
          this.refreshInputs();
      };
      access.onstatechange = this.stateListener;
      this.update({ hasAccess: true });
      this.refreshInputs(true);
    }).catch((error: unknown) => {
      if (this.disposed || version !== this.requestVersion) return;
      const name = error && typeof error === "object" && "name" in error ? error.name : "";
      this.update({
        status: name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error",
        error: "Could not access MIDI. Check the USB connection and try again. On-screen keys still work.",
      });
    }).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  private refreshInputs(autoSelectSingle = false) {
    if (!this.access) return;
    const ports = [...this.access.inputs.values()].filter((port) => port.state === "connected");
    const inputs = ports.map((port, index) => ({
      id: port.id,
      label: [port.manufacturer?.trim(), port.name?.trim()].filter(Boolean).join(" · ")
        || `MIDI input ${index + 1}`,
    }));
    // Identical names still need distinct, human-readable options. IDs stay in memory only.
    for (const choice of inputs) {
      const matches = inputs.filter((other) => other.label === choice.label);
      if (matches.length > 1) matches.forEach((match, index) => { match.label += ` (${index + 1})`; });
    }
    this.update({ inputs });
    if (!this.state.selectedId && autoSelectSingle && ports.length === 1) {
      this.select(ports[0].id);
      return;
    }
    if (!this.state.selectedId) {
      this.update({ status: ports.length ? "choosing" : "no-inputs" });
      return;
    }
    const selected = ports.find((port) => port.id === this.state.selectedId);
    if (!selected) {
      this.releaseInput();
      this.update({ status: "disconnected", lastNote: null, noteCount: 0 });
      return;
    }
    this.update({ selectedName: inputs.find((input) => input.id === selected.id)!.label });
    if (this.binding?.port === selected) {
      if (this.binding.opened && selected.connection === "closed") {
        this.releaseInput();
        this.update({ status: "error", lastNote: null, noteCount: 0,
          error: "The MIDI input closed. Select your piano again or reconnect. On-screen keys still work." });
      }
      return;
    }
    // A failed open needs an explicit retry, not a statechange/close/retry loop.
    if (this.state.status !== "error") this.openInput(selected);
  }

  select(id: string) {
    if (this.disposed || !this.access) return;
    const port = [...this.access.inputs.values()].find((input) => input.id === id && input.state === "connected");
    if (id && !port) return;
    if (port === this.binding?.port) return;
    this.releaseInput();
    this.update({ selectedId: port?.id ?? null,
      selectedName: this.state.inputs.find((input) => input.id === id)?.label ?? "",
      lastNote: null, noteCount: 0, error: "" });
    if (port) this.openInput(port);
    else this.update({ status: this.state.inputs.length ? "choosing" : "no-inputs" });
  }

  private openInput(port: MidiInputPort) {
    this.releaseInput();
    const binding: Binding = { port, handler: null, opened: false };
    binding.handler = (event) => {
      if (this.disposed || this.binding !== binding || !binding.opened
        || port.state !== "connected" || port.connection !== "open") return;
      const pitch = midiNoteOn(event.data);
      if (pitch === null) return;
      this.update({ lastNote: pitch, noteCount: this.state.noteCount + 1 });
      this.onNote(pitch);
    };
    this.binding = binding;
    this.update({ status: "opening", lastNote: null, noteCount: 0, error: "" });
    const opening = this.portOperation(port, () => {
      if (!this.disposed && this.binding === binding) return port.open();
    });
    void opening.then(() => {
      // releaseInput() has already queued cleanup after this operation if it is stale.
      if (this.disposed || this.binding !== binding) return;
      if (port.state !== "connected") { this.refreshInputs(); return; }
      if (port.connection !== "open") throw new Error("MIDI input did not open");
      binding.opened = true;
      port.onmidimessage = binding.handler;
      this.update({ status: "connected" });
    }).catch(() => {
      if (this.disposed || this.binding !== binding) return;
      this.releaseInput();
      this.update({ status: "error", lastNote: null, noteCount: 0,
        error: "Could not open this MIDI input. Check the piano and cable, then select it again or reconnect." });
    });
  }

  disconnect() {
    ++this.requestVersion;
    this.pending = null;
    this.releaseAccess();
    this.update({ ...initialMidiSnapshot(), status: "disconnected" });
  }

  dispose() {
    this.disposed = true;
    this.disconnect();
  }
}
