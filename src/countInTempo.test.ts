import { describe, expect, it } from "vitest";
import type { Song } from "./music";
import { parseMusicXml } from "./musicxml";
import { songTempoMap } from "./songTempo";
import { PracticeSession, type SessionOptions } from "./session";

// Original synthetic source timeline: 120 BPM, then 60 at 2s, then 240 at 6s.
const song: Song = {
  id: "count-in-tempos", title: "Synthetic count-in", tempo: 120, duration: 9,
  midiTempoMap: [
    { seconds: 0, microsecondsPerQuarter: 500000 },
    { seconds: 2, microsecondsPerQuarter: 1000000 },
    { seconds: 6, microsecondsPerQuarter: 250000 },
  ],
  notes: [{ id: "target", pitch: 60, start: 2, duration: 0.5, velocity: 0.7, hand: "right", finger: 3 }],
};
const tempoMap = songTempoMap(song);
const make = (options: Partial<SessionOptions> = {}, startAt = 0) => new PracticeSession({
  notes: song.notes, duration: 9, tempo: 120, hand: "right", mode: "listen",
  countIn: true, metronome: true, tempoMap, ...options,
}, startAt);

describe("count-in at the actual source start", () => {
  it.each([[0, 120], [1.999, 120], [2, 60], [2.125, 60], [6, 240]])(
    "counts at the active tempo when starting at %ss (%s BPM)", (start, bpm) => {
      const session = make({}, start), original = JSON.stringify(session.options);
      session.start();
      for (let i = 0; i < 4; i++) {
        expect(session.advance(i ? 60 / bpm : 0, 100, false)).toMatchObject({ countBeats: [i + 1], metronomeBeat: false, audioNotes: [] });
        expect(session.position).toBe(start);
      }
      expect(session.advance(60 / bpm, 100, false).metronomeBeat).toBe(true);
      expect(session.countingIn).toBe(false);
      expect(session.position).toBe(start);
      expect(JSON.stringify(session.options)).toBe(original);
    },
  );

  it.each([25, 50, 125])("scales a range's four 60-BPM beats at %s%% without crossing future source tempos", speed => {
    const session = make({ range: { start: 2, end: 8 } });
    const beat = 100 / speed;
    session.start();
    for (let i = 0; i < 4; i++) {
      expect(session.advance(i ? beat : 0, speed, false)).toMatchObject({ countBeats: [i + 1], metronomeBeat: false, audioNotes: [] });
      expect(session.position).toBe(2);
    }
    expect(session.advance(beat, speed, false).audioNotes).toEqual(song.notes);
    expect(session.countingIn).toBe(false);
    expect(session.position).toBe(2);
  });

  it("carries only post-count-in fractional frame time into playback and metronome", () => {
    const session = make({ range: { start: 2, end: 8 } });
    session.start(); session.advance(0, 50, false);
    expect(session.advance(7.9, 50, false).metronomeBeat).toBe(false);
    expect(session.position).toBe(2);
    expect(session.advance(0.3, 50, false)).toMatchObject({ metronomeBeat: true, audioNotes: song.notes });
    expect(session.position).toBeCloseTo(2.1);
    expect(session.advance(1.79, 50, false).metronomeBeat).toBe(false);
    expect(session.advance(0.01, 50, false).metronomeBeat).toBe(true);
  });

  it("preserves a partial count through pause/interruption and changes speed without reselecting tempo", () => {
    const session = make({ range: { start: 2, end: 8 } });
    session.start(); session.advance(0, 50, false);
    expect(session.advance(1, 50, false).countBeats).toEqual([]);
    session.pause();
    expect(session.advance(100, 100, false).countBeats).toEqual([]);
    session.start();
    expect(session.advanceFrame(20, 100, false).interrupted).toBe(true);
    session.start();
    expect(session.advance(0.49, 100, false).countBeats).toEqual([]);
    expect(session.advance(0.01, 100, false).countBeats).toEqual([2]);
    expect(session.position).toBe(2);
  });

  it("reselects tempo after a seek and returns to range-start tempo on repeat and restart", () => {
    const session = make({ range: { start: 2, end: 8 } }, 6);
    session.start();
    expect(session.advance(1, 100, true).metronomeBeat).toBe(true); // Four 240-BPM beats.
    expect(session.position).toBe(6);
    expect(session.advance(2, 100, true)).toMatchObject({ looped: true, metronomeBeat: false });
    expect(session.pass).toBe(2); expect(session.position).toBe(2);
    expect(session.advance(0, 100, true).countBeats).toEqual([1]);
    expect(session.advance(0.5, 100, true).countBeats).toEqual([]);
    expect(session.advance(0.5, 100, true).countBeats).toEqual([2]);
    session.restart(6); session.start();
    expect(session.advance(0.75, 100, false).countBeats).toEqual([1, 2, 3, 4]);
    expect(session.countingIn).toBe(true);
    expect(session.advance(0.25, 100, false).metronomeBeat).toBe(true);
    session.restart(); session.start();
    session.advance(3.99, 100, false); expect(session.countingIn).toBe(true);
    session.advance(0.01, 100, false); expect(session.countingIn).toBe(false);
    session.restart(99); session.start(); // Starting at the endpoint restarts the range.
    expect(session.position).toBe(2);
    session.advance(3.99, 100, false); expect(session.countingIn).toBe(true);
  });

  it.each(["listen", "melody", "rhythm", "recital"] as const)("does not grade or sound source attacks during %s count-in", mode => {
    const session = make({ mode, range: { start: 2, end: 8 }, metronome: false });
    session.start();
    expect(session.advance(7.9, 50, false).audioNotes).toEqual([]);
    session.press(60, 50); session.press(61, 50);
    expect(session.countingIn).toBe(true); expect(session.position).toBe(2);
    expect(session.summary).toMatchObject({ onTime: 0, missed: 0, extra: 0 });
    expect(session.matched.size).toBe(0); expect(session.sounded.size).toBe(0);
  });

  it("keeps Melody waits at the stopped source tempo after the count, not a future mark", () => {
    const session = make({ mode: "melody", range: { start: 2, end: 8 } });
    session.start();
    expect(session.advance(8, 50, false).metronomeBeat).toBe(true);
    for (let i = 0; i < 8; i++) {
      expect(session.advance(1, 50, false).metronomeBeat).toBe(false);
      expect(session.advance(1, 50, false).metronomeBeat).toBe(true);
      expect(session.position).toBe(2); expect(session.countingIn).toBe(false);
    }
    session.press(60, 50);
    session.advance(0.1, 50, false);
    expect(session.position).toBeCloseTo(2.05);
  });

  it("still starts immediately when count-in is disabled", () => {
    const session = make({ countIn: false, range: { start: 2, end: 8 } });
    session.start();
    expect(session.advance(0, 50, false)).toMatchObject({ countBeats: [], audioNotes: song.notes, metronomeBeat: true });
  });
});

describe("verified source tempo and fallback", () => {
  it.each([
    undefined,
    [],
    [{ seconds: 0, microsecondsPerQuarter: 0 }],
    [{ seconds: 0, microsecondsPerQuarter: NaN }],
    [{ seconds: 0, microsecondsPerQuarter: 500000 }, { seconds: 1, microsecondsPerQuarter: Infinity }],
  ])("uses the valid opening tempo when retained MIDI metadata is absent/invalid: %j", midiTempoMap => {
    const source = { ...song, midiTempoMap };
    const map = songTempoMap(source);
    expect(map).toBeUndefined();
    const session = make({ tempoMap: map, range: { start: 2, end: 8 } });
    session.start(); session.advance(3.99, 50, false);
    expect(session.countingIn).toBe(true);
    session.advance(0.01, 50, false); expect(session.countingIn).toBe(false);
    expect(session.position).toBe(2);
  });

  it("uses matching numeric MusicXML, but never reference-only or stale notation", () => {
    const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><sound tempo="120"/><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure><measure><sound tempo="60"/><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
    const source = parseMusicXml(xml).song, before = JSON.stringify(source);
    for (const [candidate, seconds] of [
      [source, 4], [{ ...source, scoreOrigin: undefined }, 2],
      [{ ...source, notes: source.notes.map(n => ({ ...n, start: n.start + 0.1 })) }, 2],
    ] as const) {
      const session = make({ notes: candidate.notes, tempoMap: songTempoMap(candidate), range: { start: 2, end: 5 } });
      session.start(); session.advance(seconds - 0.01, 100, false);
      expect(session.countingIn).toBe(true);
      session.advance(0.01, 100, false); expect(session.countingIn).toBe(false);
      expect(session.position).toBe(2);
    }
    expect(JSON.stringify(source)).toBe(before);
  });
});
