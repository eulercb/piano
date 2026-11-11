import { describe, expect, it } from "vitest";
import { parseMusicXml } from "./musicxml";
import { editScoreNote, trimScoreMeasures } from "./scoreEditing";
import { normalizeSong, parseProject } from "./project";
import { SongLibrary } from "./songLibrary";
import { exportBookmarks, parseBookmarks, songRevision, type PracticeBookmark } from "./practiceBookmarks";
import { exportPracticeHistory, parsePracticeHistory, PracticePassRecorder } from "./practiceHistory";
import { PracticeSession } from "./session";
import { songDuration } from "./music";
import { passageTitle } from "./songTitle";

const source = `<score-partwise version="4.0"><work><work-title>Synthetic title study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><notations><technical><fingering>2</fingering></technical></notations></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>`;
const folderSource = { folderId: "synthetic-folder", name: "synthetic.musicxml", digest: "a".repeat(64) };
const titles = [
  { label: "490-character", title: "T".repeat(490) },
  { label: "491-character", title: "T".repeat(491) },
  { label: "500-character", title: "T".repeat(500) },
  { label: "500-code-unit Unicode", title: "𝄞".repeat(249) + "終章" },
];

describe("passage title recovery boundaries", () => {
  it.each(titles)("keeps a $label title eligible for saving and recovery after repeated trims", async ({ title }) => {
    const original = normalizeSong({ ...parseMusicXml(source).song, id: "original", title, folderSource });
    const before = JSON.stringify(original);
    let bytes = JSON.stringify([original]);
    const library = new SongLibrary(() => ({ getItem: () => bytes, setItem: (_key, value) => { bytes = value; } }));
    let passage = original;
    for (let index = 0; index < 2; index++) {
      const previous = passage;
      passage = trimScoreMeasures(previous, 0, 0);
      expect(passage.id).not.toBe(previous.id);
      expect(passage.title).toBe(title.length === 490 ? title + " · passage" : title);
      passage = editScoreNote(passage, passage.notes[0].id, { finger: 5 });
      const saved = await library.save(passage, null);
      expect(saved.ok).toBe(true);
      const restored = parseProject(JSON.stringify({ version: 1, song: passage }));
      expect(restored).toEqual(passage);
      expect(restored.folderSource).toEqual(folderSource);
      expect(restored.notes[0].finger).toBe(5);
      expect(restored.scoreXml).toContain("<fingering>5</fingering>");
      expect(restored.scoreOrigin).toBe("musicxml");

      const bookmark: PracticeBookmark = { id: "bookmark", name: "Synthetic passage", songId: passage.id,
        title: passage.title, revision: await songRevision(passage), hand: "both", mode: "listen",
        speed: 100, countIn: false, repeat: false };
      expect(parseBookmarks(exportBookmarks([bookmark]))).toEqual([bookmark]);
      expect(await songRevision(restored)).toBe(bookmark.revision);

      const session = new PracticeSession({ notes: passage.notes, duration: songDuration(passage), tempo: passage.tempo,
        hand: "both", mode: "listen", countIn: false });
      const recorder = new PracticePassRecorder(session, passage, () => "2026-11-11T12:00:00.000Z", () => "pass");
      session.start();
      let completed;
      for (let frame = 0; frame < 10 && !completed; frame++) completed = recorder.advanceFrame(0.2, 100, false).completedPass;
      expect(completed?.pieceTitle).toBe(passage.title);
      expect(parsePracticeHistory(exportPracticeHistory([completed!]))).toEqual([completed]);
    }
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.parse(bytes).find((song: { id: string }) => song.id === original.id)).toEqual(original);
    const reloaded = new SongLibrary(() => ({ getItem: () => bytes, setItem() {} })).getSnapshot();
    expect(reloaded.blocked).toBe(false);
    expect(reloaded.songs).toHaveLength(3);
  });

  it("still rejects imported titles over the existing limit", () => {
    expect(() => normalizeSong({ ...parseMusicXml(source).song, title: "T".repeat(501) }))
      .toThrow("choose a title of 1–500 characters.");
  });

  it("keeps the ordinary passage label, including repeated labels while they fit", () => {
    expect(passageTitle("Synthetic study")).toBe("Synthetic study · passage");
    expect(passageTitle(passageTitle("Synthetic study"))).toBe("Synthetic study · passage · passage");
    expect(passageTitle("𝄞".repeat(245))).toBe("𝄞".repeat(245) + " · passage");
  });
});
