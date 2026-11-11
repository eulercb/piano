/** Numeric quarter-note tempo from the same source timeline as playback. */
export type TempoSegment = { beat: number; seconds: number; bpm: number };

/**
 * Quarter-note clock, with optional source-derived tempo changes. Advance only
 * with active transport time already scaled by practice speed. The caller owns
 * pauses and frame-gap rejection. Missed beats are never queued, and changes
 * of tempo preserve fractional beat phase rather than starting another click.
 */
export class PracticeMetronome {
  private elapsedBeats = 0;
  private lastBeat = -1;

  constructor(private readonly tempo: number, private readonly map?: readonly TempoSegment[]) {}

  private segmentAt(seconds: number): TempoSegment {
    if (!this.map?.length) return { beat: 0, seconds: 0, bpm: this.tempo };
    let low = 0, high = this.map.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.map[middle].seconds <= seconds) low = middle;
      else high = middle - 1;
    }
    return this.map[low];
  }

  private beatsAt(seconds: number, segment = this.segmentAt(seconds)): number {
    return segment.beat + (seconds - segment.seconds) * segment.bpm / 60;
  }

  reset() {
    this.elapsedBeats = 0;
    this.lastBeat = -1;
  }

  advance(sourceSeconds: number, fromPosition: number, toPosition: number): boolean {
    const delta = Math.max(0, sourceSeconds);
    const moved = Math.min(delta, Math.max(0, toPosition - fromPosition));
    const end = fromPosition + moved, segment = this.segmentAt(end);
    // During a Melody wait, continue at the stopped score position's tempo.
    // Do not use elapsed wall time to cross future score tempo marks.
    this.elapsedBeats += this.beatsAt(end, segment) - this.beatsAt(fromPosition)
      + (delta - moved) * segment.bpm / 60;
    const beat = Math.floor(this.elapsedBeats + 1e-8);
    if (beat <= this.lastBeat) return false;
    this.lastBeat = beat;
    return true;
  }
}
