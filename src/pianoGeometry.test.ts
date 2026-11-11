import { describe, expect, it } from "vitest";
import { fallingNoteGeometry, pianoKeyGeometry, ROLL_LOOKAHEAD_SECONDS } from "./pianoGeometry";

describe("shared piano geometry", () => {
  it.each([[48, 83], [43, 83], [46, 85], [0, 127], [1, 126], [61, 61], [60, 60]])(
    "tiles white keys and overlays accidentals without clipping for %i–%i", (low, high) => {
      const keys = pianoKeyGeometry(low, high), whites = keys.filter(key => !key.black);
      expect(keys[0].pitch).toBeLessThanOrEqual(low);
      expect(keys.at(-1)!.pitch).toBeGreaterThanOrEqual(high);
      expect(keys[0].black).toBe(false);
      expect(keys.at(-1)!.black).toBe(false);
      expect(keys[0].pitch).toBeGreaterThanOrEqual(0);
      expect(keys.at(-1)!.pitch).toBeLessThanOrEqual(127);
      expect(keys.map(key => key.pitch)).toEqual(Array.from({ length: keys.length }, (_, i) => keys[0].pitch + i));
      let edge = 0;
      for (const key of whites) {
        expect(key.left).toBeCloseTo(edge, 10);
        expect(key.width).toBeCloseTo(100 / whites.length, 10);
        edge = key.left + key.width;
      }
      expect(edge).toBeCloseTo(100, 10);
      for (const [i, key] of keys.entries()) {
        expect(key.left).toBeGreaterThanOrEqual(0);
        expect(key.left + key.width).toBeLessThanOrEqual(100 + 1e-10);
        if (!key.black) continue;
        const previous = keys[i - 1], next = keys[i + 1];
        expect(previous.black || next.black).toBe(false);
        expect(key.left + key.width / 2).toBeCloseTo(next.left, 10);
        expect(key.left + key.width / 2).toBeCloseTo(previous.left + previous.width, 10);
        expect(key.width / previous.width).toBeCloseTo(.64, 10);
      }
    },
  );

  it("has no accidental between E/F or B/C, and matches full-width endpoint coordinates", () => {
    const keys = pianoKeyGeometry(48, 83);
    expect(keys.filter(key => !key.black)).toHaveLength(21);
    expect(keys.filter(key => key.black)).toHaveLength(15);
    for (const pitch of [52, 59, 64, 71, 76]) {
      const left = keys.find(key => key.pitch === pitch)!;
      const right = keys.find(key => key.pitch === pitch + 1)!;
      expect(left.black || right.black).toBe(false);
      expect(left.left + left.width).toBeCloseTo(right.left, 10);
    }
  });

  it.each([320, 568, 844, 1024])("fills a %ipx usable surface with the same coordinates for keys and roll", width => {
    // Deterministic coordinate checks, not browser/mobile layout measurements.
    const white = pianoKeyGeometry(0, 127).filter(key => !key.black);
    expect(white[0].left / 100 * width).toBe(0);
    expect((white.at(-1)!.left + white.at(-1)!.width) / 100 * width).toBeCloseTo(width);
    expect(white.reduce((total, key) => total + key.width / 100 * width, 0)).toBeCloseTo(width);
  });
});

describe("falling-note boundary", () => {
  it.each([40, 80, 160, 310, 640])("places onset on the keyboard and scales duration identically in a %ipx roll", height => {
    const note = { start: 2, duration: .75 };
    const pixelsPerSecond = height / ROLL_LOOKAHEAD_SECONDS;
    const before = fallingNoteGeometry(note, 1.5);
    const onset = fallingNoteGeometry(note, 2);
    const after = fallingNoteGeometry(note, 2.25);
    expect(before.bottom / 100 * height).toBeCloseTo(.5 * pixelsPerSecond);
    expect(onset.bottom / 100 * height).toBe(0);
    expect(after.bottom / 100 * height).toBeCloseTo(-.25 * pixelsPerSecond);
    expect(onset.height / 100 * height).toBeCloseTo(.75 * pixelsPerSecond);
    const release = fallingNoteGeometry(note, 2.75);
    expect(release.bottom + release.height).toBeCloseTo(0);
  });

  it("uses the same travel scale for chords, repeats and the lookahead edge", () => {
    const chord = [1, 2].map(duration => fallingNoteGeometry({ start: 5, duration }, 4));
    expect(chord[0].bottom).toBe(chord[1].bottom);
    expect(chord[1].height).toBe(chord[0].height * 2);
    expect(fallingNoteGeometry({ start: ROLL_LOOKAHEAD_SECONDS, duration: 1 }, 0).bottom).toBe(100);
  });
});
