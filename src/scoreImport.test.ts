import { describe, expect, it, vi } from 'vitest'
import { deflateRaw as deflateSync } from 'pako'
import { importScoreFile, readScoreXml, SCORE_IMPORT_LIMITS } from './scoreImport'

const strToU8 = (text: string) => new TextEncoder().encode(text)
const zipSync = (entries: Record<string, Uint8Array>) => zipFixture(Object.entries(entries).map(([name, data]) => ({ name, data })))
const scoreXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "https://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>Synthetic tied study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><sound tempo="120"/>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><staff>1</staff><notations><technical><fingering>2</fingering></technical></notations></note>
<backup><duration>1</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><staff>2</staff></note></measure>
<measure><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note></measure></part></score-partwise>`
const rootfile = (path = 'scores/piano.musicxml', mediaType = 'application/vnd.recordare.musicxml+xml') => `<rootfile full-path="${path}"${mediaType ? ` media-type="${mediaType}"` : ''}/>`
const manifest = (roots = rootfile()) => `<?xml version="1.0"?><container><rootfiles>${roots}</rootfiles></container>`
const mxl = (xml = scoreXml, container = manifest(), extra: Record<string, Uint8Array> = {}) => zipSync({
  ...extra, 'META-INF/container.xml': strToU8(container), 'scores/piano.musicxml': strToU8(xml),
})
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
type FixtureEntry = {
  name: string; data?: string | Uint8Array; method?: number; flags?: number; size?: number;
  crc?: number; compressed?: Uint8Array; localName?: string; localSize?: number;
  external?: number; version?: number; extra?: Uint8Array; descriptor?: 'signed' | 'unsigned';
}
// Build deliberately malformed ZIPs without reading any real/user score. Fixtures
// write independent local/central records so corruption cases exercise our checks.
function zipFixture(entries: FixtureEntry[], comment = new Uint8Array()): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let localOffset = 0
  for (const entry of entries) {
    const name = strToU8(entry.name), localName = strToU8(entry.localName ?? entry.name)
    const data = typeof entry.data === 'string' ? strToU8(entry.data) : entry.data ?? new Uint8Array()
    const method = entry.method ?? 8, flags = (entry.flags ?? 0x0800) | (entry.descriptor ? 8 : 0)
    const compressed = entry.compressed ?? (method === 0 ? data : deflateSync(data))
    const size = entry.size ?? data.length, crc = entry.crc ?? crc32(data), extra = entry.extra ?? new Uint8Array()
    const local = new Uint8Array(30 + localName.length + extra.length + compressed.length + (entry.descriptor === 'signed' ? 16 : entry.descriptor ? 12 : 0))
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, entry.version ?? 20, true)
    view.setUint16(6, flags, true); view.setUint16(8, method, true)
    view.setUint32(14, entry.descriptor ? 0 : crc, true)
    view.setUint32(18, entry.descriptor ? 0 : compressed.length, true)
    view.setUint32(22, entry.localSize ?? (entry.descriptor ? 0 : size), true)
    view.setUint16(26, localName.length, true); view.setUint16(28, extra.length, true)
    local.set(localName, 30); local.set(extra, 30 + localName.length); local.set(compressed, 30 + localName.length + extra.length)
    if (entry.descriptor) {
      let offset = 30 + localName.length + extra.length + compressed.length
      if (entry.descriptor === 'signed') { view.setUint32(offset, 0x08074b50, true); offset += 4 }
      view.setUint32(offset, crc, true); view.setUint32(offset + 4, compressed.length, true); view.setUint32(offset + 8, size, true)
    }
    const central = new Uint8Array(46 + name.length + extra.length), cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 0x0314, true); cv.setUint16(6, entry.version ?? 20, true)
    cv.setUint16(8, flags, true); cv.setUint16(10, method, true); cv.setUint32(16, crc, true)
    cv.setUint32(20, compressed.length, true); cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true); cv.setUint16(30, extra.length, true)
    cv.setUint32(38, entry.external ?? 0, true); cv.setUint32(42, localOffset, true)
    central.set(name, 46); central.set(extra, 46 + name.length)
    locals.push(local); centrals.push(central); localOffset += local.length
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const result = new Uint8Array(localOffset + centralSize + 22 + comment.length)
  let offset = 0
  for (const part of [...locals, ...centrals]) { result.set(part, offset); offset += part.length }
  const view = new DataView(result.buffer)
  view.setUint32(offset, 0x06054b50, true); view.setUint16(offset + 8, entries.length, true); view.setUint16(offset + 10, entries.length, true)
  view.setUint32(offset + 12, centralSize, true); view.setUint32(offset + 16, localOffset, true); view.setUint16(offset + 20, comment.length, true)
  result.set(comment, offset + 22)
  return result
}
const fixtures = (entry: Partial<FixtureEntry> = {}): FixtureEntry[] => [
  { name: 'META-INF/container.xml', data: manifest() },
  { name: 'scores/piano.musicxml', data: scoreXml, ...entry },
]
const centralStart = (bytes: Uint8Array) => new DataView(bytes.buffer).getUint32(bytes.length - 6, true)

describe('local MusicXML source import', () => {
  it('imports XML bytes, ArrayBuffer, Blob and File with the same preserved score', async () => {
    for (const input of [strToU8(scoreXml), strToU8(scoreXml).buffer, new Blob([scoreXml]), new File([scoreXml], 'study.musicxml')]) {
      const result = await importScoreFile(input)
      expect(result.format).toBe('musicxml')
      expect(result.song.scoreXml).toBe(scoreXml)
      expect(result.song.title).toBe('Synthetic tied study')
      expect(result.song.scoreOrigin).toBe('musicxml')
      expect(result.song.notes.find(note => note.pitch === 60)).toMatchObject({ finger: 2, duration: 1.5, sourceNoteIds: ['0:0:0', '0:1:0'] })
      expect(result.song.notes.find(note => note.pitch === 48)?.hand).toBe('left')
    }
  })
  it('preserves warnings and all existing parser result fields', async () => {
    const result = await importScoreFile(strToU8(scoreXml.replace('<sound tempo="120"/>', '')))
    expect(result.warnings.join(' ')).toContain('120 BPM')
    expect(result.measureStartTempos).toEqual([120, 120])
  })
  it('handles UTF-8 BOM and UTF-16 XML while preserving decoded source', async () => {
    const xml = scoreXml.replace('UTF-8', 'UTF-16')
    for (const little of [true, false]) {
      const bytes = new Uint8Array(2 + xml.length * 2), view = new DataView(bytes.buffer)
      view.setUint16(0, 0xfeff, little)
      for (let index = 0; index < xml.length; index++) view.setUint16(2 + index * 2, xml.charCodeAt(index), little)
      expect((await readScoreXml(bytes)).xml).toBe(xml)
    }
    const bytes = new Uint8Array(3 + strToU8(scoreXml).length)
    bytes.set([0xef, 0xbb, 0xbf]); bytes.set(strToU8(scoreXml), 3)
    expect((await readScoreXml(bytes)).xml).toBe(scoreXml)
  })
  it('does not fetch external DTDs or any other resource', async () => {
    const fetch = vi.fn(() => { throw new Error('Network access is forbidden') })
    vi.stubGlobal('fetch', fetch)
    try {
      expect((await importScoreFile(mxl())).song.scoreXml).toBe(scoreXml)
      expect(fetch).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  it.each([
    ['empty', new Uint8Array(), /empty/],
    ['non-XML', strToU8('not a score'), /well-formed|root/],
    ['invalid UTF-8', new Uint8Array([0xff, 0xff]), /UTF-8/],
    ['mismatched encoding', strToU8(scoreXml.replace('UTF-8', 'UTF-16')), /encoding/],
    ['unsupported encoding', strToU8(scoreXml.replace('UTF-8', 'ISO-8859-1')), /encoding/],
    ['oversized XML', new Uint8Array(SCORE_IMPORT_LIMITS.scoreBytes + 1).fill(32), /5 MiB/],
    ['oversized archive', new Uint8Array(SCORE_IMPORT_LIMITS.archiveBytes + 1), /10 MiB/],
  ])('rejects %s with a friendly error', async (_label, input, error) => {
    await expect(readScoreXml(input)).rejects.toThrow(error)
  })
  it('checks Blob size before reading and reports failed file reads', async () => {
    const arrayBuffer = vi.fn()
    await expect(readScoreXml({ size: SCORE_IMPORT_LIMITS.archiveBytes + 1, arrayBuffer } as unknown as Blob)).rejects.toThrow(/10 MiB/)
    expect(arrayBuffer).not.toHaveBeenCalled()
    await expect(readScoreXml({ size: 1, arrayBuffer: async () => { throw new Error('unavailable') } } as unknown as Blob)).rejects.toThrow(/could not be read/)
  })
  it('requires an archive for files named .mxl, including File input', async () => {
    await expect(readScoreXml(strToU8(scoreXml), 'wrong.MXL')).rejects.toThrow(/ZIP/)
    await expect(readScoreXml(new File([scoreXml], 'wrong.mxl'))).rejects.toThrow(/ZIP/)
  })
  it.each([
    ['entity declarations', '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "https://example.invalid/secret">]>' + scoreXml, /entities/],
    ['stylesheets', '<?xml-stylesheet href="https://example.invalid/style.xsl"?>' + scoreXml, /stylesheets/],
    ['images', scoreXml.replace('<part-list>', '<credit><credit-image source="https://example.invalid/image.png"/></credit><part-list>'), /images/],
    ['archive-local images', scoreXml.replace('<part-list>', '<credit><credit-image source="images/page.png"/></credit><part-list>'), /images/],
    ['XInclude', scoreXml.replace('<part-list>', '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///secret"/><part-list>'), /external/],
    ['external links', scoreXml.replace('<part-list>', '<link href="https://example.invalid"/><part-list>'), /links/],
  ])('rejects %s without fetching resources', async (_label, xml, error) => {
    await expect(readScoreXml(strToU8(xml))).rejects.toThrow(error)
  })
  it('uses the existing parser to reject unsupported playback rather than silently approximating', async () => {
    await expect(importScoreFile(mxl(scoreXml.replace('<sound tempo="120"/>', '<barline><repeat direction="backward"/></barline>')))).rejects.toThrow(/repeat playback/)
  })
})

describe('compressed MusicXML rootfile selection', () => {
  it('sniffs .mxl bytes, chooses the manifest rootfile, and preserves ties, fingers and source indexes', async () => {
    const result = await importScoreFile(mxl(scoreXml, manifest(), { 'decoy.xml': strToU8('<invalid/>') }))
    expect(result.format).toBe('mxl')
    expect(result.rootfile).toBe('scores/piano.musicxml')
    expect(result.song.scoreXml).toBe(scoreXml)
    expect(result.song.notes.find(note => note.pitch === 60)).toMatchObject({ finger: 2, duration: 1.5, sourceNoteIds: ['0:0:0', '0:1:0'] })
  })
  it('accepts stored entries, directories, mimetype, ZIP comments and UTF-8 nested paths', async () => {
    const path = 'Études/piano.musicxml'
    const bytes = zipFixture([
      { name: 'mimetype', data: 'application/vnd.recordare.musicxml', method: 0 },
      { name: 'Études/', method: 0, external: 0x40000000 },
      { name: 'META-INF/container.xml', data: manifest(rootfile(path)), method: 0 },
      { name: path, data: scoreXml, method: 0 },
    ], strToU8('Synthetic fixture'))
    expect((await importScoreFile(bytes)).rootfile).toBe(path)
  })
  it.each(['signed', 'unsigned'] as const)('supports %s streaming data descriptors', async descriptor => {
    expect((await importScoreFile(zipFixture(fixtures({ descriptor })))).song.title).toBe('Synthetic tied study')
  })
  it('accepts a namespaced manifest and omitted rootfile media type', async () => {
    const container = manifest(rootfile('scores/piano.musicxml', '')).replace('<container>', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">')
    expect((await readScoreXml(mxl(scoreXml, container))).xml).toBe(scoreXml)
  })
  it('skips an alternate non-MusicXML rootfile and follows first supported manifest order', async () => {
    const container = manifest(rootfile('preview.pdf', 'application/pdf') + rootfile() + rootfile('alternate.xml'))
    expect((await readScoreXml(mxl(scoreXml, container, { 'preview.pdf': strToU8('preview'), 'alternate.xml': strToU8('<invalid/>') }))).rootfile).toBe('scores/piano.musicxml')
  })
  it.each([
    ['missing container', zipSync({ 'score.xml': strToU8(scoreXml) }), /container.xml/],
    ['malformed container', mxl(scoreXml, '<container>'), /well-formed/],
    ['invalid container root', mxl(scoreXml, '<wrong/>'), /root element/],
    ['no rootfile', mxl(scoreXml, manifest('')), /rootfile/],
    ['unsupported rootfile', mxl(scoreXml, manifest(rootfile('preview.pdf', 'application/pdf'))), /rootfile/],
    ['missing selected rootfile', mxl(scoreXml, manifest(rootfile('missing.xml') + rootfile())), /missing/],
    ['self-referencing container', mxl(scoreXml, manifest(rootfile('META-INF/container.xml'))), /invalid/],
    ['multiple rootfile lists', mxl(scoreXml, '<container><rootfiles/><rootfiles/></container>'), /rootfiles list/],
    ['container DTD', mxl(scoreXml, '<!DOCTYPE container SYSTEM "https://example.invalid/dtd">' + manifest()), /DTDs/],
    ['traversal rootfile', mxl(scoreXml, manifest(rootfile('../score.xml'))), /path/],
    ['external rootfile', mxl(scoreXml, manifest(rootfile('https://example.invalid/score.xml'))), /path/],
  ])('rejects %s clearly', async (_label, bytes, error) => {
    await expect(readScoreXml(bytes)).rejects.toThrow(error)
  })
})

describe('bounded and defensive ZIP decoding', () => {
  it.each(['../score.xml', '/score.xml', 'scores/../score.xml', 'scores\\score.xml', 'C:/score.xml', 'scores//score.xml', './score.xml', 'scores/%2e%2e/score.xml', 'score\u0000.xml'])('rejects unsafe entry path %j, even if unselected', async name => {
    await expect(readScoreXml(zipFixture([...fixtures(), { name, data: 'unused' }]))).rejects.toThrow(/path/)
  })
  it.each([
    ['duplicate paths', [...fixtures(), { name: 'scores/piano.musicxml', data: scoreXml }], /duplicate/],
    ['symbolic links', fixtures({ external: 0xa1ff0000 }), /links and special/],
    ['special files', fixtures({ external: 0x21ff0000 }), /links and special/],
    ['directory with data', [...fixtures(), { name: 'images/', data: 'not a directory' }], /directory/],
    ['file marked as directory', fixtures({ external: 0x41ff0000 }), /directory/],
    ['encryption', fixtures({ flags: 1 }), /encrypted/],
    ['unsupported flags', fixtures({ flags: 0x10 }), /flags/],
    ['unsupported compression', fixtures({ method: 12 }), /compression/],
    ['ZIP64 extension', fixtures({ version: 45 }), /ZIP64/],
    ['ZIP64 extra field', fixtures({ extra: new Uint8Array([1, 0, 0, 0]) }), /ZIP64/],
    ['malformed extra field', fixtures({ extra: new Uint8Array([2, 0, 1, 0]) }), /corrupt/],
    ['header path mismatch', fixtures({ localName: 'scores/other.musicxml' }), /paths disagree/],
    ['header size mismatch', fixtures({ localSize: 123 }), /sizes or checksums/],
    ['bad CRC', fixtures({ crc: 123 }), /checksum/],
    ['invalid DEFLATE', fixtures({ compressed: new Uint8Array([255, 255, 255]) }), /decompressed/],
    ['truncated DEFLATE', fixtures({ compressed: deflateSync(strToU8(scoreXml)).slice(0, -2) }), /decompressed|size or checksum/],
    ['oversized score', fixtures({ size: SCORE_IMPORT_LIMITS.scoreBytes + 1 }), /5 MiB/],
    ['oversized container', [{ name: 'META-INF/container.xml', size: SCORE_IMPORT_LIMITS.containerBytes + 1 }], /64 KiB/],
    ['too many files', Array.from({ length: SCORE_IMPORT_LIMITS.entries + 1 }, (_, index) => ({ name: `file${index}` })), /128 entries/],
    ['oversized expanded archive', Array.from({ length: 5 }, (_, index) => ({ name: `file${index}`, size: SCORE_IMPORT_LIMITS.scoreBytes })), /20 MiB/],
    ['path too long', [{ name: 'x'.repeat(SCORE_IMPORT_LIMITS.pathBytes + 1) }], /path/],
  ] satisfies [string, FixtureEntry[], RegExp][])('rejects %s', async (_label, entries, error) => {
    await expect(readScoreXml(zipFixture(entries))).rejects.toThrow(error)
  })
  it('detects a forged uncompressed size before retaining an expanding payload', async () => {
    const bomb = '<!--' + 'x'.repeat(2 * 1024 * 1024) + '-->' + scoreXml
    await expect(readScoreXml(zipFixture(fixtures({ data: bomb, size: 32 })))).rejects.toThrow(/expands beyond/)
  })
  it.each([
    ['trailing garbage', new Uint8Array([255, 255, 255])],
    ['concatenated DEFLATE streams', deflateSync(strToU8('hidden second stream'))],
    ['large trailing zero padding', new Uint8Array(8 * 1024 * 1024)],
  ])('rejects %s after the final DEFLATE block', async (_label, extra) => {
    const valid = deflateSync(strToU8(scoreXml)), compressed = new Uint8Array(valid.length + extra.length)
    compressed.set(valid); compressed.set(extra, valid.length)
    await expect(readScoreXml(zipFixture(fixtures({ compressed })))).rejects.toThrow(/unexpected data/)
  })
  it('validates stored DEFLATE blocks, including their length complement', async () => {
    const data = strToU8(scoreXml), compressed = new Uint8Array(5 + data.length), view = new DataView(compressed.buffer)
    compressed[0] = 1 // BFINAL=1, BTYPE=00 (stored), then byte alignment.
    view.setUint16(1, data.length, true); view.setUint16(3, data.length ^ 0xffff, true); compressed.set(data, 5)
    expect((await readScoreXml(zipFixture(fixtures({ compressed })))).xml).toBe(scoreXml)
    view.setUint16(3, 0, true) // Wrong NLEN; decoded XML and CRC would still match.
    await expect(readScoreXml(zipFixture(fixtures({ compressed })))).rejects.toThrow(/decompressed/)
  })
  it('rejects a missing final block marker even when output length and CRC match', async () => {
    const data = strToU8(scoreXml), compressed = new Uint8Array(5 + data.length), view = new DataView(compressed.buffer)
    compressed[0] = 0 // Stored block deliberately has BFINAL=0, with no next block.
    view.setUint16(1, data.length, true); view.setUint16(3, data.length ^ 0xffff, true); compressed.set(data, 5)
    await expect(readScoreXml(zipFixture(fixtures({ compressed })))).rejects.toThrow(/decompressed|truncated/)
  })
  it('validates ignored archive entries rather than allowing corrupt hidden assets', async () => {
    await expect(readScoreXml(zipFixture([...fixtures(), { name: 'unused.txt', data: 'ignored', crc: 1 }]))).rejects.toThrow(/checksum/)
  })
  it('does not mistake a view’s surrounding bytes for part of its archive', async () => {
    const original = mxl(), padded = new Uint8Array(original.length + 20)
    padded.set(original, 10)
    expect((await readScoreXml(padded.subarray(10, -10))).format).toBe('mxl')
  })
  it('rejects truncated and incomplete archives', async () => {
    await expect(readScoreXml(mxl().slice(0, -5))).rejects.toThrow(/ZIP/)
    await expect(readScoreXml(new Uint8Array([0x50, 0x4b]))).rejects.toThrow(/ZIP/)
  })
  it('rejects overlapping records, split archives, truncated headers and trailing bytes', async () => {
    const overlap = zipFixture(fixtures()), cv = new DataView(overlap.buffer), first = centralStart(overlap)
    const second = first + 46 + cv.getUint16(first + 28, true) + cv.getUint16(first + 30, true)
    cv.setUint32(second + 42, 0, true)
    await expect(readScoreXml(overlap)).rejects.toThrow(/headers disagree|paths disagree|overlapping/)
    const split = mxl(), sv = new DataView(split.buffer)
    sv.setUint16(split.length - 18, 1, true)
    await expect(readScoreXml(split)).rejects.toThrow(/split/)
    const truncated = mxl(), tv = new DataView(truncated.buffer)
    tv.setUint16(centralStart(truncated) + 28, 65535, true)
    await expect(readScoreXml(truncated)).rejects.toThrow(/truncated|corrupt/)
    const trailing = new Uint8Array(mxl().length + 1); trailing.set(mxl())
    await expect(readScoreXml(trailing)).rejects.toThrow(/ZIP/)
  })
})
