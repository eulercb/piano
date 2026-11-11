import { describe, expect, it } from 'vitest'
import { safeDocument } from './scoreSource'
import { parseMusicXml } from './musicxml'
import { normalizeSong, parseProject } from './project'
import { readScoreXml } from './scoreImport'

const unsafeSources = [
  'https://example.invalid/score.xml', '//example.invalid/score.xml', 'scores/study.xml',
  'data:application/xml,<score-partwise/>', '<not-musicxml/>', '<score-partwise>',
  '<?xml-stylesheet href="https://example.invalid/style.xsl"?><score-partwise/>',
  '<!DOCTYPE score-partwise [<!ENTITY remote SYSTEM "https://example.invalid/a">]><score-partwise/>',
  '<score-partwise><credit><credit-image source="https://example.invalid/image.png"/></credit></score-partwise>',
  '<score-partwise xmlns:x="http://www.w3.org/1999/xlink"><link x:href="https://example.invalid/score"/></score-partwise>',
  '<score-partwise><include href="relative.xml"/></score-partwise>',
  '<score-partwise><style>p {background:url(https://example.invalid/image)}</style></score-partwise>',
  '<score-partwise xmlns:x="urn:untrusted"><x:image/></score-partwise>',
  '<score-partwise><link HREF="https://example.invalid/image"/></score-partwise>',
  '<score-partwise xmlns:x="urn:untrusted" x:base="https://example.invalid/"><link href="#x"/></score-partwise>',
  '<score-partwise style="background:url(https://example.invalid/image)"/>',
]
const song = { id: 'reference', title: 'Reference', tempo: 120, notes: [] }
describe('shared inline score validation', () => {
  it.each(unsafeSources)('rejects unsafe source at every new input boundary: %s', async scoreXml => {
    expect(() => safeDocument(scoreXml)).toThrow()
    expect(() => parseMusicXml(scoreXml)).toThrow()
    await expect(readScoreXml(new TextEncoder().encode(scoreXml))).rejects.toThrow()
    for (const scoreOrigin of [undefined, 'musicxml']) {
      const candidate = { ...song, scoreXml, scoreOrigin }
      expect(() => normalizeSong(candidate)).toThrow()
      expect(() => parseProject(JSON.stringify({ version: 1, song: candidate }))).toThrow()
    }
  })
  it.each([
    '<score-partwise><sound only-time="1"/><play only-time="1"/></score-partwise>',
    '<score-partwise/>', '<score-timewise/>',
    '\uFEFF \n<!-- local reference -->\n<score-partwise/>',
    '<?xml version="1.0"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise/>',
    '<score-partwise><part><measure><barline><repeat direction="backward"/></barline></measure></part></score-partwise>',
    '<score-partwise xmlns:x="http://www.w3.org/1999/xlink"><link x:href="#local"/></score-partwise>',
  ])('preserves safe reference XML without requiring playable piano semantics: %s', scoreXml => {
    expect(parseProject(JSON.stringify({ version: 1, song: { ...song, scoreXml } })).scoreXml).toBe(scoreXml)
  })
})
