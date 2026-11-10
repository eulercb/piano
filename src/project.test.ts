import { describe, expect, it } from 'vitest'
import { normalizeSong, parseProject } from './project'
import type { Song } from './music'
const original: Song = { id: 'source', title: 'Study', tempo: 120, scoreXml: '<score-partwise/>', notes: [
  { id: 'second', pitch: 72, start: 1, duration: 1, velocity: 0.8, hand: 'right', finger: 4 },
  { id: 'first', pitch: 48, start: 0, duration: 1, velocity: 0.5, hand: 'left' },
] }
const withNote = (patch: Record<string, unknown>) => ({ ...original, notes: [{ ...original.notes[0], ...patch }] })
describe('project validation', () => {
  it('normalizes chronological order and preserves unique IDs, hands, fingers and notation', () => {
    const normalized = parseProject(JSON.stringify({ version: 1, song: original }))
    expect(normalized.notes.map(n => n.id)).toEqual(['first', 'second'])
    expect(normalized.notes[1].finger).toBe(4)
    expect(normalized.notes[0].hand).toBe('left')
    expect(normalized.scoreXml).toBe(original.scoreXml)
    expect(original.notes[0].id).toBe('second')
  })
  it('regenerates duplicate/missing note IDs before sorting', () => {
    const normalized = normalizeSong({ ...original, notes: original.notes.map(n => ({ ...n, id: 'same' })) })
    expect(normalized.notes.map(n => n.id)).toEqual(['n1', 'n0'])
    expect(normalizeSong(withNote({ id: undefined })).notes[0].id).toBe('n0')
  })
  it.each([{ pitch: 60.5 }, { pitch: -1 }, { pitch: 128 }, { pitch: NaN }, { velocity: 2 }, { velocity: undefined }, { hand: 'third' }, { finger: 0 }, { finger: 2.5 }, { start: -1 }, { duration: 0 }, { start: 1e308, duration: 1e308 }])('rejects invalid note fields %j', patch => {
    expect(() => normalizeSong(withNote(patch))).toThrow(/Invalid Piano project/)
  })
  it.each([{ tempo: 0 }, { tempo: Infinity }, { title: '' }, { scoreXml: {} }, { notes: null }])('rejects invalid song fields %j', patch => {
    expect(() => normalizeSong({ ...original, ...patch })).toThrow(/Invalid Piano project/)
  })
  it('rejects invalid JSON and versions', () => {
    expect(() => parseProject('no')).toThrow(/valid JSON/)
    expect(() => parseProject('{"version":2}')).toThrow(/version/)
  })
  it('allows saved empty passages and strips unknown fields', () => {
    expect(normalizeSong({ ...original, notes: [], arbitrary: true })).toEqual({ ...original, notes: [] })
  })
  it('bounds score size and note count', () => {
    expect(() => normalizeSong({ ...original, scoreXml: 'a'.repeat(5 * 1024 * 1024 + 1) })).toThrow(/5 MiB/)
    expect(() => normalizeSong({ ...original, notes: new Array(100001) })).toThrow(/100,000/)
  })
})
