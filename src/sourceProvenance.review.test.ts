import { expect, it } from 'vitest'
import { SongLibrary } from './songLibrary'
import { songRevision } from './practiceBookmarks'
const folderSource = { folderId: 'folder', name: 'study.piano.json', digest: 'a'.repeat(64) }
const unsafe = { id: 'unsafe', title: 'Old score', tempo: 120, notes: [{ id: 'n', pitch: 60, start: 0, duration: 1, hand: 'right' as const, velocity: 1 }], scoreOrigin: 'musicxml' as const, scoreXml: 'https://example.invalid/score.xml', folderSource }
it('retains folder provenance and playback through cache recovery, export, unrelated write and own save; blocks unsafe bookmark digest', async () => {
 let raw = JSON.stringify([unsafe]);
 const disk = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value } };
 const lib = new SongLibrary(() => disk);
 const recovered = lib.getSnapshot().songs[0];
 expect(recovered.folderSource).toEqual(folderSource);
 expect(recovered.notes).toEqual(unsafe.notes);
 expect(JSON.parse(JSON.stringify({ version: 1, song: recovered })).song.folderSource).toEqual(folderSource);
 await expect(songRevision(recovered)).rejects.toThrow(/inline MusicXML/);
 expect((await lib.save({ id: 'other', title: 'Other', notes: [], tempo: 120 }, null)).ok).toBe(true);
 expect(JSON.parse(raw).find((s: { id: string }) => s.id === unsafe.id)).toEqual(unsafe);
 expect((await lib.save({ ...recovered, title: 'Renamed' }, recovered)).ok).toBe(true);
 expect(JSON.parse(raw)[0].folderSource).toEqual(folderSource);
 expect(JSON.parse(raw)[0].scoreXml).toBe(unsafe.scoreXml);
});
