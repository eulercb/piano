import { expect, it } from 'vitest';
import { parseMusicXml } from './musicxml';
import { editScoreNote, transposeScore, trimScoreMeasures } from './scoreEditing';
import { normalizeSong } from './project';
const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`;
it.each(['finger', 'transpose', 'trim'] as const)('retains original folder provenance after score %s and normalization', change => {
  const folderSource = {folderId:'original-folder', name:'study.musicxml', digest:'a'.repeat(64)};
  const song = {...parseMusicXml(xml).song, folderSource};
  const edited = change === 'finger' ? editScoreNote(song, song.notes[0].id, {finger:5})
    : change === 'transpose' ? transposeScore(song, 1) : trimScoreMeasures(song, 0, 0);
  expect(edited.folderSource).toEqual(folderSource);
  expect(normalizeSong(edited).folderSource).toEqual(folderSource);
});
