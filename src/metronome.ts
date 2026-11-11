/**
 * A plain steady quarter-note clock, not a score/meter/tempo-map follower.
 * Advance only with active transport time, scaled to the source tempo. The
 * caller owns pauses and frame-gap rejection. Missed beats are never queued.
 */
export class SteadyMetronome {
  private elapsed = 0;
  private lastBeat = -1;

  constructor(private readonly tempo: number) {}

  reset() {
    this.elapsed = 0;
    this.lastBeat = -1;
  }

  advance(sourceSeconds: number): boolean {
    this.elapsed += Math.max(0, sourceSeconds);
    const beat = Math.floor(this.elapsed * this.tempo / 60 + 1e-8);
    if (beat <= this.lastBeat) return false;
    this.lastBeat = beat;
    return true;
  }
}
