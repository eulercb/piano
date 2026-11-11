import { safeDocument } from './scoreSource'
import { type Element } from '@xmldom/xmldom'
import { Inflate } from 'pako'
import { parseMusicXml } from './musicxml'

/** These bounds apply before allocation/inflation, including unselected ZIP entries. */
export const SCORE_IMPORT_LIMITS = Object.freeze({
  archiveBytes: 10 * 1024 * 1024,
  scoreBytes: 5 * 1024 * 1024,
  containerBytes: 64 * 1024,
  totalUncompressedBytes: 20 * 1024 * 1024,
  entries: 128,
  pathBytes: 512,
})
export type ScoreInput = Blob | ArrayBuffer | Uint8Array
export type ScoreXmlSource = { xml: string; format: 'musicxml' | 'mxl'; rootfile?: string }
export type ImportedScore = ReturnType<typeof parseMusicXml> & Omit<ScoreXmlSource, 'xml'>
class ScoreImportError extends Error {}
function fail(message: string): never { throw new ScoreImportError(`Score import: ${message}`) }
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const direct = (node: Element, name: string): Element[] => Array.from(node.childNodes)
  .filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === name)

function decodeXml(bytes: Uint8Array, label: string): string {
  // TextDecoder never resolves DTDs, entities, images or other resources.
  let xml: string
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
        : bytes[0] === 0x3c && bytes[1] === 0 ? 'utf-16le'
          : bytes[0] === 0 && bytes[1] === 0x3c ? 'utf-16be' : 'utf-8'
    xml = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    const declared = xml.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1].toLowerCase()
    if (declared && (encoding === 'utf-8' ? !['utf-8', 'utf8', 'us-ascii'].includes(declared) : !['utf-16', encoding].includes(declared))) {
      return fail(`${label} uses an unsupported or mismatched text encoding. Export UTF-8 MusicXML.`)
    }
  } catch (error) {
    if (error instanceof ScoreImportError) throw error
    return fail(`${label} is not valid UTF-8 or UTF-16 text. Export UTF-8 MusicXML.`)
  }
  return xml
}


function validPath(path: string, allowDirectory = false): void {
  const parts = (allowDirectory && path.endsWith('/') ? path.slice(0, -1) : path).split('/')
  if (!path || new TextEncoder().encode(path).length > SCORE_IMPORT_LIMITS.pathBytes ||
    /[\\:%?#\x00-\x1f\x7f]/.test(path) || parts.some(part => !part || part === '.' || part === '..')) {
    fail('the archive contains an unsafe or unsupported file path.')
  }
}

type ZipEntry = { name: string; method: number; crc: number; size: number; start: number; end: number }
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const bounds = (offset: number, length: number, end = bytes.length) => {
    if (offset < 0 || length < 0 || offset + length > end) fail('the compressed score is truncated or corrupt. Export it again.')
  }
  const extras = (start: number, length: number) => {
    const end = start + length
    while (start < end) {
      bounds(start, 4, end)
      const id = u16(start), size = u16(start + 2)
      if (id === 1) fail('ZIP64 archives are not supported. Export a smaller compressed MusicXML score.')
      if (id === 0x9901) fail('encrypted archives are not supported. Export an unencrypted score.')
      start += 4; bounds(start, size, end); start += size
    }
  }
  // Search only the legal end-record/comment region, never arbitrary payload data.
  let endRecord = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { endRecord = offset; break }
  }
  if (endRecord < 0) return fail('the .mxl file is not a complete ZIP archive. Export it again.')
  if (u16(endRecord + 4) || u16(endRecord + 6) || u16(endRecord + 8) !== u16(endRecord + 10)) fail('split ZIP archives are not supported.')
  const count = u16(endRecord + 10), centralSize = u32(endRecord + 12), centralStart = u32(endRecord + 16)
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) fail('ZIP64 archives are not supported.')
  if (!count || count > SCORE_IMPORT_LIMITS.entries) fail(`choose an archive with 1–${SCORE_IMPORT_LIMITS.entries} entries.`)
  if (centralStart + centralSize !== endRecord) fail('the ZIP directory is corrupt or uses an unsupported format.')
  bounds(centralStart, centralSize, endRecord)
  const entries: ZipEntry[] = [], names = new Set<string>(), ranges: { start: number; end: number }[] = []
  let position = centralStart, totalSize = 0
  for (let index = 0; index < count; index++) {
    bounds(position, 46, endRecord)
    if (u32(position) !== 0x02014b50) fail('the ZIP directory is corrupt.')
    const flags = u16(position + 8), method = u16(position + 10), crc = u32(position + 16)
    const compressed = u32(position + 20), size = u32(position + 24)
    const nameLength = u16(position + 28), extraLength = u16(position + 30), commentLength = u16(position + 32), local = u32(position + 42)
    if (flags & 0x2041) fail('encrypted archives are not supported. Export an unencrypted score.')
    if (flags & ~0x080e || (method === 0 && (flags & 6))) fail('the ZIP archive uses unsupported entry flags.')
    if (method !== 0 && method !== 8) fail('the archive uses unsupported compression. Export standard ZIP/DEFLATE MusicXML.')
    if (u16(position + 6) > 20 || compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail('ZIP64 and newer ZIP extensions are not supported.')
    if (u16(position + 34)) fail('split ZIP archives are not supported.')
    bounds(position + 46, nameLength + extraLength + commentLength, endRecord)
    if (!nameLength || nameLength > SCORE_IMPORT_LIMITS.pathBytes) fail('an archive file path is missing or too long.')
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength)
    let name: string
    try { name = utf8.decode(nameBytes) } catch { return fail('archive file names must use UTF-8. Export the score again.') }
    validPath(name, true)
    if (names.has(name)) fail('the archive contains duplicate file paths. Export it again.')
    names.add(name)
    const fileType = (u32(position + 38) >>> 16) & 0xf000
    if (fileType && fileType !== 0x8000 && fileType !== 0x4000) fail('links and special files are not supported in score archives.')
    if ((fileType === 0x4000 && !name.endsWith('/')) || (name.endsWith('/') && size !== 0)) fail('the archive contains an invalid directory entry.')
    if (size > (name === 'META-INF/container.xml' ? SCORE_IMPORT_LIMITS.containerBytes : SCORE_IMPORT_LIMITS.scoreBytes)) {
      fail(name === 'META-INF/container.xml' ? 'container.xml exceeds 64 KiB.' : 'an archive entry exceeds 5 MiB. Export a smaller score.')
    }
    totalSize += size
    if (totalSize > SCORE_IMPORT_LIMITS.totalUncompressedBytes) fail('the expanded archive exceeds 20 MiB. Export a smaller score.')
    extras(position + 46 + nameLength, extraLength)
    bounds(local, 30, centralStart)
    if (u32(local) !== 0x04034b50 || u16(local + 4) !== u16(position + 6) || u16(local + 6) !== flags || u16(local + 8) !== method) fail('the ZIP file headers disagree or are corrupt.')
    const localNameLength = u16(local + 26), localExtraLength = u16(local + 28)
    bounds(local + 30, localNameLength + localExtraLength, centralStart)
    if (localNameLength !== nameLength || nameBytes.some((byte, i) => byte !== bytes[local + 30 + i])) fail('the ZIP file paths disagree or are corrupt.')
    extras(local + 30 + localNameLength, localExtraLength)
    const expected = [crc, compressed, size]
    for (let field = 0; field < 3; field++) {
      const value = u32(local + 14 + field * 4)
      if (value !== expected[field] && (!(flags & 8) || value !== 0)) fail('the ZIP file sizes or checksums disagree.')
    }
    const start = local + 30 + localNameLength + localExtraLength, end = start + compressed
    bounds(start, compressed, centralStart)
    let recordEnd = end
    if (flags & 8) {
      bounds(end, 12, centralStart)
      const descriptor = u32(end) === 0x08074b50 ? end + 4 : end
      bounds(descriptor, 12, centralStart)
      if (expected.some((value, i) => u32(descriptor + i * 4) !== value)) fail('the ZIP data descriptor is corrupt.')
      recordEnd = descriptor + 12
    }
    if (method === 0 && compressed !== size) fail('a stored ZIP entry has an invalid size.')
    ranges.push({ start: local, end: recordEnd })
    entries.push({ name, method, crc, size, start, end })
    position += 46 + nameLength + extraLength + commentLength
  }
  if (position !== endRecord) fail('the ZIP directory has unexpected extra records.')
  ranges.sort((a, b) => a.start - b.start)
  if (ranges[0].start !== 0 || ranges.some((range, i) => range.end !== (ranges[i + 1]?.start ?? centralStart))) {
    fail('the ZIP archive has overlapping, hidden or unsupported records.')
  }
  return entries
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function readEntry(archive: Uint8Array, entry: ZipEntry, keep: boolean): Uint8Array {
  // Never trust a ZIP header as an allocation request until all bounds pass.
  // Fixed-size output chunks bound temporary expansion even when a header lies.
  const output = new Uint8Array(keep ? entry.size : 0)
  let length = 0, checksum = 0xffffffff
  const accept = (chunk: Uint8Array) => {
    if (length + chunk.length > entry.size) fail('an archive entry expands beyond its declared size. Export the score again.')
    for (const byte of chunk) checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8)
    if (keep) output.set(chunk, length)
    length += chunk.length
  }
  try {
    if (entry.method === 0) accept(archive.subarray(entry.start, entry.end))
    else {
      // pako validates DEFLATE blocks (including stored LEN/NLEN complements).
      // Its public TypeScript declarations omit the underlying zlib stream;
      // avail_in is needed to reject bytes after the final block, not just CRC.
      const inflater = new Inflate({ raw: true, chunkSize: 32 * 1024 }) as Inflate & { strm: { avail_in: number } }
      let complete = false
      inflater.onData = chunk => accept(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
      inflater.onEnd = status => { complete = status === 0 }
      if (entry.start === entry.end) fail('a compressed archive entry is empty or corrupt.')
      for (let offset = entry.start; offset < entry.end; offset += 1024) {
        const final = offset + 1024 >= entry.end
        if (!inflater.push(archive.subarray(offset, Math.min(offset + 1024, entry.end)), final)) {
          fail('a ZIP entry could not be decompressed. The score may be corrupt; export it again.')
        }
        // Stop immediately at BFINAL. Continuing to push unused input can hide
        // extra streams/padding and turn a small malformed archive into UI work.
        if (inflater.strm.avail_in !== 0 || (complete && !final)) fail('a ZIP entry has unexpected data after its compressed stream.')
      }
      if (!complete) fail('a compressed ZIP entry is truncated. Export the score again.')
    }
  } catch (error) {
    if (error instanceof ScoreImportError) throw error
    return fail('a ZIP entry could not be decompressed. The score may be corrupt; export it again.')
  }
  if (length !== entry.size || ((checksum ^ 0xffffffff) >>> 0) !== entry.crc) fail('a ZIP entry failed its size or checksum check. Export the score again.')
  return output
}

function readArchive(bytes: Uint8Array): ScoreXmlSource {
  const entries = zipEntries(bytes), container = entries.find(entry => entry.name === 'META-INF/container.xml')
  if (!container) return fail('the archive has no META-INF/container.xml. Export compressed MusicXML (.mxl), not a general ZIP file.')
  const root = safeDocument(decodeXml(readEntry(bytes, container, true), 'container.xml'), true)
  if (root.localName !== 'container') fail('container.xml has an invalid root element.')
  const lists = direct(root, 'rootfiles')
  if (lists.length !== 1) fail('container.xml must identify the score in one rootfiles list.')
  const roots = direct(lists[0], 'rootfile')
  for (const item of roots) validPath(item.getAttribute('full-path') ?? '')
  // Honor manifest order, not the first .xml member in the ZIP. An omitted media
  // type is allowed by MusicXML; unsupported alternate formats are skipped.
  const selected = roots.find(item => !item.getAttribute('media-type') || item.getAttribute('media-type') === 'application/vnd.recordare.musicxml+xml')
  if (!selected) return fail('container.xml does not identify a MusicXML score rootfile.')
  const rootfile = selected.getAttribute('full-path')!, score = entries.find(entry => entry.name === rootfile)
  if (!score || rootfile === container.name || rootfile.endsWith('/')) fail('the MusicXML rootfile listed in container.xml is missing or invalid.')
  let scoreBytes: Uint8Array | undefined
  for (const entry of entries) {
    if (entry === container) continue
    const data = readEntry(bytes, entry, entry === score)
    if (entry === score) scoreBytes = data
  }
  return { xml: decodeXml(scoreBytes!, 'the score'), format: 'mxl', rootfile }
}

/** Read local bytes only; no upload, resource fetching or filesystem extraction.
 * ZIP/DEFLATE and stored .mxl entries are supported, including data descriptors.
 * XML source is retained verbatim after text decoding, preserving score editing.
 */
export async function readScoreXml(input: ScoreInput, fileName = ''): Promise<ScoreXmlSource> {
  let bytes: Uint8Array
  if (input instanceof Uint8Array) bytes = input
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input)
  else {
    if (input.size > SCORE_IMPORT_LIMITS.archiveBytes) fail('choose a file smaller than 10 MiB.')
    if (!fileName && 'name' in input && typeof input.name === 'string') fileName = input.name
    try { bytes = new Uint8Array(await input.arrayBuffer()) } catch { return fail('the file could not be read. Select it again.') }
  }
  if (!bytes.length) fail('the selected score file is empty.')
  if (bytes.length > SCORE_IMPORT_LIMITS.archiveBytes) fail('choose a file smaller than 10 MiB.')
  const isArchive = /\.mxl$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b)
  if (!isArchive && bytes.length > SCORE_IMPORT_LIMITS.scoreBytes) fail('choose an XML score smaller than 5 MiB.')
  const source = isArchive ? readArchive(bytes) : { xml: decodeXml(bytes, 'the score'), format: 'musicxml' as const }
  if (new TextEncoder().encode(source.xml).length > SCORE_IMPORT_LIMITS.scoreBytes) fail('choose an XML score smaller than 5 MiB when decoded as UTF-8.')
  safeDocument(source.xml)
  return source
}

/** Existing parser results plus the source format and, for .mxl, manifest path. */
export async function importScoreFile(input: ScoreInput, fileName = ''): Promise<ImportedScore> {
  const { xml, ...source } = await readScoreXml(input, fileName)
  return { ...parseMusicXml(xml), ...source }
}
