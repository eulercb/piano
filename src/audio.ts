/** Lightweight preview audio. Never queue voices on a stopped audio clock. */
export class PianoAudio {
  private context?: AudioContext;
  private voices = new Set<OscillatorNode>();
  private listeners = new Set<() => void>();
  private previewGeneration = 0;

  get running() { return this.context?.state === "running"; }

  private stateChanged = () => {
    if (this.running) return;
    this.silence();
    for (const listener of this.listeners) listener();
  };

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** A running context is ready synchronously; every other state needs resume. */
  ensureRunning(): boolean | Promise<boolean> {
    try {
      if (!this.context || this.context.state === "closed") {
        this.context?.removeEventListener("statechange", this.stateChanged);
        this.context = new AudioContext();
        this.context.addEventListener("statechange", this.stateChanged);
      }
      if (this.running) return true;
      const context = this.context;
      return context.resume().then(
        () => context === this.context && this.running,
        () => false,
      );
    } catch {
      return false;
    }
  }

  silence() {
    this.previewGeneration++;
    for (const voice of this.voices) {
      try { voice.stop(); } catch {}
    }
    this.voices.clear();
  }

  /** A user key can unlock audio, but a delayed unlock must not replay old keys. */
  preview(pitch: number) {
    const generation = ++this.previewGeneration, at = performance.now();
    const ready = this.ensureRunning();
    if (ready === true) this.sound(pitch);
    else if (ready !== false) void ready.then(running => {
      if (running && generation === this.previewGeneration && performance.now() - at < 180)
        this.sound(pitch);
    });
  }

  sound(p: number, d = 0.3, v = 0.3) {
    const audio = this.context;
    if (!audio || !this.running) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "triangle";
    o.frequency.value = 440 * 2 ** ((p - 69) / 12);
    g.gain.setValueAtTime(0, audio.currentTime);
    g.gain.linearRampToValueAtTime(v * 0.25, audio.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + Math.max(0.03, d));
    o.connect(g);
    g.connect(audio.destination);
    this.voices.add(o);
    o.onended = () => {
      this.voices.delete(o);
      o.disconnect();
      g.disconnect();
    };
    o.start();
    o.stop(audio.currentTime + Math.max(0.04, d));
  }

  dispose() {
    this.silence();
    this.listeners.clear();
    const context = this.context;
    this.context = undefined;
    context?.removeEventListener("statechange", this.stateChanged);
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}
