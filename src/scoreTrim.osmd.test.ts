// @vitest-environment jsdom
import original from '../fixtures/trim-pickup-tie-tuplet.musicxml?raw';
import edited from '../fixtures/trim-edited.musicxml?raw';
import failed from '../fixtures/trim-failed.musicxml?raw';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { trimScoreMeasures } from './scoreEditing';
import { ScoreCursorFollower } from './scoreCursor';
import { parseMusicXml } from './musicxml';
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it.each([-1, 0, 1, 2, 3].flatMap(measure => [false, true].map(isEdited => ({measure, isEdited}))))('renders grand-staff passage $measure (edited: $isEdited)', async ({measure, isEdited}) => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({measureText: (text: string) => ({width: text.length * 6})} as unknown as CanvasRenderingContext2D);
  const container = document.createElement('div');
  Object.defineProperty(container, 'offsetWidth', {value: 1000});
  document.body.append(container);
  const osmd = new OpenSheetMusicDisplay(container, {autoResize: false, drawingParameters: "compacttight", disableCursor: false, followCursor: false});
  try {
    // Real OSMD with simulated canvas metrics, not browser visual acceptance.
    const xml = isEdited ? edited : original;
    const { song } = parseMusicXml(xml);
    const before = JSON.stringify(song);
    const trimmed = measure < 0 ? song : trimScoreMeasures(song, measure, measure);
    expect(JSON.stringify(song)).toBe(before);
    expect(trimmed.tempo).toBe(song.tempo);
    if (measure === 2 && isEdited) {
      // Captured public-browser failure: changing order must not alter playback,
      // hands, clipped ties or source mappings. A later fingering fix also
      // restores the edited finger from the removed tie start onto the new attack.
      const baseline = parseMusicXml(failed).song;
      expect(trimmed.notes).toEqual(baseline.notes.map(note => note.sourceNoteIds?.includes('0:0:0') ? { ...note, finger: 3 } : note));
      expect(trimmed.scoreXml).toContain('<fingering>3</fingering>');
      expect(trimmed.duration).toEqual(baseline.duration);
      expect(parseMusicXml(trimmed.scoreXml!).scoreTimeline).toEqual(parseMusicXml(failed).scoreTimeline);
    }
    await osmd.load(new DOMParser().parseFromString(trimmed.scoreXml!, "application/xml"));
    expect(() => osmd.render()).not.toThrow();
    const timeline = parseMusicXml(trimmed.scoreXml!).scoreTimeline;
    const heads = Array.from(container.querySelectorAll('.vf-notehead'));
    expect(heads).toHaveLength(timeline.entries.length);
    expect(heads.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.vf-stavetempo')).toHaveLength(measure <= 0 ? 1 : 0);
    for (const head of heads) expect(head.getAttribute('d')?.length).toBeGreaterThan(0);
    expect(osmd.cursor.Iterator.EndReached).toBe(false);
    expect(osmd.cursor.Iterator.CurrentVoiceEntries.length).toBeGreaterThan(0);
    // Only cursor drawing is isolated from jsdom layout. The iterator and SVG
    // note rendering above are real, including original/edited full-score controls.
    vi.spyOn(osmd.cursor, 'show').mockImplementation(() => {});
    const follower = new ScoreCursorFollower(osmd.cursor, timeline, container);
    for (const entry of timeline.entries) {
      const position = follower.position(entry.writtenStart);
      expect(position?.measureIndex).toBe(entry.measureIndex);
      expect(position?.beat).toBeCloseTo(entry.beat, 8);
      expect(osmd.cursor.Iterator.CurrentMeasureIndex).toBe(entry.measureIndex);
      expect(osmd.cursor.Iterator.CurrentRelativeInMeasureTimestamp.RealValue * 4).toBeCloseTo(entry.beat);
    }
    follower.dispose();
  } finally { osmd.dispose(); osmd.clear(); }
});
