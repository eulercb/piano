import { describe, expect, it, vi } from 'vitest'
import { parseMusicXml } from './musicxml'
import { ScoreCursorFollower, scorePlaybackMatches, scrollScorePane, type ReadingCursor, type ScoreTimeline } from './scoreCursor'

const attributes = '<attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'
const pitch = (step: string, duration: number, extra = '') => `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`
const rest = (duration: number) => `<note><rest/><duration>${duration}</duration></note>`
const score = (body: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`
const basic = score(`<measure number="1">${attributes}<sound tempo="60"/>${pitch('C', 8)}${rest(8)}${pitch('D', 16)}</measure><measure number="2">${rest(32)}</measure>`)
const complex = score(`<measure number="1">${attributes}<sound tempo="60"/>${pitch('C', 32, '<tie type="start"/>')}<direction><offset>-16</offset><sound tempo="120"/></direction></measure><measure number="2">${pitch('C', 16, '<tie type="stop"/>')}${rest(16)}</measure><measure number="3">${rest(16)}<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type></note>${pitch('C', 16)}</measure>`)

function rect(top: number, bottom: number, left = 0, right = 600): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top } as DOMRect
}
const pane = () => ({ scrollTop: 0, scrollLeft: 0, getBoundingClientRect: () => rect(0, 400) }) as unknown as HTMLElement

class FakeCursor implements ReadingCursor {
  index = 0
  cursorElement = { getBoundingClientRect: () => rect(30, 100, 40, 60) } as HTMLElement
  constructor(readonly positions: { measureIndex: number; beat: number }[]) {}
  get Iterator() {
    return {
      EndReached: this.index >= this.positions.length,
      CurrentMeasureIndex: this.positions[this.index]?.measureIndex ?? 0,
      CurrentRelativeInMeasureTimestamp: { RealValue: (this.positions[this.index]?.beat ?? 0) / 4 },
    }
  }
  hide = vi.fn()
  show = vi.fn()
  reset = vi.fn(() => { this.index = 0 })
  next = vi.fn(() => { this.index++ })
}
function cursorFor(timeline: ScoreTimeline) {
  const positions = [...new Map(timeline.entries.map(entry => [`${entry.measureIndex}:${entry.beat}`, { measureIndex: entry.measureIndex, beat: entry.beat }])).values()]
  return new FakeCursor(positions.sort((a, b) => a.measureIndex - b.measureIndex || a.beat - b.beat))
}

describe('score timing from the validated MusicXML clock', () => {
  it('includes rests and trailing silence with direct source indices', () => {
    const { scoreTimeline, song } = parseMusicXml(basic)
    expect(scoreTimeline.entries.map(entry => [entry.sourceNoteId, entry.start, entry.duration, entry.rest])).toEqual([
      ['0:0:0', 0, 1, false], ['0:0:1', 1, 1, true], ['0:0:2', 2, 2, false], ['0:1:0', 4, 4, true],
    ])
    expect(scoreTimeline.measures).toEqual([{ start: 0, duration: 4 }, { start: 4, duration: 4 }])
    expect(scoreTimeline.duration).toBe(song.duration)
    expect(song.notes.map(note => note.sourceNoteIds)).toEqual([['0:0:0'], ['0:0:2']])
  })

  it('retains tie constituent positions across a mid-note tempo change', () => {
    const { scoreTimeline, song } = parseMusicXml(complex)
    expect(song.notes[0].sourceNoteIds).toEqual(['0:0:0', '0:1:0'])
    expect(song.notes[0].duration).toBe(4)
    expect(scoreTimeline.entries.slice(0, 3).map(entry => [entry.sourceNoteId, entry.start, entry.duration])).toEqual([
      ['0:0:0', 0, 3], ['0:1:0', 3, 1], ['0:1:1', 4, 1],
    ])
    expect(scoreTimeline.measures).toEqual([{ start: 0, duration: 3 }, { start: 3, duration: 2 }, { start: 5, duration: 2 }])
  })

  it('keeps realized grace timing separate from its written position', () => {
    const { scoreTimeline, song } = parseMusicXml(complex)
    const grace = scoreTimeline.entries.find(entry => entry.grace)!
    const played = song.notes.find(note => note.sourceNoteIds?.includes(grace.sourceNoteId))!
    expect(grace).toMatchObject({ sourceNoteId: '0:2:1', measureIndex: 2, beat: 2, writtenStart: 6, start: 5.9375, duration: .0625 })
    expect(grace.start).toBe(played.start)
    expect(grace.duration).toBe(played.duration)
  })

  it('preserves cue positions without claiming that cues sound', () => {
    const { scoreTimeline, song } = parseMusicXml(score(`<measure>${attributes}${pitch('C', 8)}${pitch('D', 8, '<cue/>')}${rest(16)}</measure>`))
    expect(scoreTimeline.entries[1]).toMatchObject({ sourceNoteId: '0:0:1', cue: true, start: .5 })
    expect(song.notes).toHaveLength(1)
  })

  it('aligns pickup measures and simultaneous voices without collapsing source ids', () => {
    const { scoreTimeline } = parseMusicXml(score(`<measure implicit="yes">${attributes}${pitch('C', 8)}</measure><measure>${pitch('D', 16)}<backup><duration>16</duration></backup>${pitch('E', 8, '<voice>2</voice>')}${pitch('F', 8, '<voice>2</voice>')}</measure>`))
    expect(scoreTimeline.measures).toEqual([{ start: 0, duration: .5 }, { start: .5, duration: 1 }])
    expect(scoreTimeline.entries.map(entry => entry.start)).toEqual([0, .5, .5, 1])
    expect(scoreTimeline.entries.map(entry => entry.sourceNoteId)).toEqual(['0:0:0', '0:1:0', '0:1:1', '0:1:2'])
  })

  it('uses the same dotted metronome and sound-offset semantics as playback', () => {
    const { scoreTimeline, song } = parseMusicXml(score(`<measure>${attributes}<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>40</per-minute></metronome></direction-type></direction>${pitch('C', 16)}<direction><offset>-8</offset><sound tempo="120"><offset>0</offset></sound></direction>${pitch('D', 16)}</measure>`))
    expect(scoreTimeline.entries.map(entry => [entry.start, entry.duration])).toEqual([[0, 2], [2, 1]])
    expect(scoreTimeline.entries.map(entry => entry.start)).toEqual(song.notes.map(note => note.start))
  })
})

describe('playback correspondence', () => {
  const { song } = parseMusicXml(complex)
  it('accepts full source notes, including ties, in another array order', () => {
    expect(scorePlaybackMatches(song.notes, [...song.notes].reverse())).toBe(true)
  })
  it.each(['time', 'duration', 'pitch', 'source', 'missing', 'duplicate', 'nan'])('rejects %s mismatches rather than guessing', change => {
    const notes = song.notes.map(note => ({ ...note, sourceNoteIds: [...note.sourceNoteIds!] }))
    if (change === 'time') notes[0].start += .01
    if (change === 'duration') notes[0].duration += .01
    if (change === 'pitch') notes[0].pitch++
    if (change === 'source') notes[0].sourceNoteIds = ['0:7:0']
    if (change === 'missing') notes.pop()
    if (change === 'duplicate') notes[1] = notes[0]
    if (change === 'nan') notes[0].start = NaN
    expect(scorePlaybackMatches(song.notes, notes)).toBe(false)
  })
})

describe('reading cursor', () => {
  it('indexes without showing, then follows note, rest and final-rest positions', () => {
    const { scoreTimeline } = parseMusicXml(basic), cursor = cursorFor(scoreTimeline)
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, pane())
    expect(cursor.show).not.toHaveBeenCalled()
    expect(cursor.index).toBe(0)
    expect(follower.position(0)).toEqual({ measureIndex: 0, beat: 0 })
    expect(follower.position(1.5)).toEqual({ measureIndex: 0, beat: 1 })
    expect(follower.position(3.9)).toEqual({ measureIndex: 0, beat: 2 })
    expect(follower.position(8)).toEqual({ measureIndex: 1, beat: 0 })
  })

  it('moves across a tied continuation and waits for the written principal during grace playback', () => {
    const { scoreTimeline } = parseMusicXml(complex), cursor = cursorFor(scoreTimeline)
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, pane())
    expect(follower.position(3)).toEqual({ measureIndex: 1, beat: 0 })
    expect(follower.position(5.9375)).toEqual({ measureIndex: 2, beat: 0 })
    expect(follower.position(6)).toEqual({ measureIndex: 2, beat: 2 })
  })

  it('seeks forwards, backwards, loops and resumes without drawing intermediate positions', () => {
    const { scoreTimeline } = parseMusicXml(basic), cursor = cursorFor(scoreTimeline)
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, pane())
    follower.position(4)
    expect(cursor.show).toHaveBeenCalledTimes(1)
    follower.position(4.1)
    follower.position(4.1)
    expect(cursor.show).toHaveBeenCalledTimes(1)
    const resets = cursor.reset.mock.calls.length
    follower.position(1)
    expect(cursor.reset).toHaveBeenCalledTimes(resets + 1)
    expect(cursor.index).toBe(1)
    follower.position(0)
    expect(cursor.index).toBe(0)
    expect(cursor.show).toHaveBeenCalledTimes(3)
  })

  it('hides before the first written position and stops changing after disposal', () => {
    const { scoreTimeline } = parseMusicXml(basic), cursor = cursorFor(scoreTimeline)
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, pane())
    expect(follower.position(-1)).toBeUndefined()
    expect(cursor.show).not.toHaveBeenCalled()
    follower.position(2)
    follower.dispose()
    const shows = cursor.show.mock.calls.length
    expect(follower.position(4)).toBeUndefined()
    follower.reveal()
    expect(cursor.show).toHaveBeenCalledTimes(shows)
  })

  it('never scrolls by default and only scrolls its pane when enabled', () => {
    const { scoreTimeline } = parseMusicXml(basic), cursor = cursorFor(scoreTimeline), viewport = pane()
    cursor.cursorElement.getBoundingClientRect = () => rect(500, 600, 650, 680)
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, viewport)
    follower.position(0)
    expect(viewport.scrollTop).toBe(0)
    expect(viewport.scrollLeft).toBe(0)
    follower.position(1, true)
    expect(viewport.scrollTop).toBe(224)
    expect(viewport.scrollLeft).toBe(104)
  })

  it('can reveal a fixed paused position explicitly and leaves an already visible cursor alone', () => {
    const { scoreTimeline } = parseMusicXml(basic), cursor = cursorFor(scoreTimeline), viewport = pane()
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, viewport)
    follower.position(0)
    follower.reveal()
    expect(viewport.scrollTop).toBe(0)
    cursor.cursorElement.getBoundingClientRect = () => rect(-50, 20, 40, 60)
    follower.reveal()
    expect(viewport.scrollTop).toBe(-74)
  })

  it('ignores unmapped renderer-only positions and refuses non-monotonic or empty maps', () => {
    const { scoreTimeline } = parseMusicXml(basic)
    const cursor = new FakeCursor([{ measureIndex: 0, beat: 0 }, { measureIndex: 0, beat: .5 }, { measureIndex: 0, beat: 1 }])
    const follower = new ScoreCursorFollower(cursor, scoreTimeline, pane())
    expect(follower.position(.75)).toEqual({ measureIndex: 0, beat: 0 })
    expect(follower.position(1)).toEqual({ measureIndex: 0, beat: 1 })
    expect(() => new ScoreCursorFollower(new FakeCursor([{ measureIndex: 9, beat: 0 }]), scoreTimeline, pane())).toThrow(/No reading positions/)
    expect(() => new ScoreCursorFollower(new FakeCursor([{ measureIndex: 0, beat: 2 }, { measureIndex: 0, beat: 0 }]), scoreTimeline, pane())).toThrow(/order/)
  })

  it('does not scroll hidden or zero-sized panes', () => {
    const viewport = pane()
    viewport.getBoundingClientRect = () => rect(0, 0)
    scrollScorePane(viewport, { getBoundingClientRect: () => rect(500, 600) } as HTMLElement)
    expect(viewport.scrollTop).toBe(0)
  })
})
