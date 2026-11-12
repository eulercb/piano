// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import xml from '../fixtures/transpose-cues.musicxml?raw';
import { parseMusicXml } from './musicxml';
import { transposeScore } from './scoreEditing';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it.each([-3, 2])('renders every transposed cue, chord and grace from the rewritten source (%i)', async semitones => {
  // Installed OSMD parser/model and SVG engraving are real. jsdom canvas text
  // metrics are simulated; this is not browser/mobile visual acceptance.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 6 }),
  } as unknown as CanvasRenderingContext2D);
  const open = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw new Error('No network allowed'); });
  const container = document.createElement('div');
  Object.defineProperty(container, 'offsetWidth', { value: 1000 });
  document.body.append(container);
  const osmd = new OpenSheetMusicDisplay(container, { autoResize: false, drawingParameters: 'compacttight' });
  const load = async (source: string) => {
    await osmd.load(new DOMParser().parseFromString(source, 'application/xml'));
    osmd.render();
    const notes = osmd.Sheet.SourceMeasures.flatMap(measure =>
      measure.VerticalSourceStaffEntryContainers.flatMap(entry =>
        entry.StaffEntries.filter(Boolean).flatMap(staff =>
          staff.VoiceEntries.flatMap(voice => voice.Notes))));
    const pitched = notes.filter(note => !note.isRest());
    const heads = Array.from(container.querySelectorAll('.vf-notehead'));
    expect(heads).toHaveLength(8); // Seven written pitches, including two cues, plus the rest.
    for (const head of heads) expect(head.getAttribute('d')?.length).toBeGreaterThan(0);
    return {
      pitches: pitched.map(note => note.Pitch.getHalfTone()),
      cues: pitched.filter(note => note.IsCueNote).map(note => note.Pitch.getHalfTone()),
      graces: pitched.filter(note => note.IsGraceNote).map(note => note.Pitch.getHalfTone()),
      rests: notes.filter(note => note.isRest()).length,
    };
  };
  try {
    const original = await load(xml);
    expect(original.pitches).toHaveLength(7);
    expect(original.cues).toHaveLength(2);
    expect(original.graces).toHaveLength(1);
    const transposed = transposeScore(parseMusicXml(xml).song, semitones);
    const rendered = await load(transposed.scoreXml!);
    expect(rendered).toEqual({
      pitches: original.pitches.map(p => p + semitones),
      cues: original.cues.map(p => p + semitones),
      graces: original.graces.map(p => p + semitones),
      rests: original.rests,
    });
    expect(transposed.notes).toHaveLength(5);
    expect(open).not.toHaveBeenCalled();
  } finally { osmd.dispose(); osmd.clear(); }
});
