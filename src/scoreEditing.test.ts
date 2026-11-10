import { describe, it, expect } from "vitest";
import { parseMusicXml } from "./musicxml";
import {
  editScoreNote,
  trimScoreMeasures,
  scoreMeasures,
  transposeScore,
} from "./scoreEditing";
const xml = `<score-partwise version="4.0"><work><work-title>Test study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="start"/><technical><fingering>1</fingering></technical></notations></note></measure><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff><notations><tied type="stop"/></notations></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note></measure><measure number="2"><note><pitch><step>G</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note></measure></part></score-partwise>`;
const song = () => parseMusicXml(xml).song;
describe("score editing", () => {
  it("lists source measure numbers including pickup", () =>
    expect(scoreMeasures(song())).toEqual(["0", "1", "2"]));
  it("edits pitch across a tie and preserves combined duration", () => {
    const s = song(),
      n = s.notes[0],
      result = editScoreNote(s, n.id, { pitch: 61 });
    expect(result.notes[0].pitch).toBe(61);
    expect(result.notes[0].duration).toBeCloseTo(n.duration);
    expect(result.notes[0].sourceNoteIds).toHaveLength(2);
    expect(s.notes[0].pitch).toBe(60);
  });
  it("updates and clears printed fingers", () => {
    const s = song(),
      r = editScoreNote(s, s.notes[0].id, { finger: 4 });
    expect(r.notes[0].finger).toBe(4);
    expect(r.scoreXml).toContain("<fingering>4</fingering>");
    expect(
      editScoreNote(r, r.notes[0].id, { finger: undefined }).notes[0].finger,
    ).toBeUndefined();
  });
  it("trims a beginning passage and cuts a boundary tie", () => {
    const r = trimScoreMeasures(song(), 0, 0);
    expect(scoreMeasures(r)).toEqual(["0"]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].duration).toBeCloseTo(0.5);
    expect(r.scoreXml).not.toContain('type="start"');
  });
  it("trims an interior passage with inherited tempo and attributes", () => {
    const r = trimScoreMeasures(song(), 1, 1);
    expect(r.tempo).toBe(120);
    expect(r.notes[0].start).toBe(0);
    expect(r.notes[0].duration).toBeCloseTo(0.5);
    expect(r.notes[0].pitch).toBe(60);
    expect(r.scoreXml).toContain("<divisions>4</divisions>");
    expect(r.scoreXml).not.toContain('type="stop"');
  });
  it("transposes the score and playback together", () => {
    const r = transposeScore(song(), 2);
    expect(r.notes.map((n) => n.pitch)).toEqual([62, 66, 69]);
    expect(parseMusicXml(r.scoreXml!).song.notes.map((n) => n.pitch)).toEqual([
      62, 66, 69,
    ]);
  });
  it("preserves inherited metronome tempo when trimming", () => {
    const input = xml.replace('<direction><sound tempo="120"/></direction>', '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type></direction>');
    const r = trimScoreMeasures(parseMusicXml(input).song, 1, 1);
    expect(r.tempo).toBe(72);
    expect(r.notes[0].duration).toBeCloseTo(60 / 72);
  });
  it("edits and trims namespaced source", () => {
    const s = parseMusicXml(xml.replace('<score-partwise version="4.0">', '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" version="4.0">')).song;
    const r = editScoreNote(s, s.notes[0].id, { finger: 5 });
    expect(r.notes[0].finger).toBe(5);
    expect(trimScoreMeasures(r, 1, 1).notes).toHaveLength(2);
  });
  it("creates an omitted staff on a two-staff score when assigning a hand", () => {
    const s = parseMusicXml(xml.replaceAll('<staff>1</staff>', '')).song;
    const r = editScoreNote(s, s.notes[0].id, { hand: "left" });
    expect(r.notes[0].hand).toBe("left");
  });
  it("rejects invalid ranges and pitches without mutating", () => {
    const s = song();
    expect(() => trimScoreMeasures(s, 2, 1)).toThrow();
    expect(() => editScoreNote(s, s.notes[0].id, { pitch: 128 })).toThrow();
    expect(s.scoreXml).toBe(xml);
  });
});
