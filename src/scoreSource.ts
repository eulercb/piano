import { DOMParser } from '@xmldom/xmldom'

function fail(message: string): never { throw new Error(`Score source: ${message}`) }

/** Offline, structural validation only. Reference scores need not be playable.
 * Keep source bytes intact; ordinary MusicXML DOCTYPEs are never resolved.
 */
export function safeDocument(xml: string, container = false) {
  if (typeof xml !== 'string' || xml.length > 5 * 1024 * 1024 || new TextEncoder().encode(xml).byteLength > 5 * 1024 * 1024) fail('choose a score smaller than 5 MiB.')
  if (!xml.trimStart().startsWith('<')) fail('expected well-formed inline MusicXML, not a URL or file path.')
  if ((xml.match(/</g)?.length ?? 0) > (container ? 1024 : 350000)) fail('the XML document has too many elements.')
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(xml) || (container && /<!DOCTYPE\b/i.test(xml))) {
    fail('custom XML entities and internal DTDs are not supported.')
  }
  // xmldom is an offline parser. Ordinary MusicXML external DOCTYPE declarations
  // are preserved, but are never resolved. Block references a renderer could fetch.
  if (/<\?xml-stylesheet\b/i.test(xml)) fail('external XML stylesheets are not supported. Export a self-contained score.')
  // xmldom treats a decoded UTF BOM as outside-root content; remove only that
  // marker for parsing. Callers retain the original source string unchanged.
  let document
  try {
    document = new DOMParser({ onError: (_level, message) => { throw new Error(message) } }).parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')
  } catch { return fail(`${container ? 'META-INF/container.xml' : 'the score'} is not well-formed XML.`) }
  const root = document.documentElement
  if (!root) return fail('the XML document has no root element.')
  if (!container && !['score-partwise', 'score-timewise'].includes(root.localName ?? '')) fail('choose a MusicXML score document.')
  const nodes = [root, ...Array.from(root.getElementsByTagName('*'))]
  if (nodes.length > (container ? 512 : 160001)) fail('the XML document has too many elements.')
  for (const node of nodes) {
    let depth = 0
    for (let parent = node.parentNode; parent && depth <= 64; parent = parent.parentNode) depth++
    if (depth > 64) fail('XML nesting is too deep.')
    if (['image', 'credit-image', 'include', 'style', 'script', 'iframe', 'object', 'embed'].includes((node.localName ?? '').toLowerCase())) {
      fail('score images and included external resources are not supported. Export a self-contained MusicXML score without images.')
    }
    for (const attribute of Array.from(node.attributes)) {
      const name = (attribute.localName ?? '').toLowerCase()
      if (['src', 'source', 'style', 'base'].includes(name) || /^on[a-z]+$/.test(name)) {
        fail('external resources and active content are not supported. Export a self-contained MusicXML score.')
      }
      if (name === 'href' && !attribute.value.startsWith('#')) {
        fail('external score links are not supported. Export a self-contained MusicXML score.')
      }
    }
  }
  return root
}
