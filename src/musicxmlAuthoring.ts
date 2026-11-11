import { DOMParser, XMLSerializer, type Element, type Document } from '@xmldom/xmldom';
import { parseMusicXml } from './musicxml';
import type { Song } from './music';

const children = (e: Element): Element[] => Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1);
const one = (e: Element, name: string) => children(e).find(n => n.localName === name);
const value = (e: Element, name: string) => one(e, name)?.textContent?.trim() ?? '';
const notation = (beats: number) => {
  for (const [type, length] of [['whole', 4], ['half', 2], ['quarter', 1], ['eighth', .5], ['16th', .25], ['32nd', .125], ['64th', .0625]] as const)
    for (const dots of [0, 1]) if (Math.abs(beats - length * (dots ? 1.5 : 1)) < 1e-8) return { type, dots };
  throw Error('Use a whole through 64th note, optionally dotted. Any remaining rest must also fit one of these values.');
};
function read(song: Song) {
  if (song.scoreOrigin !== 'musicxml' || !song.scoreXml) throw Error('Import MusicXML to edit written notes.');
  const parsed = parseMusicXml(song.scoreXml).song;
  const signature = (s: Song) => JSON.stringify(s.notes.map(n => [n.id, n.pitch, n.start, n.duration, n.hand, n.finger, n.velocity, n.sourceNoteIds]));
  if (signature(parsed) !== signature(song) || parsed.tempo !== song.tempo || parsed.duration !== song.duration) throw Error('Score and playback mapping is out of date. Reimport the MusicXML before structural editing.');
  return new DOMParser().parseFromString(song.scoreXml, 'application/xml');
}
// MusicXML tenths coordinates affect engraving only. Do not widen this to
// print/playback flags, arbitrary attributes, or similarly named extensions.
const positionAttributes = new Set(['default-x', 'default-y', 'relative-x', 'relative-y']);
const plainDecimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function safeNoteAttributes(node: Element): boolean {
  return Array.from(node.attributes).every(a => !a.namespaceURI && positionAttributes.has(a.name) && plainDecimal.test(a.value.trim()) && Number.isFinite(Number(a.value)));
}
function copyPosition(from: Element, to: Element) {
  for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value);
}
const unsupportedReason = 'Structural editing is not supported for ties, grace/cue, beam, tuplet or other notation/attributes. Only simple fingerings and engraving-position attributes are supported here.';
function simpleContent(node: Element): boolean {
  const parts = children(node);
  if (node.localName === 'pitch') {
    return parts.length >= 2 && parts.length <= 3 && ['step', 'octave'].every(name => parts.filter(n => n.localName === name).length === 1) && parts.filter(n => n.localName === 'alter').length <= 1 && parts.every(n => ['step', 'alter', 'octave'].includes(n.localName ?? '') && !children(n).length);
  }
  if (node.localName === 'rest') {
    return !parts.length || (parts.length === 2 && ['display-step', 'display-octave'].every(name => parts.filter(n => n.localName === name).length === 1) && parts.every(n => !children(n).length));
  }
  if (node.localName === 'notations') {
    return !node.attributes.length && parts.every(t => t.localName === 'technical' && !t.attributes.length && children(t).every(f => f.localName === 'fingering' && !children(f).length));
  }
  return ['duration', 'voice', 'type', 'dot', 'accidental', 'stem', 'staff'].includes(node.localName ?? '') && !parts.length;
}
const chordReason = 'This chord is not supported here. Tones must be adjacent, simple notes with distinct pitches and the same duration, voice and staff.';
export type ScoreSlot = { sourceId: string; measure: string; rest: boolean; beats: number; voice: string; staff: string; chordSize: number; reason?: string };
type Slot = ScoreSlot & { node: Element; divisions: number; chord: Slot[] };
function slots(doc: Document): Slot[] {
  const result: Slot[] = [];
  children(doc.documentElement!).filter(e => e.localName === 'part').forEach((part, p) => {
    let divisions = 0;
    children(part).filter(e => e.localName === 'measure').forEach((measure, m) => {
      let index = 0;
      const items = children(measure), groups: Slot[][] = [];
      const itemIndexes = new Map(items.map((item, i) => [item, i]));
      let chord: Slot[] | undefined;
      items.forEach((node) => {
        if (node.localName === 'attributes' && one(node, 'divisions')) divisions = Number(value(node, 'divisions'));
        if (['backup', 'forward'].includes(node.localName ?? '')) chord = undefined;
        if (node.localName !== 'note') return;
        const unsupported = children(node).find(e => !simpleContent(e) && !(e.localName === 'chord' && !e.attributes.length && !children(e).length && !e.textContent?.trim()));
        const duplicate = children(node).some((n, i, all) => n.localName !== 'dot' && n.localName !== 'notations' && all.slice(0, i).some(other => other.localName === n.localName));
        if (!one(node, 'chord') || !chord) { chord = []; groups.push(chord); }
        const slot: Slot = { sourceId: `${p}:${m}:${index++}`, measure: measure.getAttribute('number') || String(m + 1), rest: !!one(node, 'rest'), beats: Number(value(node, 'duration')) / divisions,
          voice: value(node, 'voice') || '1', staff: value(node, 'staff') || '1', node, divisions, chord, chordSize: 1,
          reason: (!!one(node, 'pitch') === !!one(node, 'rest')) || node.namespaceURI !== measure.namespaceURI || Array.from(node.getElementsByTagName('*')).some(n => n.namespaceURI !== node.namespaceURI) || !safeNoteAttributes(node) || unsupported || duplicate ? unsupportedReason : undefined };
        chord.push(slot); result.push(slot);
      });
      for (const group of groups) {
        if (group.length < 2) continue;
        const first = group[0];
        const pitches = group.map(s => {
          const p = one(s.node, 'pitch');
          if (!p) return NaN;
          return ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[value(p, 'step')] ?? NaN) + Number(value(p, 'alter') || 0) + (Number(value(p, 'octave')) + 1) * 12;
        });
        const duplicatePitch = new Set(pitches).size !== pitches.length;
        const invalid = duplicatePitch || group.some((s, i) => s.reason || s.rest || s.beats !== first.beats || s.divisions !== first.divisions || s.voice !== first.voice || s.staff !== first.staff || value(s.node, 'type') !== value(first.node, 'type') || children(s.node).filter(n => n.localName === 'dot').length !== children(first.node).filter(n => n.localName === 'dot').length || (i > 0 && items[itemIndexes.get(s.node)! - 1] !== group[i - 1].node));
        for (const slot of group) { slot.chordSize = group.length; if (invalid) slot.reason = chordReason; }
      }
    });
  });
  return result;
}
export function scoreAuthoringSlots(song: Song): ScoreSlot[] {
  return slots(read(song)).map(({ node: _node, divisions: _divisions, chord: _chord, ...slot }) => slot);
}
function make(doc: Document, original: Element, beats: number, divisions: number, pitch?: number): Element {
  const { type, dots } = notation(beats);
  const units = beats * divisions;
  if (!Number.isInteger(units) || units <= 0) throw Error('This duration cannot be represented with the score’s divisions.');
  const result = doc.createElementNS(original.namespaceURI, 'note');
  const add = (parent: Element, name: string, text?: string) => {
    const child = doc.createElementNS(original.namespaceURI, name);
    if (text !== undefined) child.textContent = text;
    parent.appendChild(child); return child;
  };
  if (pitch === undefined) add(result, 'rest');
  else {
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw Error('Pitch must be a whole MIDI number from 0 to 127.');
    const p = add(result, 'pitch');
    add(p, 'step', ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'][pitch % 12]);
    if ([1, 3, 6, 8, 10].includes(pitch % 12)) add(p, 'alter', '1');
    add(p, 'octave', String(Math.floor(pitch / 12) - 1));
  }
  add(result, 'duration', String(units));
  if (one(original, 'voice')) add(result, 'voice', value(original, 'voice'));
  add(result, 'type', type);
  if (dots) add(result, 'dot');
  if (one(original, 'staff')) add(result, 'staff', value(original, 'staff'));
  return result;
}
export type ScoreSlotEdit = { action: 'insert'; pitch: number; beats: number } | { action: 'addChordTone'; pitch: number } | { action: 'delete' } | { action: 'duration'; beats: number };
/** Preserve the exact timeline: exchange notes with rests or change tones at one chord onset. */
export function editScoreSlot(song: Song, sourceId: string, edit: ScoreSlotEdit): Song {
  const doc = read(song), all = slots(doc), slot = all.find(s => s.sourceId === sourceId);
  if (!slot) throw Error('Select an existing written note or rest.');
  if (slot.reason) throw Error(slot.reason);
  if (edit.action === 'insert' && !slot.rest) throw Error('Choose an explicit rest to insert a note.');
  if (edit.action !== 'insert' && slot.rest) throw Error('Choose a sounding note.');
  const mapped = song.notes.find(n => n.sourceNoteIds?.includes(sourceId));
  if (!slot.rest && (!mapped || mapped.sourceNoteIds?.length !== 1)) throw Error('This note has no independent editable playback mapping.');
  if (edit.action === 'duration' && slot.chordSize > 1) throw Error('Chord durations cannot be changed here. Add or remove a tone without changing its timing.');
  if (edit.action === 'delete' && song.notes.length === 1) throw Error('Keep at least one sounding note in the score. All-rest scores are not supported.');
  if (edit.action === 'addChordTone') {
    const chordIds = new Set(slot.chord.map(s => s.sourceId));
    if (song.notes.some(n => n.pitch === edit.pitch && n.sourceNoteIds?.some(id => chordIds.has(id))))
      throw Error('This chord already contains that pitch. Choose a different pitch.');
    const added = make(doc, slot.node, slot.beats, slot.divisions, edit.pitch);
    added.insertBefore(doc.createElementNS(slot.node.namespaceURI, 'chord'), added.firstChild);
    // Copy the group's written rhythm exactly, without copying the selected
    // pitch's accidental, fingering, or vertical engraving offsets to a new tone.
    const rhythm = children(slot.node).filter(n => ['type', 'dot'].includes(n.localName ?? ''));
    for (const n of children(added).filter(n => ['type', 'dot'].includes(n.localName ?? ''))) added.removeChild(n);
    for (const n of rhythm) {
      const rhythmNode = doc.createElementNS(slot.node.namespaceURI, n.localName!);
      if (n.localName === 'type') rhythmNode.textContent = n.textContent;
      added.insertBefore(rhythmNode, one(added, 'staff') ?? null);
    }
    if (one(slot.node, 'stem')) {
      const stem = doc.createElementNS(slot.node.namespaceURI, 'stem');
      stem.textContent = value(slot.node, 'stem');
      added.insertBefore(stem, one(added, 'staff') ?? null);
    }
    const last = slot.chord[slot.chord.length - 1].node;
    last.parentNode!.insertBefore(added, last.nextSibling);
    return finish(song, doc, all, new Set());
  }
  if (edit.action === 'delete' && slot.chordSize > 1) {
    // Only the leader advances MusicXML's cursor. Promote its next tone rather
    // than inserting a rest, which would move the remaining chord's onset.
    if (slot === slot.chord[0]) {
      const promoted = slot.chord[1].node;
      promoted.removeChild(one(promoted, 'chord')!);
    }
    slot.node.parentNode!.removeChild(slot.node);
    return finish(song, doc, all, new Set([slot]));
  }
  const beats = edit.action === 'delete' ? slot.beats : edit.beats;
  notation(beats);
  let capacity = slot.beats;
  let consumed: Slot | undefined;
  if (beats > capacity + 1e-8) {
    if (edit.action === 'insert') throw Error('The new note must fit within the selected rest.');
    const siblings = children(slot.node.parentNode as Element);
    const next = siblings[siblings.indexOf(slot.node) + 1];
    consumed = all.find(s => s.node === next);
    if (!consumed?.rest || consumed.reason || consumed.voice !== slot.voice || consumed.staff !== slot.staff || consumed.divisions !== slot.divisions)
      throw Error('Lengthening requires an immediately following plain rest in the same voice and staff.');
    capacity += consumed.beats;
    if (beats > capacity + 1e-8) throw Error('The duration exceeds the note and following rest.');
  }
  let replacement = make(doc, slot.node, beats, slot.divisions, edit.action === 'delete' ? undefined : edit.action === 'insert' ? edit.pitch : mapped!.pitch);
  // Resize the existing note rather than rebuilding its spelling/display/fingering.
  if (edit.action === 'duration') {
    replacement = slot.node.cloneNode(true) as Element;
    one(replacement, 'duration')!.textContent = String(beats * slot.divisions);
    const generatedType = one(make(doc, slot.node, beats, slot.divisions), 'type')!;
    const originalType = one(replacement, 'type');
    if (originalType) originalType.textContent = generatedType.textContent;
    else {
      const following = children(replacement).find(n => ['dot', 'accidental', 'stem', 'staff', 'notations'].includes(n.localName ?? ''));
      replacement.insertBefore(generatedType, following ?? null);
    }
    const dots = children(replacement).filter(n => n.localName === 'dot');
    const keepDot = notation(beats).dots ? dots[0] : undefined;
    for (const dot of dots) if (dot !== keepDot) replacement.removeChild(dot);
    if (notation(beats).dots && !keepDot) replacement.insertBefore(doc.createElementNS(replacement.namespaceURI, 'dot'), (originalType ?? generatedType).nextSibling);
  }
  // The replacement keeps the selected slot's coordinates. A newly split
  // rest has no inherited coordinates; a surviving consumed rest keeps its own.
  if (edit.action !== 'duration') copyPosition(slot.node, replacement);
  const remaining = capacity - beats;
  const rest = remaining > 1e-8 ? make(doc, consumed?.node ?? slot.node, remaining, slot.divisions) : undefined;
  if (rest && consumed) copyPosition(consumed.node, rest);
  const sourceRest = one(consumed?.node ?? slot.node, 'rest');
  if (rest && sourceRest) {
    const display = sourceRest.cloneNode(true) as Element;
    // A remainder is no longer a whole-measure rest, but its display position
    // (often supplied by recognition software) remains meaningful.
    display.removeAttribute('measure');
    rest.replaceChild(display, one(rest, 'rest')!);
  }
  const parent = slot.node.parentNode!;
  parent.replaceChild(replacement, slot.node);
  if (rest) parent.insertBefore(rest, replacement.nextSibling);
  if (consumed) parent.removeChild(consumed.node);
  return finish(song, doc, all, new Set(consumed ? [slot, consumed] : [slot]));
}
function finish(song: Song, doc: Document, all: Slot[], replaced: Set<Slot>): Song {
  const parsed = parseMusicXml(new XMLSerializer().serializeToString(doc));
  const before = parseMusicXml(song.scoreXml!);
  if (JSON.stringify(before.scoreTimeline.measures) !== JSON.stringify(parsed.scoreTimeline.measures) || JSON.stringify(before.measureStartTempos) !== JSON.stringify(parsed.measureStartTempos))
    throw Error('This edit would change measure timing or tempo. Use a notation editor instead.');
  const newSlots = slots(doc);
  const newIds = new Map(newSlots.map(s => [s.node, s.sourceId]));
  const beforeEntries = new Map(before.scoreTimeline.entries.map(e => [e.sourceNoteId, e]));
  const afterEntries = new Map(parsed.scoreTimeline.entries.map(e => [e.sourceNoteId, e]));
  for (const old of all) {
    if (replaced.has(old)) continue;
    const newId = newIds.get(old.node);
    const a = beforeEntries.get(old.sourceId);
    const b = afterEntries.get(newId ?? '');
    if (!a || !b || a.start !== b.start || a.duration !== b.duration || a.writtenStart !== b.writtenStart)
      throw Error('This edit would move another note. Use a notation editor instead.');
  }
  const mapping = new Map(all.filter(s => !replaced.has(s)).map(s => [s.sourceId, newIds.get(s.node)]));
  const replacedIds = new Set([...replaced].map(s => s.sourceId));
  const afterNotes = new Map(parsed.song.notes.map(n => [JSON.stringify(n.sourceNoteIds), n]));
  for (const note of before.song.notes) {
    if (note.sourceNoteIds?.some(id => replacedIds.has(id))) continue;
    const ids = note.sourceNoteIds?.map(id => mapping.get(id));
    const after = afterNotes.get(JSON.stringify(ids));
    if (!after || note.pitch !== after.pitch || note.start !== after.start || note.duration !== after.duration || note.finger !== after.finger || note.hand !== after.hand || note.velocity !== after.velocity)
      throw Error('This edit would change another note’s playback. Use a notation editor instead.');
  }
  const next = parsed.song;
  return { ...next, id: song.id, title: song.title, ...(song.folderSource ? { folderSource: { ...song.folderSource } } : {}) };
}
