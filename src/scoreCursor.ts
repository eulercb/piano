import type { Note } from './music'

/** All seconds use the imported song's clock, before the transport speed factor. */
export type ScoreTimingEntry = {
  sourceNoteId: string
  measureIndex: number
  /** Written quarter-note offset in the measure (OSMD fractions use whole notes). */
  beat: number
  start: number
  writtenStart: number
  duration: number
  rest: boolean
  cue: boolean
  grace: boolean
}
export type ScoreTimeline = {
  /** Source order (part, measure, direct note index), not playback order. */
  entries: ScoreTimingEntry[]
  measures: { start: number; duration: number }[]
  duration: number
}

const EPSILON = 1e-6
const key = (measure: number, beat: number) => `${measure}:${Math.round(beat / EPSILON)}`

/** Refuse timing correspondence when an attached/project score is not its playback. */
export function scorePlaybackMatches(expected: readonly Note[], actual: readonly Note[]): boolean {
  if (!expected.length || expected.length !== actual.length) return false
  const sources = (note: Note) => note.sourceNoteIds?.join('|')
  const expectedBySource = new Map(expected.map(note => [sources(note), note]))
  const seen = new Set<string>()
  return actual.every(note => {
    const source = sources(note)
    if (!source || seen.has(source)) return false
    seen.add(source)
    const original = expectedBySource.get(source)
    return !!original && original.pitch === note.pitch && Number.isFinite(note.start) && Number.isFinite(note.duration)
      && Math.abs(original.start - note.start) < EPSILON
      && Math.abs(original.duration - note.duration) < EPSILON
  })
}

/** Only documented OSMD cursor/iterator APIs. No SVG ids or private engraving fields. */
export type ReadingCursor = {
  readonly Iterator: {
    readonly EndReached: boolean
    readonly CurrentMeasureIndex: number
    readonly CurrentRelativeInMeasureTimestamp: { readonly RealValue: number }
  }
  readonly cursorElement: HTMLElement
  hide(): void
  show(): void
  reset(): void
  next(): void
}
type Stop = { index: number; time: number; measureIndex: number; beat: number }

/** Keeps the browser page still: scrolling, when requested, is confined to the score pane. */
export function scrollScorePane(viewport: HTMLElement, cursorElement: HTMLElement): void {
  const pane = viewport.getBoundingClientRect(), cursor = cursorElement.getBoundingClientRect()
  if (!pane.height || !pane.width || !cursor.height) return
  const margin = Math.min(24, pane.height / 4, pane.width / 4)
  if (cursor.top < pane.top + margin) viewport.scrollTop += cursor.top - pane.top - margin
  else if (cursor.bottom > pane.bottom - margin) viewport.scrollTop += cursor.bottom - pane.bottom + margin
  if (cursor.left < pane.left + margin) viewport.scrollLeft += cursor.left - pane.left - margin
  else if (cursor.right > pane.right - margin) viewport.scrollLeft += cursor.right - pane.right + margin
}

/**
 * Index once without drawing/scrolling. Normal playback moves only on a written
 * position change; seeks/loops reset and advance hidden, then draw once. Repeats
 * are rejected by the MusicXML importer, so the written order is monotonic.
 * Grace symbols share their principal written position; they are not individual
 * cursor steps, although ScoreTimeline retains their realized playback timing.
 */
export class ScoreCursorFollower {
  private stops: Stop[] = []
  private currentIndex = 0
  private lastStop: Stop | undefined
  private visible = false
  private disposed = false

  constructor(private cursor: ReadingCursor, timeline: ScoreTimeline, private viewport: HTMLElement) {
    const times = new Map<string, number>()
    for (const entry of timeline.entries) times.set(key(entry.measureIndex, entry.beat), entry.writtenStart)
    cursor.hide()
    try {
      cursor.reset()
      // The parser bounds written notes to 50,000. Keep a separate hard guard
      // against a renderer iterator that does not terminate on malformed input.
      for (let index = 0; !cursor.Iterator.EndReached; index++) {
        if (index >= 100000) throw new Error('The score cursor could not be indexed.')
        const measureIndex = cursor.Iterator.CurrentMeasureIndex
        const beat = cursor.Iterator.CurrentRelativeInMeasureTimestamp.RealValue * 4
        const time = times.get(key(measureIndex, beat))
        if (time !== undefined && Number.isFinite(time)) {
          const previous = this.stops[this.stops.length - 1]
          if (previous && time < previous.time - EPSILON) throw new Error('The score cursor order does not match playback.')
          this.stops.push({ index, time, measureIndex, beat })
        }
        cursor.next()
      }
      if (!this.stops.length) throw new Error('No reading positions match this score.')
    } finally {
      cursor.reset()
      cursor.hide()
    }
  }

  position(time: number, follow = false): { measureIndex: number; beat: number } | undefined {
    if (this.disposed || !Number.isFinite(time)) return undefined
    let low = 0, high = this.stops.length - 1
    if (time < this.stops[0].time - EPSILON) {
      this.cursor.hide()
      this.visible = false
      this.lastStop = undefined
      return undefined
    }
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (this.stops[middle].time <= time + EPSILON) low = middle
      else high = middle - 1
    }
    const stop = this.stops[low]
    if (this.lastStop !== stop || !this.visible) {
      this.cursor.hide()
      if (stop.index < this.currentIndex) { this.cursor.reset(); this.currentIndex = 0 }
      while (this.currentIndex < stop.index) { this.cursor.next(); this.currentIndex++ }
      this.cursor.show()
      this.visible = true
      this.lastStop = stop
      if (follow) scrollScorePane(this.viewport, this.cursor.cursorElement)
    }
    return { measureIndex: stop.measureIndex, beat: stop.beat }
  }

  /** Explicit follow activation can bring the current position into view once. */
  reveal(): void {
    if (!this.disposed && this.visible) scrollScorePane(this.viewport, this.cursor.cursorElement)
  }

  dispose(): void {
    this.disposed = true
    this.cursor.hide()
    this.stops = []
    this.lastStop = undefined
  }
}
