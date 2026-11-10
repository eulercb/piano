import { DOMParser, type Element } from '@xmldom/xmldom'
import type { Note, Song } from './music'

type BeatNote = Omit<Note, 'start' | 'duration'> & { start: number; duration: number; part: number; voice: string; staff: number; tieStart: boolean; tieStop: boolean; grace: boolean }
type Tempo = { beat: number; bpm: number }
type Measure = { notes: BeatNote[]; tempos: Tempo[]; length: number }
function fail(message: string): never { throw new Error(`MusicXML: ${message}`) }
const children = (element: Element, name?: string): Element[] => {
  const result: Element[] = []
  for (let node = element.firstChild; node; node = node.nextSibling) if (node.nodeType === 1 && (!name || (node as Element).localName === name)) result.push(node as Element)
  return result
}
const one = (element: Element, name: string) => children(element, name)[0]
const text = (element: Element, name: string) => one(element, name)?.textContent?.trim() ?? ''
const descendants = (element: Element, name: string): Element[] => Array.from(element.getElementsByTagName('*')).filter(node => node.localName === name)
const numeric = (value: string, label: string, positive = false): number => {
  const number = Number(value)
  if (!value || !Number.isFinite(number) || (positive && number <= 0)) return fail(`invalid ${label}.`)
  return number
}
const EPS = 1e-7

/** Parse bounded piano-oriented partwise MusicXML into seconds-based notes.
 * sourceNoteIds are zero-based "part:measure:note" indexes of direct elements,
 * counting rests/cues/graces. Tied notes retain every constituent source ID.
 * Original XML is preserved. Unwritten expressive performance is not inferred.
 */
export function parseMusicXml(xml: string): { song: Song; warnings: string[]; measureStartTempos: number[] } {
  if (typeof xml !== 'string' || new TextEncoder().encode(xml).byteLength > 5 * 1024 * 1024) fail('choose a score smaller than 5 MiB.')
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(xml)) fail('custom XML entities and internal DTDs are not supported.')
  if ((xml.match(/</g)?.length ?? 0) > 350000) fail('score has too many XML elements.')
  let root: Element
  try {
    const document = new DOMParser({ onError: (_level, message) => { throw new Error(message) } }).parseFromString(xml, 'application/xml')
    if (!document.documentElement) return fail('missing score root.')
    root = document.documentElement
  } catch { return fail('the file is not well-formed XML.') }
  if (root.localName === 'score-timewise') fail('timewise scores are not supported; export a partwise MusicXML score.')
  if (root.localName !== 'score-partwise') fail('choose a score-partwise MusicXML file.')
  const all = Array.from(root.getElementsByTagName('*'))
  if (all.length > 160000) fail('score has too many elements.')
  for (const node of all) {
    let depth = 0
    for (let parent = node.parentNode; parent && depth <= 64; parent = parent.parentNode) depth++
    if (depth > 64) fail('XML nesting is too deep.')
  }
  const unsupported = ['repeat', 'ending', 'segno', 'coda', 'measure-repeat', 'multiple-rest', 'unpitched', 'senza-misura', 'swing', 'glissando', 'slide', 'bend', 'tremolo', 'octave-shift']
  for (const tag of unsupported) if (all.some(node => node.localName === tag)) fail(`${tag} playback is not supported; use an unfolded, pitched piano score.`)
  for (const sound of all.filter(node => node.localName === 'sound')) {
    if (['dacapo','dalsegno','tocoda','fine','forward-repeat'].some(name => sound.hasAttribute(name))) fail('repeat/navigation playback is not supported; unfold the score first.')
  }
  const warningSet = new Set<string>()
  if (all.some(node => ['dynamics','articulations','fermata','pedal','ornaments','arpeggiate'].includes(node.localName ?? ''))) warningSet.add('Dynamics, articulation, pedal, fermatas and ornament symbols are shown in the score but are not performed automatically.')
  const parts = children(root, 'part')
  if (!parts.length || parts.length > 16) fail('a score must have 1–16 parts.')
  const measureCount = children(parts[0], 'measure').length
  if (!measureCount || measureCount > 2000 || parts.some(part => children(part, 'measure').length !== measureCount)) fail('parts must contain the same 1–2,000 measures.')
  const perPart: Measure[][] = []
  let noteCount = 0
  parts.forEach((part, partIndex) => {
    let divisions = 0, nominalLength = 4, staves = 1, bassClef = false
    const measures = children(part, 'measure')
    const parsed: Measure[] = []
    measures.forEach((measure, measureIndex) => {
      let cursor = 0, extent = 0, noteIndex = 0
      let previous: { onset: number; voice: string; staff: number; grace: boolean } | undefined
      const notes: BeatNote[] = [], tempos: Tempo[] = []
      for (const item of children(measure)) {
        const tag = item.localName
        if (tag === 'attributes') {
          if (one(item, 'divisions')) divisions = numeric(text(item, 'divisions'), 'divisions', true)
          if (divisions > 10000000) fail('divisions exceed supported precision.')
          if (one(item, 'staves')) staves = numeric(text(item, 'staves'), 'staff count', true)
          if (!Number.isInteger(staves) || staves > 2) fail('only one or two piano staves per part are supported.')
          for (const clef of children(item, 'clef')) {
            if (text(clef, 'sign') === 'percussion') fail('percussion is not supported.')
            if (!clef.getAttribute('number') || clef.getAttribute('number') === '1') bassClef = text(clef, 'sign') === 'F'
          }
          for (const transpose of children(item, 'transpose')) if (Number(text(transpose, 'chromatic')) || Number(text(transpose, 'octave-change'))) fail('transposing-instrument scores are not supported; export concert pitch.')
          const time = one(item, 'time')
          if (time) {
            if (cursor !== 0) fail('mid-measure time signature changes are not supported.')
            const beats = children(time, 'beats'), units = children(time, 'beat-type')
            if (!beats.length || beats.length !== units.length) fail('invalid time signature.')
            nominalLength = beats.reduce((sum, beat, i) => {
              const count = (beat.textContent ?? '').trim().split('+').reduce((a,b) => a + numeric(b.trim(), 'time signature', true), 0)
              return sum + count * 4 / numeric(units[i].textContent?.trim() ?? '', 'time signature', true)
            }, 0)
            if (nominalLength > 128) fail('time signature is too long.')
          }
        } else if (tag === 'backup' || tag === 'forward') {
          if (!divisions) fail('duration appears before divisions.')
          const delta = numeric(text(item, 'duration'), `${tag} duration`, true) / divisions
          cursor += tag === 'backup' ? -delta : delta
          if (cursor < -EPS) fail('backup moves before the beginning of a measure.')
          cursor = Math.max(0, cursor); extent = Math.max(extent, cursor); previous = undefined
        } else if (tag === 'direction' || tag === 'sound') {
          const sound = tag === 'sound' ? item : one(item, 'sound')
          // A sound offset is the playback offset and overrides the enclosing
          // direction's visual offset, rather than adding to it.
          const offsetElement = sound && one(sound, 'offset') ? sound : item
          let offset = 0
          if (one(offsetElement, 'offset')) { if (!divisions) fail('direction offset appears before divisions.'); offset = numeric(text(offsetElement, 'offset'), 'direction offset') / divisions }
          const beat = cursor + offset
          if (beat < -EPS) fail('direction offset crosses before its measure.')
          const metronome = descendants(item, 'metronome')[0]
          let bpm: number | undefined
          if (sound?.hasAttribute('tempo')) bpm = numeric(sound.getAttribute('tempo') ?? '', 'tempo', true)
          else if (metronome) {
            const unit = text(metronome, 'beat-unit'), rate = text(metronome, 'per-minute')
            const units: Record<string, number> = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 }
            if (!rate || !units[unit] || children(metronome, 'beat-unit').length !== 1) fail('metric-modulation tempo marks are not supported; use a numeric tempo.')
            const dots = children(metronome, 'beat-unit-dot').length
            bpm = numeric(rate, 'metronome tempo', true) * units[unit] * (2 - 2 ** -dots)
          }
          if (bpm !== undefined) { if (bpm > 10000) fail('tempo exceeds 10,000 BPM.'); tempos.push({ beat: Math.max(0, beat), bpm }) }
        } else if (tag === 'note') {
          if (++noteCount > 50000) fail('score exceeds 50,000 written notes.')
          const sourceId = `${partIndex}:${measureIndex}:${noteIndex++}`
          if (!divisions) fail('notes appear before divisions.')
          const graceElement = one(item, 'grace'), grace = !!graceElement, chord = !!one(item, 'chord')
          if (graceElement && ['steal-time-previous','steal-time-following','make-time'].some(name => graceElement.hasAttribute(name))) fail('explicit grace-note timing is not supported.')
          if (grace && chord) fail('grace-note chords are not supported.')
          const voice = text(item, 'voice') || '1', staff = Number(text(item, 'staff') || '1')
          if (!Number.isInteger(staff) || staff < 1 || staff > staves) fail('staff number exceeds the declared piano staves.')
          const duration = grace ? 0 : numeric(text(item, 'duration'), 'note duration', true) / divisions
          if (chord && (!previous || previous.voice !== voice || previous.grace)) fail('a chord note has no matching preceding note.')
          const onset = chord ? previous!.onset : cursor
          if (!chord && !grace) cursor += duration
          extent = Math.max(extent, onset + duration, cursor)
          if (!chord) previous = { onset, voice, staff, grace }
          if (one(item, 'rest')) { if (grace || chord) fail('grace/chord rests are not supported.'); continue }
          if (one(item, 'cue')) { warningSet.add('Cue notes are displayed but omitted from playback.'); continue }
          const pitchElement = one(item, 'pitch')
          if (!pitchElement) fail('every sounding note must have a pitch.')
          const steps: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
          const step = text(pitchElement, 'step'), octave = numeric(text(pitchElement, 'octave'), 'octave')
          const alter = one(pitchElement, 'alter') ? numeric(text(pitchElement, 'alter'), 'pitch alteration') : 0
          if (steps[step] === undefined || !Number.isInteger(octave) || !Number.isInteger(alter)) fail('microtones or invalid pitches are not supported.')
          const pitch = (octave + 1) * 12 + steps[step] + alter
          if (pitch < 0 || pitch > 127) fail('pitch is outside the MIDI range.')
          const fingerElements = descendants(item, 'fingering'), fingerText = fingerElements[0]?.textContent?.trim()
          let finger: number | undefined
          if (fingerText && /^[1-5]$/.test(fingerText)) finger = Number(fingerText)
          else if (fingerText) warningSet.add('Non-numeric or compound fingering marks remain in the score but are not shown as a single finger hint.')
          if (fingerElements.length > 1) warningSet.add('Multiple fingering alternatives are reduced to the first single finger hint.')
          const ties = children(item, 'tie').length ? children(item, 'tie') : descendants(item, 'tied')
          const tieStart = ties.some(tie => tie.getAttribute('type') === 'start'), tieStop = ties.some(tie => tie.getAttribute('type') === 'stop')
          if (ties.some(tie => !['start','stop'].includes(tie.getAttribute('type') ?? ''))) fail('unsupported tie type.')
          if (grace && (tieStart || tieStop)) fail('tied grace notes are not supported.')
          const hand: Note['hand'] = staff === 2 || (staves === 1 && bassClef) ? 'left' : 'right'
          notes.push({ id: `xml-${sourceId}`, pitch, start: onset, duration, velocity: hand === 'right' ? 78 / 127 : 62 / 127, hand, ...(finger ? { finger } : {}), sourceNoteIds: [sourceId], part: partIndex, voice, staff, tieStart, tieStop, grace })
        }
      }
      if (extent > 512) fail('measure is too long.')
      const pickup = measure.getAttribute('implicit') === 'yes' || (measureIndex === 0 && extent < nominalLength - EPS)
      const length = pickup || measureIndex === measures.length - 1 ? extent : Math.max(extent, nominalLength)
      if (length <= 0) fail('empty measures need an explicit whole-measure rest.')
      parsed.push({ notes, tempos, length })
    })
    perPart.push(parsed)
  })
  const beatNotes: BeatNote[] = [], tempoEvents: Tempo[] = []
  const measureStarts: number[] = []
  let measureStart = 0
  for (let index = 0; index < measureCount; index++) {
    measureStarts.push(measureStart)
    const length = Math.max(...perPart.map(measures => measures[index].length))
    for (const measures of perPart) {
      const measure = measures[index]
      for (const note of measure.notes) beatNotes.push({ ...note, start: note.start + measureStart })
      for (const tempo of measure.tempos) tempoEvents.push({ ...tempo, beat: tempo.beat + measureStart })
    }
    measureStart += length
  }
  // Realize a run of grace notes immediately before its principal note. This
  // fixed 1/8-quarter policy matches the supplied practice score's MIDI.
  const graceGroups = new Map<string, BeatNote[]>()
  for (const note of beatNotes.filter(note => note.grace)) {
    const key = `${note.part}:${note.staff}:${note.voice}:${note.start}`
    const group = graceGroups.get(key) ?? []; group.push(note); graceGroups.set(key, group)
  }
  const principalPositions = new Set(beatNotes.filter(note => !note.grace).map(note => `${note.part}:${note.staff}:${note.voice}:${note.start}`))
  for (const [key, group] of graceGroups) {
    if (!principalPositions.has(key)) fail('a grace-note group has no following principal note at its position.')
    const onset = group[0].start
    if (onset < group.length / 8 - EPS) fail('grace notes at the beginning need explicit playable timing; import a MIDI realization instead.')
    group.forEach((note, index) => { note.start = onset - (group.length - index) / 8; note.duration = 1 / 8 })
  }
  if (graceGroups.size) warningSet.add('Grace notes play 1/8 of a quarter note each immediately before the principal beat; expressive grace timing is approximate.')
  beatNotes.sort((a,b) => a.start - b.start || a.pitch - b.pitch)
  const tied = new Map<string, BeatNote>(), combined: BeatNote[] = []
  for (const note of beatNotes) {
    const key = `${note.part}:${note.staff}:${note.voice}:${note.pitch}`
    if (note.tieStop) {
      const prior = tied.get(key)
      if (!prior || Math.abs(prior.start + prior.duration - note.start) > EPS) fail('a tie continuation has no adjacent matching start.')
      prior.duration += note.duration; prior.sourceNoteIds!.push(...note.sourceNoteIds!)
      if (!prior.finger && note.finger) prior.finger = note.finger
      if (!note.tieStart) tied.delete(key)
    } else {
      if (tied.has(key)) fail('a tie starts again before its continuation.')
      combined.push(note)
      if (note.tieStart) tied.set(key, note)
    }
  }
  if (tied.size) fail('a tie runs beyond this score; include its continuation or remove the dangling tie.')
  if (!combined.length) fail('score contains no playable pitched notes.')
  tempoEvents.sort((a,b) => a.beat - b.beat)
  const segments: { beat: number; seconds: number; bpm: number }[] = [{ beat: 0, seconds: 0, bpm: 120 }]
  let lastExplicit: Tempo | undefined
  for (const tempo of tempoEvents) {
    if (lastExplicit && Math.abs(tempo.beat - lastExplicit.beat) < EPS && Math.abs(tempo.bpm - lastExplicit.bpm) > EPS) fail('conflicting tempo marks occur at the same position.')
    const previous = segments[segments.length - 1]
    if (tempo.beat === previous.beat) previous.bpm = tempo.bpm
    else segments.push({ ...tempo, seconds: previous.seconds + (tempo.beat - previous.beat) * 60 / previous.bpm })
    lastExplicit = tempo
  }
  if (!tempoEvents.length) warningSet.add('No numeric tempo is written; playback uses 120 BPM.')
  const segmentAt = (beat: number) => {
    let low = 0, high = segments.length - 1
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (segments[middle].beat <= beat) low = middle; else high = middle - 1 }
    return segments[low]
  }
  const secondsAt = (beat: number) => { const segment = segmentAt(beat); return segment.seconds + (beat - segment.beat) * 60 / segment.bpm }
  if (secondsAt(measureStart) > 86400) fail('score duration exceeds 24 hours.')
  const notes: Note[] = combined.map(note => ({ id: note.id, pitch: note.pitch, start: secondsAt(note.start), duration: secondsAt(note.start + note.duration) - secondsAt(note.start), velocity: note.velocity, hand: note.hand, ...(note.finger ? { finger: note.finger } : {}), sourceNoteIds: note.sourceNoteIds }))
  const title = descendants(root, 'work-title')[0]?.textContent?.trim() || text(root, 'movement-title') || 'Imported score'
  return { song: { id: crypto.randomUUID(), title: title.slice(0, 500), tempo: segments[0].bpm, notes, scoreXml: xml, scoreOrigin: 'musicxml', duration: secondsAt(measureStart) }, warnings: [...warningSet], measureStartTempos: measureStarts.map(beat => segmentAt(beat).bpm) }
}
