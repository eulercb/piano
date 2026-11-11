import { describe, expect, it } from 'vitest'
import { safeDocument } from './scoreSource'
import { normalizeSong } from './project'
const wrap = (body: string) => `<score-partwise xmlns:x="http://www.w3.org/1999/xlink" xmlns:xi="http://www.w3.org/2001/XInclude">${body}</score-partwise>`
describe('independent score-boundary review', () => {
  it.each([
    '<credit-image source="https://example.invalid/image.png"/>',
    '<xi:include x:href="https://example.invalid/include.xml"/>',
    '<link x:href="&#x68;ttps://example.invalid/score"/>',
    '<link x:href=" //example.invalid/score"/>',
    '<part xml:base="https://example.invalid/"/>',
    '<x:script>fetch("https://example.invalid")</x:script>',
    '<x:image x:href="#local"/>',
  ])('rejects resource variant %s', body => expect(() => safeDocument(wrap(body))).toThrow())
  it('rejects deep and oversized input', () => {
    expect(() => safeDocument(wrap('<a>'.repeat(66) + '</a>'.repeat(66)))).toThrow(/deep/)
    expect(() => safeDocument(wrap('x'.repeat(5 * 1024 * 1024)))).toThrow(/5 MiB/)
    expect(() => safeDocument(wrap('é'.repeat(3 * 1024 * 1024)))).toThrow(/5 MiB/)
  })
  it('accepts safe standard MusicXML only-time attributes in a reference score', () => {
    const scoreXml = wrap('<part id="P1"><measure><sound only-time="1"/></measure></part>')
    expect(normalizeSong({ id: 'test', title: 'Reference', tempo: 120, notes: [], scoreXml }).scoreXml).toBe(scoreXml)
  })
})
