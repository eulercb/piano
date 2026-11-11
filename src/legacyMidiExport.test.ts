import { describe, expect, it } from 'vitest'
import { exportMidi, parseMidi, type Note, type Song } from './music'
import { parseProject } from './project'
import { serializeProject } from './projectFormat'
import { editNote, insertNote } from './noteAuthoring'

const note = (id: string, start: number, end: number, velocity = 100 / 127, hand: Note['hand'] = 'right', pitch = 60): Note => ({ id, start, duration: end - start, velocity, hand, pitch })
const song = (notes: Note[]): Song => ({ id: 'legacy', title: 'Synthetic', tempo: 120, notes })
const tuples = (s: Song) => s.notes.map(n => JSON.stringify([n.hand, n.pitch, Math.round(n.start * 960), Math.round((n.start + n.duration) * 960), Math.max(1, Math.round(n.velocity * 127))])).sort()
function roundtrip(s: Song) {
  const before = JSON.stringify(s)
  s.notes.forEach(Object.freeze); Object.freeze(s.notes); Object.freeze(s)
  const restored = parseMidi(exportMidi(s).buffer as ArrayBuffer)
  expect(tuples(restored)).toEqual(tuples(s))
  expect(JSON.stringify(s)).toBe(before)
  return restored
}
describe('legacy FIFO export safety', () => {
  it.each([
    [note('a', 0, 2), note('b', 1, 3, 40 / 127)],
    [note('a', 0, 1), note('b', 1, 2)],
    [note('a', 0, 3), note('b', 0, 2)],
    [note('a', 0, 2), note('b', 0, 3, 40 / 127)],
    [note('a', 0, 3), note('b', 0, 2, 40 / 127)],
    [note('a', 0, 3), note('b', 1, 3, 40 / 127)],
    [note('a', 0, 3), note('b', 1, 2, 40 / 127, 'left')],
    [note('a', 0, 3), note('b', 1, 2, 40 / 127, 'right', 61)],
    [note('duplicate', 0, 3), note('duplicate', 0, 2, 40 / 127)],
    [note('a', 0, 3), note('b', .0001, 2, 40 / 127)],
  ])('retains representable musical tuples %#', (...notes) => { roundtrip(song(notes)) })
  it.each([
    [0, 2, 100, '4d546864000000060000000101e04d54726b0000004400ff030953796e74686574696300ff01165069616e6f50726163746963653a48616e64733a763100ff510307a12000903c6400903c648f00803c008740803c0000ff2f00'],
    [1, 2, 40, '4d546864000000060000000101e04d54726b0000004400ff030953796e74686574696300ff01165069616e6f50726163746963653a48616e64733a763100ff510307a12000903c648740903c288f00803c0000803c0000ff2f00'],
  ] as const)('preserves faithful overlap bytes from e869419 (%s, %s, %s)', (start, duration, velocity, hex) => {
    const source = song([note('a', 0, 3), note('b', start, start + duration, velocity / 127)])
    expect([...exportMidi(source)].map(byte => byte.toString(16).padStart(2, '0')).join('')).toBe(hex)
    roundtrip(source)
  })
  it.each([100 / 127, 40 / 127])('rejects nested intervals even with equal velocities (%s)', velocity => {
    const source = parseProject(serializeProject(song([note('outer', 0, 3), note('inner', 1, 2, velocity)])))
    const before = JSON.stringify(source)
    expect(() => exportMidi(source)).toThrow(/overlapping notes.*Piano project/)
    expect(JSON.stringify(source)).toBe(before)
  })
  it('rejects nested intervals created by Studio insertion and retiming', () => {
    const base = song([note('outer', 0, 3)])
    const inserted = insertNote(base, { pitch: 60, start: 1, duration: 1, hand: 'right', velocity: 40 / 127 })
    expect(() => exportMidi(inserted)).toThrow(/individual durations/)
    const retimed = editNote(song([...base.notes, note('second', 3, 4)]), 'second', { start: 1, duration: 1 })
    expect(() => exportMidi(retimed)).toThrow(/individual durations/)
  })
  it('accepts 1,024 active notes and rejects 1,025, separately per hand and pitch', () => {
    const notes = Array.from({ length: 1024 }, (_, i) => note(`${i}`, 0, 1))
    roundtrip(song(notes))
    roundtrip(song([...notes, ...notes.map(n => ({ ...n, id: `next-${n.id}`, start: 1 }))]))
    expect(() => exportMidi(song([...notes, note('excess', 0, 1)]))).toThrow(/maximum 1,024/)
    roundtrip(song([...notes, note('left', 0, 1, .5, 'left'), note('pitch', 0, 1, .5, 'right', 61)]))
  })
  it('counts the four metadata/end events: 99,998 notes fit, 99,999 do not', () => {
    const notes = Array.from({ length: 99998 }, (_, i) => note(`${i}`, Math.floor(i / 2), Math.floor(i / 2) + 1, 1, 'right', 60 + i % 2))
    const restored = parseMidi(exportMidi(song(notes)).buffer as ArrayBuffer)
    expect(restored.notes).toHaveLength(99998)
    expect(() => exportMidi(song([...notes, note('excess', 105, 106)]))).toThrow(/200,000-event/)
  })
})
