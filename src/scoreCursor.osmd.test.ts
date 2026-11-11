// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { parseMusicXml } from './musicxml'
import { ScoreCursorFollower } from './scoreCursor'

const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><sound tempo="60"/><note><pitch><step>C</step><octave>4</octave></pitch><duration>32</duration><tie type="start"/><type>whole</type></note><direction><offset>-16</offset><sound tempo="120"/></direction></measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><tie type="stop"/><type>half</type></note><note><rest/><duration>16</duration><type>half</type></note></measure><measure number="3"><note><rest/><duration>16</duration><type>half</type></note><note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>half</type></note></measure></part></score-partwise>`

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

describe('installed OSMD cursor contract', () => {
  it('maps real iterator positions for ties, rests and graces using public APIs', async () => {
    // jsdom has no layout/canvas. These metrics support model construction only,
    // not an engraving/layout assertion or a substitute for browser/device QA.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 6 }),
    } as unknown as CanvasRenderingContext2D)
    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetWidth', { value: 1000 })
    document.body.append(container)
    const osmd = new OpenSheetMusicDisplay(container, { autoResize: false, followCursor: false, disableCursor: false })
    try {
      await osmd.load(xml)
      osmd.render()
      const { scoreTimeline } = parseMusicXml(xml)
      // Show is the only draw step; isolate the real iterator from jsdom layout.
      vi.spyOn(osmd.cursor, 'show').mockImplementation(() => {})
      let follower = new ScoreCursorFollower(osmd.cursor, scoreTimeline, container)
      expect(follower.position(0)).toEqual({ measureIndex: 0, beat: 0 })
      expect(follower.position(3)).toEqual({ measureIndex: 1, beat: 0 })
      expect(osmd.cursor.Iterator.CurrentMeasureIndex).toBe(1)
      expect(follower.position(4)).toEqual({ measureIndex: 1, beat: 2 })
      expect(follower.position(5)).toEqual({ measureIndex: 2, beat: 0 })
      expect(follower.position(6)).toEqual({ measureIndex: 2, beat: 2 })
      expect(osmd.cursor.Iterator.CurrentRelativeInMeasureTimestamp.RealValue).toBe(.5)
      expect(follower.position(0)).toEqual({ measureIndex: 0, beat: 0 })
      follower.dispose()
      const oldCursor = osmd.cursor
      osmd.render()
      expect(osmd.cursor).not.toBe(oldCursor)
      expect(oldCursor.cursorElement.isConnected).toBe(false)
      vi.spyOn(osmd.cursor, 'show').mockImplementation(() => {})
      follower = new ScoreCursorFollower(osmd.cursor, scoreTimeline, container)
      follower.position(4)
      expect(osmd.cursor.Iterator.CurrentMeasureIndex).toBe(1)
      expect(osmd.cursor.Iterator.CurrentRelativeInMeasureTimestamp.RealValue).toBe(.5)
      follower.dispose()
      for (const zoom of [.75, 1.5, 2, 1]) {
        osmd.Zoom = zoom
        osmd.render()
        expect(osmd.Zoom).toBe(zoom)
        vi.spyOn(osmd.cursor, 'show').mockImplementation(() => {})
        follower = new ScoreCursorFollower(osmd.cursor, scoreTimeline, container)
        expect(follower.position(6)).toEqual({ measureIndex: 2, beat: 2 })
        expect(osmd.cursor.Iterator.CurrentMeasureIndex).toBe(2)
        follower.dispose()
      }
    } finally { osmd.dispose(); osmd.clear() }
  })
})
