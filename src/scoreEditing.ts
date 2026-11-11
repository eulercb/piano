import {
  DOMParser,
  XMLSerializer,
  type Element,
  type Document,
} from "@xmldom/xmldom";
import { parseMusicXml } from "./musicxml";
import type { Note, Song } from "./music";
import { passageTitle } from "./songTitle";
const children = (node: Element, name: string): Element[] =>
  Array.from(node.childNodes).filter(
    (n): n is Element => n.nodeType === 1 && (n as Element).localName === name,
  );
const first = (node: Element, name: string) => children(node, name)[0];
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
function source(song: Song) {
  if (song.scoreOrigin !== "musicxml" || !song.scoreXml)
    throw Error(
      "This song has no editable MusicXML source. Import its MusicXML first.",
    );
  parseMusicXml(song.scoreXml);
  return new DOMParser().parseFromString(song.scoreXml, "application/xml");
}
function resolve(doc: Document, id: string) {
  const indices = id.split(":").map(Number);
  if (
    indices.length !== 3 ||
    indices.some((n) => !Number.isInteger(n) || n < 0)
  )
    throw Error("Invalid score note mapping.");
  const part = children(doc.documentElement!, "part")[indices[0]],
    measure = part && children(part, "measure")[indices[1]],
    note = measure && children(measure, "note")[indices[2]];
  if (!note)
    throw Error("Score mapping is out of date. Reimport the MusicXML.");
  return note;
}
function child(doc: Document, parent: Element, name: string) {
  let e = first(parent, name);
  if (!e) {
    e = doc.createElementNS(parent.namespaceURI, name);
    parent.appendChild(e);
  }
  return e;
}
function strip(node: Element, name: string) {
  for (const e of children(node, name)) node.removeChild(e);
}
function songFrom(doc: Document, original: Song) {
  const result = parseMusicXml(serialize(doc));
  // Provenance describes the imported source bytes, not the edited playback.
  // Preserve it even for derived passages so refresh can recognize that source
  // without replacing any saved edits or creating another unchanged import.
  return {
    ...result.song, id: original.id, title: original.title,
    ...(original.folderSource ? { folderSource: {
      folderId: original.folderSource.folderId,
      name: original.folderSource.name,
      digest: original.folderSource.digest,
    } } : {}),
  };
}
/** Edit the source and derive playback again, keeping score and performance together. */
export function editScoreNote(
  song: Song,
  noteId: string,
  patch: Pick<Partial<Note>, "pitch" | "finger" | "hand">,
): Song {
  const doc = source(song),
    note = song.notes.find((n) => n.id === noteId);
  if (!note?.sourceNoteIds?.length)
    throw Error("This note has no editable score mapping.");
  if (
    patch.pitch !== undefined &&
    (!Number.isInteger(patch.pitch) || patch.pitch < 0 || patch.pitch > 127)
  )
    throw Error("Pitch must be a whole MIDI number from 0 to 127.");
  if (
    patch.finger !== undefined &&
    (!Number.isInteger(patch.finger) || patch.finger < 1 || patch.finger > 5)
  )
    throw Error("Finger must be 1 to 5.");
  const names = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"],
    sharps = [1, 3, 6, 8, 10];
  note.sourceNoteIds.forEach((id, index) => {
    const element = resolve(doc, id);
    if (patch.pitch !== undefined) {
      const p = child(doc, element, "pitch");
      child(doc, p, "step").textContent = names[patch.pitch % 12];
      strip(p, "alter");
      const octave = child(doc, p, "octave");
      octave.textContent = String(Math.floor(patch.pitch / 12) - 1);
      if (sharps.includes(patch.pitch % 12)) {
        const alter = doc.createElementNS(p.namespaceURI, "alter");
        alter.textContent = "1";
        p.insertBefore(alter, octave);
      }
      strip(element, "accidental");
    }
    if ("finger" in patch) {
      const notations = first(element, "notations"),
        technical = notations && first(notations, "technical");
      if (technical) strip(technical, "fingering");
      if (index === 0 && patch.finger !== undefined) {
        const tech = child(doc, child(doc, element, "notations"), "technical");
        child(doc, tech, "fingering").textContent = String(patch.finger);
      }
    }
    if (patch.hand !== undefined) {
      const [partIndex, measureIndex] = id.split(":").map(Number);
      const part = children(doc.documentElement!, "part")[partIndex];
      let staves = 1;
      for (const measure of children(part, "measure").slice(0, measureIndex + 1))
        for (const attrs of children(measure, "attributes")) {
          const declared = first(attrs, "staves");
          if (declared) staves = Number(declared.textContent);
        }
      if (staves < 2)
        throw Error("Hand reassignment requires a two-staff piano part.");
      const staff = child(doc, element, "staff");
      staff.textContent = patch.hand === "left" ? "2" : "1";
      const afterStaff = Array.from(element.childNodes).find(n => n.nodeType === 1 && ["beam", "notations", "lyric", "play", "listen"].includes((n as Element).localName || ""));
      if (afterStaff) element.insertBefore(staff, afterStaff);

    }
  });
  return songFrom(doc, song);
}
export function scoreMeasures(song: Song): string[] {
  const doc = source(song);
  return children(children(doc.documentElement!, "part")[0], "measure").map(
    (m, i) => m.getAttribute("number") || String(i + 1),
  );
}
/** Trim whole measures, preserving inherited attributes and boundary ties. Indexes are 0-based and end inclusive. */
export function trimScoreMeasures(
  song: Song,
  start: number,
  end: number,
): Song {
  const doc = source(song),
    parts = children(doc.documentElement!, "part"),
    count = children(parts[0], "measure").length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= count
  )
    throw Error("Choose a valid first and last measure.");
  const clearTie = (element: Element, type: string) => {
    for (const t of children(element, "tie"))
      if (t.getAttribute("type") === type) element.removeChild(t);
    for (const notation of children(element, "notations"))
      for (const t of children(notation, "tied"))
        if (t.getAttribute("type") === type) notation.removeChild(t);
  };
  for (const note of song.notes) {
    const ids = note.sourceNoteIds || [],
      kept = ids.filter((id) => {
        const m = Number(id.split(":")[1]);
        return m >= start && m <= end;
      });
    if (!kept.length) continue;
    if (kept[0] !== ids[0]) clearTie(resolve(doc, kept[0]), "stop");
    if (kept.at(-1) !== ids.at(-1))
      clearTie(resolve(doc, kept.at(-1)!), "start");
  }
  for (const part of parts) {
    const measures = children(part, "measure");
    if (measures.length !== count)
      throw Error(
        "Measure trimming requires matching measure counts across parts.",
      );
    const inherited = new Map<string, Element>();
    const tempo = parseMusicXml(song.scoreXml!).measureStartTempos[start];
    for (const measure of measures.slice(0, start)) {
      for (const attrs of children(measure, "attributes"))
        for (const n of Array.from(attrs.childNodes)) {
          if (n.nodeType !== 1) continue;
          const e = n as Element;
          inherited.set(e.localName + ":" + (e.getAttribute("number") || ""), e);
        }

    }
    const firstMeasure = measures[start];
    if (inherited.size) {
      const attrs = doc.createElementNS(firstMeasure.namespaceURI, "attributes");
      for (const e of inherited.values()) attrs.appendChild(e.cloneNode(true));
      firstMeasure.insertBefore(attrs, firstMeasure.firstChild);
    }
    if (tempo) {
      const dir = doc.createElementNS(firstMeasure.namespaceURI, "direction"),
        sound = doc.createElementNS(firstMeasure.namespaceURI, "sound");
      sound.setAttribute("tempo", String(tempo));
      dir.appendChild(sound);
      // OSMD needs the initial divisions/staves/clefs before a direction.
      // Keep inherited tempo ahead of original directions (which may override
      // it), but after leading attributes, including those already in the bar.
      let anchor = firstMeasure.firstChild;
      while (anchor && (anchor.nodeType !== 1 ||
        ["attributes", "print", "barline"].includes((anchor as Element).localName || ""))) anchor = anchor.nextSibling;
      firstMeasure.insertBefore(dir, anchor);
    }
    for (let i = 0; i < measures.length; i++)
      if (i < start || i > end) part.removeChild(measures[i]);
  }
  const trimmed = songFrom(doc, song);
  return {
    ...trimmed,
    id: crypto.randomUUID(),
    title: passageTitle(song.title),
  };
}
export function transposeScore(song: Song, semitones: number): Song {
  const doc = source(song);
  if (!Number.isInteger(semitones))
    throw Error("Transpose by a whole number of semitones.");
  const names = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"],
    sharps = [1, 3, 6, 8, 10];
  for (const note of song.notes) {
    const pitch = note.pitch + semitones;
    if (pitch < 0 || pitch > 127)
      throw Error(
        "Transposition would move a note outside the piano MIDI range.",
      );
    for (const id of note.sourceNoteIds || []) {
      const element = resolve(doc, id),
        p = child(doc, element, "pitch");
      child(doc, p, "step").textContent = names[pitch % 12];
      strip(p, "alter");
      const octave = child(doc, p, "octave");
      octave.textContent = String(Math.floor(pitch / 12) - 1);
      if (sharps.includes(pitch % 12)) {
        const alter = doc.createElementNS(p.namespaceURI, "alter");
        alter.textContent = "1";
        p.insertBefore(alter, octave);
      }
      strip(element, "accidental");
    }
  }
  return songFrom(doc, song);
}
