import { describe, expect, it, vi } from "vitest";
import {
  MidiInputController, midiNoteOn, midiStatusText,
  type MidiAccess, type MidiInputPort, type MidiSnapshot, type RequestMidiAccess,
} from "./midiInput";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
// Only these two helpers emulate browser event objects. No browser permissions or hardware are used.
function message(handler: MIDIInput["onmidimessage"], port: MidiInputPort, data: number[]) {
  handler?.call(port as MIDIInput, { data: new Uint8Array(data) } as MIDIMessageEvent);
}
function stateChange(handler: MIDIAccess["onstatechange"], access: MidiAccess) {
  handler?.call(access as MIDIAccess, {} as MIDIConnectionEvent);
}
class FakeInput implements MidiInputPort {
  state: MIDIPortDeviceState = "connected";
  connection: MIDIPortConnectionState = "closed";
  onmidimessage: MIDIInput["onmidimessage"] = null;
  changed = () => {};
  open = vi.fn(async () => { this.connection = "open"; this.changed(); });
  close = vi.fn(async () => { this.connection = "closed"; this.changed(); });
  constructor(readonly id: string, readonly name: string | null = "USB Piano", readonly manufacturer: string | null = "Casio") {}
  emit(data = [0x90, 60, 90]) { message(this.onmidimessage, this, data); }
}
class FakeAccess implements MidiAccess {
  inputs = new Map<string, FakeInput>();
  onstatechange: MIDIAccess["onstatechange"] = null;
  constructor(...inputs: FakeInput[]) { inputs.forEach((input) => this.add(input, false)); }
  changed() { stateChange(this.onstatechange, this); }
  add(input: FakeInput, notify = true) {
    this.inputs.set(input.id, input);
    input.changed = () => this.changed();
    if (notify) this.changed();
  }
  unplug(input: FakeInput, remove = true) {
    input.state = "disconnected";
    input.connection = "closed";
    if (remove) this.inputs.delete(input.id);
    this.changed();
  }
}
function setup(access = new FakeAccess(), request: RequestMidiAccess | undefined = vi.fn(async () => access)) {
  const onState = vi.fn<(snapshot: MidiSnapshot) => void>();
  const onNote = vi.fn<(pitch: number) => void>();
  const controller = new MidiInputController(request, onState, onNote);
  return { access, request, onState, onNote, controller };
}

describe("MIDI message parsing", () => {
  it("accepts note-ons on every channel, including boundary pitches", () => {
    for (let channel = 0; channel < 16; channel++)
      expect(midiNoteOn(new Uint8Array([0x90 + channel, 60, 1]))).toBe(60);
    expect(midiNoteOn(new Uint8Array([0x90, 0, 1]))).toBe(0);
    expect(midiNoteOn(new Uint8Array([0x90, 127, 127]))).toBe(127);
  });
  it.each([null, [], [0x90], [0x90, 60], [0x90, 60, 0], [0x80, 60, 90],
    [0xb0, 64, 127], [0xf8], [0xf0, 60, 70], [0x90, 128, 90], [0x90, 60, 128], [0x90, 60, 90, 0]])
  ("ignores releases, controllers, realtime and malformed messages: %j", (bytes) => {
    expect(midiNoteOn(bytes === null ? null : new Uint8Array(bytes))).toBeNull();
  });
});

describe("MIDI connection and selection", () => {
  it("requests permission only on connect, without sysex, and automatically opens a sole input", async () => {
    const piano = new FakeInput("piano");
    const { controller, request, onNote } = setup(new FakeAccess(piano));
    expect(request).not.toHaveBeenCalled();
    expect(controller.snapshot.status).toBe("idle");
    await controller.connect(); await settle();
    expect(request).toHaveBeenCalledExactlyOnceWith({ sysex: false });
    expect(piano.open).toHaveBeenCalledTimes(1);
    expect(controller.snapshot).toMatchObject({ status: "connected", selectedId: "piano", selectedName: "Casio · USB Piano" });
    piano.emit();
    expect(onNote).toHaveBeenCalledExactlyOnceWith(60);
    expect(controller.snapshot).toMatchObject({ lastNote: 60, noteCount: 1 });
    piano.emit([0x90, 60, 0]);
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit choice with several inputs and ignores the same note on unselected devices", async () => {
    const piano = new FakeInput("piano"), other = new FakeInput("other");
    const { controller, onNote } = setup(new FakeAccess(piano, other));
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("choosing");
    expect(controller.snapshot.inputs.map((input) => input.label)).toEqual(["Casio · USB Piano (1)", "Casio · USB Piano (2)"]);
    expect(piano.open).not.toHaveBeenCalled();
    expect(other.open).not.toHaveBeenCalled();
    piano.emit(); other.emit();
    expect(onNote).not.toHaveBeenCalled();
    controller.select("piano");
    await settle();
    other.emit();
    expect(onNote).not.toHaveBeenCalled();
    piano.emit();
    expect(onNote).toHaveBeenCalledExactlyOnceWith(60);
  });

  it("switches inputs, clears activity and ignores queued messages from the old input", async () => {
    const first = new FakeInput("first"), second = new FakeInput("second");
    const { controller, onNote } = setup(new FakeAccess(first, second));
    await controller.connect(); await settle();
    controller.select("first"); await settle();
    first.emit();
    const staleHandler = first.onmidimessage;
    controller.select("second"); await settle();
    expect(first.onmidimessage).toBeNull();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(controller.snapshot).toMatchObject({ selectedId: "second", lastNote: null, noteCount: 0 });
    message(staleHandler, first, [0x90, 60, 90]);
    first.emit();
    expect(onNote).toHaveBeenCalledTimes(1);
    second.emit([0x91, 62, 80]);
    expect(onNote).toHaveBeenLastCalledWith(62);
    controller.select("");
    expect(second.onmidimessage).toBeNull();
    expect(controller.snapshot).toMatchObject({ status: "choosing", selectedId: null });
  });

  it("ignores missing selections and repeated selection of the current port", async () => {
    const piano = new FakeInput("piano");
    const { controller } = setup(new FakeAccess(piano));
    controller.select("piano");
    expect(piano.open).not.toHaveBeenCalled();
    await controller.connect(); await settle();
    controller.select("missing"); controller.select("piano");
    expect(controller.snapshot.selectedId).toBe("piano");
    expect(piano.open).toHaveBeenCalledTimes(1);
  });

  it("can clear an unplugged selection without automatically reopening it when it returns", async () => {
    const piano = new FakeInput("piano");
    const { controller, access } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    access.unplug(piano); await settle();
    controller.select("");
    expect(controller.snapshot).toMatchObject({ status: "no-inputs", selectedId: null, selectedName: "" });
    const replacement = new FakeInput("piano");
    access.add(replacement); await settle();
    expect(controller.snapshot).toMatchObject({ status: "choosing", selectedId: null });
    expect(replacement.open).not.toHaveBeenCalled();
  });

  it("shows unavailable support, denied permission and retryable request errors", async () => {
    const unavailable = new MidiInputController(undefined, vi.fn(), vi.fn());
    await unavailable.connect();
    expect(unavailable.snapshot.status).toBe("unavailable");
    expect(midiStatusText(unavailable.snapshot)).toContain("HTTPS");
    const request = vi.fn<RequestMidiAccess>()
      .mockRejectedValueOnce({ name: "NotAllowedError" })
      .mockRejectedValueOnce({ name: "SecurityError" })
      .mockRejectedValueOnce(new Error("system failure"))
      .mockResolvedValueOnce(new FakeAccess());
    const { controller } = setup(undefined, request);
    for (const status of ["denied", "denied", "error", "no-inputs"]) {
      await controller.connect(); await settle();
      expect(controller.snapshot.status).toBe(status);
      expect(midiStatusText(controller.snapshot)).not.toBe("");
    }
  });

  it("handles a synchronous request exception and allows another explicit retry", async () => {
    const request = vi.fn<RequestMidiAccess>().mockImplementationOnce(() => { throw new Error("blocked"); })
      .mockResolvedValue(new FakeAccess());
    const { controller } = setup(undefined, request);
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("error");
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("no-inputs");
  });

  it("deduplicates repeated Connect clicks while permission is pending", async () => {
    const waiting = deferred<MidiAccess>();
    const request = vi.fn(() => waiting.promise);
    const { controller } = setup(undefined, request);
    const first = controller.connect(), second = controller.connect();
    expect(first).toBe(second);
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.status).toBe("requesting");
    waiting.resolve(new FakeAccess()); await first;
    expect(controller.snapshot.status).toBe("no-inputs");
  });
});

describe("MIDI hotplug and lifecycle cleanup", () => {
  it("keeps watching an empty input list without silently selecting later devices", async () => {
    const { controller, access } = setup();
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("no-inputs");
    const piano = new FakeInput("piano", null, null);
    access.add(piano);
    expect(controller.snapshot).toMatchObject({ status: "choosing", inputs: [{ id: "piano", label: "MIDI input 1" }] });
    expect(piano.open).not.toHaveBeenCalled();
    controller.select("piano"); await settle();
    expect(controller.snapshot.status).toBe("connected");
  });

  it.each([true, false])("marks unplugged ports disconnected whether or not the browser removes them (remove=%s)", async (remove) => {
    const piano = new FakeInput("piano"), other = new FakeInput("other", "Other");
    const { controller, access, onNote } = setup(new FakeAccess(piano, other));
    await controller.connect(); await settle(); controller.select("piano"); await settle();
    const staleHandler = piano.onmidimessage;
    access.unplug(piano, remove);
    expect(controller.snapshot).toMatchObject({ status: "disconnected", selectedId: "piano", noteCount: 0 });
    expect(controller.snapshot.inputs).toHaveLength(1);
    expect(piano.onmidimessage).toBeNull();
    expect(other.open).not.toHaveBeenCalled();
    message(staleHandler, piano, [0x90, 60, 90]); other.emit();
    expect(onNote).not.toHaveBeenCalled();
    const reconnected = new FakeInput("piano");
    access.add(reconnected); await settle();
    expect(controller.snapshot.status).toBe("connected");
    reconnected.emit();
    expect(onNote).toHaveBeenCalledExactlyOnceWith(60);
  });

  it("reopens the same port object on hotplug and never auto-switches to a different ID", async () => {
    const piano = new FakeInput("piano");
    const { controller, access } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    access.unplug(piano);
    access.add(new FakeInput("different"));
    expect(controller.snapshot.status).toBe("disconnected");
    piano.state = "connected";
    access.add(piano); await settle();
    expect(controller.snapshot).toMatchObject({ status: "connected", selectedId: "piano" });
    expect(piano.open).toHaveBeenCalledTimes(2);
  });

  it("detaches old access and input listeners when reconnecting, even if old events are already queued", async () => {
    const first = new FakeInput("piano"), second = new FakeInput("piano");
    const oldAccess = new FakeAccess(first), newAccess = new FakeAccess(second);
    const request = vi.fn<RequestMidiAccess>().mockResolvedValueOnce(oldAccess).mockResolvedValueOnce(newAccess);
    const { controller, onNote } = setup(undefined, request);
    await controller.connect(); await settle();
    const oldState = oldAccess.onstatechange, oldMessage = first.onmidimessage;
    await controller.connect(); await settle();
    expect(oldAccess.onstatechange).toBeNull();
    expect(first.onmidimessage).toBeNull();
    expect(first.close).toHaveBeenCalledTimes(1);
    stateChange(oldState, oldAccess); message(oldMessage, first, [0x90, 60, 90]);
    expect(controller.snapshot.status).toBe("connected");
    expect(onNote).not.toHaveBeenCalled();
    second.emit();
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnect", "dispose"] as const)("ignores permission resolution after %s", async (action) => {
    const waiting = deferred<MidiAccess>();
    const { controller, onState, onNote } = setup(undefined, () => waiting.promise);
    const connection = controller.connect();
    controller[action]();
    const stateCount = onState.mock.calls.length;
    const piano = new FakeInput("piano"), access = new FakeAccess(piano);
    waiting.resolve(access); await connection;
    expect(access.onstatechange).toBeNull();
    expect(piano.open).not.toHaveBeenCalled();
    expect(onState).toHaveBeenCalledTimes(stateCount);
    expect(onNote).not.toHaveBeenCalled();
  });

  it("ignores an older permission result after cancellation and a newer connection", async () => {
    const old = deferred<MidiAccess>();
    const current = new FakeAccess(new FakeInput("current"));
    const request = vi.fn<RequestMidiAccess>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(current);
    const { controller } = setup(undefined, request);
    const pending = controller.connect();
    controller.disconnect();
    await controller.connect(); await settle();
    const stale = new FakeAccess(new FakeInput("old"));
    old.resolve(stale); await pending;
    expect(stale.onstatechange).toBeNull();
    expect(controller.snapshot).toMatchObject({ status: "connected", selectedId: "current" });
  });

  it("ignores a stale rejection without clearing a newer pending request", async () => {
    const old = deferred<MidiAccess>(), current = deferred<MidiAccess>();
    const request = vi.fn<RequestMidiAccess>().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { controller } = setup(undefined, request);
    const pending = controller.connect(); controller.disconnect();
    const newer = controller.connect();
    old.reject({ name: "NotAllowedError" }); await pending;
    expect(controller.snapshot.status).toBe("requesting");
    expect(controller.connect()).toBe(newer);
    current.resolve(new FakeAccess()); await newer;
    expect(controller.snapshot.status).toBe("no-inputs");
  });

  it("cleans up listeners and ignores queued events after disposal", async () => {
    const piano = new FakeInput("piano");
    const { controller, access, onState, onNote, request } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    const staleState = access.onstatechange, staleMessage = piano.onmidimessage;
    controller.dispose();
    const stateCount = onState.mock.calls.length;
    expect(access.onstatechange).toBeNull(); expect(piano.onmidimessage).toBeNull();
    stateChange(staleState, access); message(staleMessage, piano, [0x90, 60, 90]);
    controller.select("piano"); await controller.connect(); await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledTimes(stateCount);
    expect(onNote).not.toHaveBeenCalled();
  });

  it("reports open failure without an automatic retry loop, and can explicitly retry", async () => {
    const piano = new FakeInput("piano");
    piano.open.mockRejectedValueOnce(new Error("device busy"));
    const { controller, access } = setup(new FakeAccess(piano));
    await controller.connect(); await settle(); await settle();
    expect(controller.snapshot.status).toBe("error");
    access.changed(); await settle();
    expect(piano.open).toHaveBeenCalledTimes(1);
    controller.select("piano"); await settle();
    expect(controller.snapshot.status).toBe("connected");
  });

  it.each(["closed", "pending"] as const)("reports a selected port becoming %s and ignores further notes", async (connection) => {
    const piano = new FakeInput("piano");
    const { controller, access, onNote } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    const oldMessage = piano.onmidimessage;
    piano.connection = connection; access.changed();
    expect(controller.snapshot.status).toBe("error");
    message(oldMessage, piano, [0x90, 60, 90]);
    expect(onNote).not.toHaveBeenCalled();
  });

  it("ignores close failures while still removing listeners", async () => {
    const piano = new FakeInput("piano");
    piano.close.mockRejectedValueOnce(new Error("device gone"));
    const { controller, access } = setup(new FakeAccess(piano));
    await controller.connect(); await settle(); controller.disconnect(); await settle();
    expect(controller.snapshot.status).toBe("disconnected");
    expect(access.onstatechange).toBeNull(); expect(piano.onmidimessage).toBeNull();
  });

  it.each(["disconnect", "dispose"] as const)("closes a port that finishes opening after %s", async (action) => {
    const piano = new FakeInput("piano"), opening = deferred<void>();
    piano.open.mockImplementationOnce(async () => { await opening.promise; piano.connection = "open"; });
    const { controller, onNote, onState } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("opening");
    controller[action]();
    const stateCount = onState.mock.calls.length;
    opening.resolve(); await settle();
    expect(piano.onmidimessage).toBeNull(); expect(piano.connection).toBe("closed");
    expect(onState).toHaveBeenCalledTimes(stateCount); expect(onNote).not.toHaveBeenCalled();
  });

  it("ignores a stale open after switching inputs", async () => {
    const first = new FakeInput("first"), second = new FakeInput("second"), opening = deferred<void>();
    first.open.mockImplementationOnce(async () => { await opening.promise; first.connection = "open"; });
    const { controller, onNote } = setup(new FakeAccess(first, second));
    await controller.connect(); await settle(); controller.select("first"); await settle(); controller.select("second"); await settle();
    opening.resolve(); await settle();
    expect(controller.snapshot).toMatchObject({ status: "connected", selectedId: "second" });
    expect(first.onmidimessage).toBeNull(); expect(first.connection).toBe("closed");
    first.emit(); second.emit();
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it("does not let a late open close a newer selection of the same port (A → B → A)", async () => {
    const first = new FakeInput("first"), second = new FakeInput("second"), opening = deferred<void>();
    first.open.mockImplementationOnce(async () => { await opening.promise; first.connection = "open"; });
    const { controller, onNote } = setup(new FakeAccess(first, second));
    await controller.connect(); await settle(); controller.select("first"); await settle(); controller.select("second"); controller.select("first"); await settle();
    opening.resolve(); await settle();
    expect(controller.snapshot).toMatchObject({ status: "connected", selectedId: "first" });
    expect(first.connection).toBe("open");
    first.emit(); second.emit();
    expect(onNote).toHaveBeenCalledExactlyOnceWith(60);
  });

  it("waits for a previous asynchronous close before reopening the same piano", async () => {
    const piano = new FakeInput("piano"), closing = deferred<void>();
    const { controller, onNote } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    piano.close.mockImplementationOnce(async () => {
      await closing.promise; piano.connection = "closed"; piano.changed();
    });
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("opening");
    expect(piano.open).toHaveBeenCalledTimes(1);
    piano.emit(); expect(onNote).not.toHaveBeenCalled();
    closing.resolve(); await settle();
    expect(piano.open).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.status).toBe("connected");
    piano.emit(); expect(onNote).toHaveBeenCalledExactlyOnceWith(60);
  });

  it("serializes asynchronous close/open when switching A → B → A", async () => {
    const first = new FakeInput("first"), second = new FakeInput("second"), closing = deferred<void>();
    const { controller, onNote } = setup(new FakeAccess(first, second));
    await controller.connect(); controller.select("first"); await settle();
    first.close.mockImplementationOnce(async () => {
      await closing.promise; first.connection = "closed"; first.changed();
    });
    controller.select("second"); await settle(); controller.select("first"); await settle();
    expect(controller.snapshot.status).toBe("opening");
    expect(first.open).toHaveBeenCalledTimes(1);
    closing.resolve(); await settle();
    expect(controller.snapshot).toMatchObject({ status: "connected", selectedId: "first" });
    first.emit(); second.emit();
    expect(onNote).toHaveBeenCalledExactlyOnceWith(60);
  });

  it("allows a newer open after a pending close rejects, without a retry loop", async () => {
    const piano = new FakeInput("piano"), closing = deferred<void>();
    const { controller } = setup(new FakeAccess(piano));
    await controller.connect(); await settle();
    piano.close.mockImplementationOnce(() => closing.promise);
    await controller.connect(); await settle();
    expect(controller.snapshot.status).toBe("opening");
    closing.reject(new Error("close failed")); await settle();
    expect(controller.snapshot.status).toBe("connected");
    expect(piano.open).toHaveBeenCalledTimes(2);
  });

});
