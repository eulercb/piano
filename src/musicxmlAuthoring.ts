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
export type ScoreSlot = { sourceId: string; measure: string; rest: boolean; beats: number; voice: string; staff: string; reason?: string };
type Slot = ScoreSlot & { node: Element; divisions: number };
function slots(doc: Document): Slot[] {
  const result: Slot[] = [];
  children(doc.documentElement!).filter(e => e.localName === 'part').forEach((part, p) => {
    let divisions = 0;
    children(part).filter(e => e.localName === 'measure').forEach((measure, m) => {
      let index = 0;
      const items = children(measure);
      const nextTimedNodes = new Map<Element, Element | undefined>();
      let nextTimed: Element | undefined;
      for (let i = items.length - 1; i >= 0; i--) {
        nextTimedNodes.set(items[i], nextTimed);
        if (['note', 'backup', 'forward'].includes(items[i].localName ?? '')) nextTimed = items[i];
      }
      items.forEach((node) => {
        if (node.localName === 'attributes' && one(node, 'divisions')) divisions = Number(value(node, 'divisions'));
        if (node.localName !== 'note') return;
        const fingeringOnly = (n: Element): boolean => n.localName === 'notations' && !n.attributes.length && children(n).every(t => t.localName === 'technical' && !t.attributes.length && children(t).every(f => f.localName === 'fingering'));
        const unsupported = children(node).find(e => !['pitch', 'rest', 'duration', 'voice', 'type', 'dot', 'accidental', 'stem', 'staff'].includes(e.localName ?? '') && !fingeringOnly(e));
        const nextTimed = nextTimedNodes.get(node);
        const chordFollower = nextTimed?.localName === 'note' && one(nextTimed, 'chord');
        result.push({ sourceId: `${p}:${m}:${index++}`, measure: measure.getAttribute('number') || String(m + 1), rest: !!one(node, 'rest'), beats: Number(value(node, 'duration')) / divisions,
          voice: value(node, 'voice') || '1', staff: value(node, 'staff') || '1', node, divisions,
          reason: node.attributes.length || unsupported || chordFollower ? 'This slot has a chord, tie, grace/cue, beam, tuplet or other attached notation/attributes (simple fingerings are supported). Structural editing is not supported here.' : undefined });
      });
    });
  });
  return result;
}
export function scoreAuthoringSlots(song: Song): ScoreSlot[] {
  return slots(read(song)).map(({ node: _node, divisions: _divisions, ...slot }) => slot);
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
export type ScoreSlotEdit = { action: 'insert'; pitch: number; beats: number } | { action: 'delete' } | { action: 'duration'; beats: number };
/** Preserve the exact timeline: edits exchange sounding duration with explicit rests. */
export function editScoreSlot(song: Song, sourceId: string, edit: ScoreSlotEdit): Song {
  const doc = read(song), all = slots(doc), slot = all.find(s => s.sourceId === sourceId);
  if (!slot) throw Error('Select an existing written note or rest.');
  if (slot.reason) throw Error(slot.reason);
  if (edit.action === 'insert' && !slot.rest) throw Error('Choose an explicit rest to insert a note.');
  if (edit.action !== 'insert' && slot.rest) throw Error('Choose a sounding note.');
  const mapped = song.notes.find(n => n.sourceNoteIds?.includes(sourceId));
  if (!slot.rest && (!mapped || mapped.sourceNoteIds?.length !== 1)) throw Error('This note has no independent editable playback mapping.');
  if (edit.action === 'delete' && song.notes.length === 1) throw Error('Keep at least one sounding note in the score. All-rest scores are not supported.');
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
    if (originalType) replacement.replaceChild(generatedType, originalType);
    else {
      const following = children(replacement).find(n => ['dot', 'accidental', 'stem', 'staff', 'notations'].includes(n.localName ?? ''));
      replacement.insertBefore(generatedType, following ?? null);
    }
    for (const dot of children(replacement).filter(n => n.localName === 'dot')) replacement.removeChild(dot);
    if (notation(beats).dots) replacement.insertBefore(doc.createElementNS(replacement.namespaceURI, 'dot'), generatedType.nextSibling);
  }
  const remaining = capacity - beats;
  const rest = remaining > 1e-8 ? make(doc, slot.node, remaining, slot.divisions) : undefined;
  const parent = slot.node.parentNode!;
  parent.replaceChild(replacement, slot.node);
  if (rest) parent.insertBefore(rest, replacement.nextSibling);
  if (consumed) parent.removeChild(consumed.node);
  const parsed = parseMusicXml(new XMLSerializer().serializeToString(doc));
  const before = parseMusicXml(song.scoreXml!);
  if (JSON.stringify(before.scoreTimeline.measures) !== JSON.stringify(parsed.scoreTimeline.measures) || JSON.stringify(before.measureStartTempos) !== JSON.stringify(parsed.measureStartTempos))
    throw Error('This edit would change measure timing or tempo. Use a notation editor instead.');
  const newSlots = slots(doc);
  const newIds = new Map(newSlots.map(s => [s.node, s.sourceId]));
  const beforeEntries = new Map(before.scoreTimeline.entries.map(e => [e.sourceNoteId, e]));
  const afterEntries = new Map(parsed.scoreTimeline.entries.map(e => [e.sourceNoteId, e]));
  for (const old of all) {
    if (old === slot || old === consumed) continue;
    const newId = newIds.get(old.node);
    const a = beforeEntries.get(old.sourceId);
    const b = afterEntries.get(newId ?? '');
    if (!a || !b || a.start !== b.start || a.duration !== b.duration || a.writtenStart !== b.writtenStart)
      throw Error('This edit would move another note. Use a notation editor instead.');
  }
  const mapping = new Map(all.filter(s => s !== slot && s !== consumed).map(s => [s.sourceId, newIds.get(s.node)]));
  const afterNotes = new Map(parsed.song.notes.map(n => [JSON.stringify(n.sourceNoteIds), n]));
  for (const note of before.song.notes) {
    if (note.sourceNoteIds?.includes(sourceId)) continue;
    const ids = note.sourceNoteIds?.map(id => mapping.get(id));
    const after = afterNotes.get(JSON.stringify(ids));
    if (!after || note.pitch !== after.pitch || note.start !== after.start || note.duration !== after.duration || note.finger !== after.finger || note.hand !== after.hand || note.velocity !== after.velocity)
      throw Error('This edit would change another note’s playback. Use a notation editor instead.');
  }
  const next = parsed.song;
  return { ...next, id: song.id, title: song.title, ...(song.folderSource ? { folderSource: { ...song.folderSource } } : {}) };
}
