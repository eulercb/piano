// @vitest-environment jsdom
import original from '../fixtures/trim-pickup-tie-tuplet.musicxml?raw';
import edited from '../fixtures/trim-edited.musicxml?raw';
import failed from '../fixtures/trim-failed.musicxml?raw';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { trimScoreMeasures } from './scoreEditing';
import { parseMusicXml } from './musicxml';
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
it.each([0, 1, 2, 3].flatMap(measure => [false, true].map(isEdited => ({measure, isEdited}))))('renders grand-staff passage $measure (edited: $isEdited)', async ({measure, isEdited}) => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({measureText: (text: string) => ({width: text.length * 6})} as unknown as CanvasRenderingContext2D);
  const container = document.createElement('div');
  Object.defineProperty(container, 'offsetWidth', {value: 1000});
  document.body.append(container);
  const osmd = new OpenSheetMusicDisplay(container, {autoResize: false});
  try {
    // Real OSMD with simulated canvas metrics, not browser visual acceptance.
    const xml = isEdited ? edited : original;
    const { song } = parseMusicXml(xml);
    const before = JSON.stringify(song);
    const trimmed = trimScoreMeasures(song, measure, measure);
    expect(JSON.stringify(song)).toBe(before);
    expect(trimmed.tempo).toBe(song.tempo);
    if (measure === 2 && isEdited) {
      // Captured public-browser failure: changing order must not alter playback,
      // hands, clipped ties, fingering or source mappings.
      const baseline = parseMusicXml(failed).song;
      expect(trimmed.notes).toEqual(baseline.notes);
      expect(trimmed.duration).toEqual(baseline.duration);
      expect(parseMusicXml(trimmed.scoreXml!).scoreTimeline).toEqual(parseMusicXml(failed).scoreTimeline);
    }
    await osmd.load(trimmed.scoreXml!);
    expect(() => osmd.render()).not.toThrow();
  } finally { osmd.dispose(); osmd.clear(); }
});
