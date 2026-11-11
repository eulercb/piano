import { expect, it } from 'vitest';
import { PracticeSession } from './session';
import { assessRecital } from './recital';
import { PracticePassRecorder, parsePracticeHistory, exportPracticeHistory } from './practiceHistory';
import { deleteNote, editNote, insertNote } from './noteAuthoring';
import { normalizeSong, parseProject } from './project';
import type { Song } from './music';

const song: Song = { id: 'adversarial', title: 'Synthetic review study', tempo: 120, duration: 4, notes: [
  { id: 'a', pitch: 60, start: 0, duration: .1, velocity: .7, hand: 'right', finger: 3 },
  { id: 'b', pitch: 64, start: .75, duration: .1, velocity: .6, hand: 'right', finger: 4 },
  { id: 'c', pitch: 60, start: 1.5, duration: .1, velocity: .5, hand: 'left', finger: 2 },
] };
const session = () => new PracticeSession({ notes: song.notes, duration: 4, tempo: 120, mode: 'recital', hand: 'both', countIn: false });

it('agrees with an independent elapsed-time oracle across many speed changes and pauses', () => {
  for (let trial = 1; trial <= 40; trial++) {
    const s = session(); s.start();
    let source = 0, real = 0;
    const targets: { id: string; pitch: number; time: number }[] = [{ id: 'a', pitch: 60, time: 0 }];
    const presses: { pitch: number; time: number }[] = [];
    for (let step = 0; !s.completed && step < 1000; step++) {
      const speed = [25, 50, 75, 100, 125][(step * 7 + trial) % 5];
      const delta = .013 + ((step + trial) % 11) * .007;
      const next = source + delta * speed / 100;
      for (const n of song.notes) if (n.start > source && n.start <= next)
        targets.push({ id: n.id, pitch: n.pitch, time: real + (n.start - source) / (speed / 100) });
      s.advanceFrame(delta, speed, false); source = next; real += delta;
      if (step % 13 === 0) { s.pause(); s.advance(100, speed, false); s.press(99, speed); s.start(); }
      if (!s.completed && step % 3 === 0) {
        const pitch = [60, 64, 61][(step + trial) % 3];
        presses.push({ pitch, time: real }); s.press(pitch, speed);
      }
      if (!s.completed) { expect(s.grades.size).toBe(0); expect(s.extra).toBe(0); }
    }
    expect(s.completed).toBe(true);
    const expected = assessRecital(targets, presses, .3, .1);
    expect(s.grades).toEqual(expected.grades); expect(s.extra).toBe(expected.extra);
  }
});

it('records a seeked repeat and a full repeat as separate complete backup-compatible passes', () => {
  const s = session(); s.restart(.5); s.start();
  let id = 0;
  const recorder = new PracticePassRecorder(s, song, () => '2026-11-11T12:00:00.000Z', () => `pass-${++id}`);
  const passes = [];
  for (let step = 0; passes.length < 2 && step < 100; step++) {
    const result = recorder.advanceFrame(.2, 100, true);
    if (result.completedPass) passes.push(result.completedPass);
    expect(result.historyError).toBeUndefined();
  }
  expect(passes).toHaveLength(2);
  expect(passes[0]).toMatchObject({ startSeconds: .5, noteCount: 2, rhythm: { total: 2, missed: 2 } });
  expect(passes[1]).toMatchObject({ startSeconds: 0, noteCount: 3, rhythm: { total: 3, missed: 3 } });
  const restored = parsePracticeHistory(exportPracticeHistory(passes));
  expect(new Set(restored.map(p => p.id))).toEqual(new Set(passes.map(p => p.id)));
  expect(restored.every(p => p.mode === 'recital')).toBe(true);
});

it('retains frozen originals and source metadata across chained structural edits and backup restoration', () => {
  const original = normalizeSong({ ...song, scoreXml: '<score-partwise/>' });
  const before = JSON.stringify(original);
  original.notes.forEach(Object.freeze); Object.freeze(original.notes); Object.freeze(original);
  const inserted = insertNote(original, { pitch: 127, start: 3.75, duration: .5, hand: 'left', finger: 5 });
  const changed = editNote(inserted, 'b', { start: 0, duration: 2 });
  const deleted = deleteNote(changed, 'a');
  const restored = parseProject(JSON.stringify({ version: 1, song: deleted }));
  expect(restored).toEqual(deleted);
  expect(restored.duration).toBe(4.25);
  expect(restored.scoreXml).toBe('<score-partwise/>');
  expect(restored.notes.find(n => n.id === 'b')).toMatchObject({ finger: 4, velocity: .6, hand: 'right' });
  expect(JSON.stringify(original)).toBe(before);
});

it('rejects source-linked notes even when scoreOrigin is absent on an inconsistent input', () => {
  const linked = { ...song, notes: song.notes.map(n => ({ ...n, sourceNoteIds: ['source-id'] })) };
  expect(() => deleteNote(linked, 'a')).toThrow(/MusicXML/);
  expect(() => editNote(linked, 'a', { duration: 2 })).toThrow(/MusicXML/);
  expect(() => insertNote(linked, { pitch: 60, start: 0, duration: 1, hand: 'right' })).toThrow(/MusicXML/);
});
