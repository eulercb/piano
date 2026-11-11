// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { safeDocument } from './scoreSource'

const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>'
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })
it('confirms installed OSMD URL dispatch without making a network request', async () => {
  const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => { throw new Error('Network forbidden by test') })
  const open = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw new Error('URL dispatch intercepted') })
  const osmd = new OpenSheetMusicDisplay(document.createElement('div'), { autoResize: false })
  try {
    await expect(osmd.load('https://example.invalid/score.xml')).rejects.toThrow('URL dispatch intercepted')
    expect(open).toHaveBeenCalledWith('GET', 'https://example.invalid/score.xml', true)
    expect(send).not.toHaveBeenCalled()
  } finally { osmd.dispose(); osmd.clear() }
})
it.each(['', '\uFEFF \n', '<!-- inline score -->', '<?xml version="1.0"?>', '<!DOCTYPE score-partwise SYSTEM "https://example.invalid/partwise.dtd">'])('loads validated Documents offline with prefix %s', async prefix => {
  const open = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw new Error('No network allowed') })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 6 }) } as unknown as CanvasRenderingContext2D)
  const osmd = new OpenSheetMusicDisplay(document.createElement('div'), { autoResize: false })
  try {
    const source = prefix + xml
    safeDocument(source)
    const doc = new DOMParser().parseFromString(source, 'application/xml')
    await expect(osmd.load(doc)).resolves.toBeDefined()
    expect(open).not.toHaveBeenCalled()
  } finally { osmd.dispose(); osmd.clear() }
})
