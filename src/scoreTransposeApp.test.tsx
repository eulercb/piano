// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import xml from '../fixtures/transpose-cues.musicxml?raw';
import { App } from './main';
import type { Song } from './music';
import { parseMusicXml } from './musicxml';
import { parseProject } from './project';
import { SONGS_KEY } from './songLibrary';
import { clickDownload } from './testDownload';
import { stubDialogs } from './testDialog';

// Real App, source import/transposition, storage, export and project recovery.
// Drawing (covered with real OSMD separately), native dialogs and downloads
// are isolated from jsdom; no browser/device acceptance is implied.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: ({ xml }: { xml?: string }) => <output data-testid="score-source">{xml}</output> }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
let downloads: Blob[];
beforeEach(() => {
  stubDialogs(); localStorage.clear(); downloads = [];
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('URL', class extends URL { static createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:synthetic'; } static revokeObjectURL() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const button = (name: string) => screen.getByRole('button', { name });
const saved = (): Song[] => JSON.parse(localStorage.getItem(SONGS_KEY) ?? '[]');
function choose(container: HTMLElement, text: string, name: string) {
  const file = Object.assign(new File([text], name), { text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
}
async function open(container: HTMLElement, source = xml) {
  choose(container, source, 'synthetic.musicxml');
  await screen.findByRole('heading', { name: 'Synthetic cue transposition' });
  await screen.findByRole('combobox', { name: 'Written slot' });
}
function downloadText() {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(downloads.at(-1)!);
  });
}
async function exportProject() { clickDownload(button('Export project + fingers')); return downloadText(); }

it('transposes silent cues through Studio, repeated edits, MusicXML/project export, Save and reimport', async () => {
  const view = renderPractice(<App />); await open(view.container);
  const original = saved()[0];
  expect(original.notes).toHaveLength(5);
  fireEvent.click(button('+ Semitone')); fireEvent.click(button('+ Semitone'));
  const draft = parseProject(await exportProject());
  expect(draft.notes).toEqual(original.notes.map(n => ({ ...n, pitch: n.pitch + 2 })));
  const doc = new DOMParser().parseFromString(draft.scoreXml!, 'application/xml');
  expect(Array.from(doc.querySelectorAll('note')).filter(n => n.querySelector('cue')).map(n => n.querySelector('pitch')!.textContent)).toEqual(['G14', 'B4']);
  expect(screen.getByTestId('score-source').textContent).toBe(draft.scoreXml);
  expect(saved()).toEqual([original]);
  expect(parseMusicXml(draft.scoreXml!).scoreTimeline).toEqual(parseMusicXml(original.scoreXml!).scoreTimeline);
  clickDownload(button('Export MusicXML')); expect(await downloadText()).toBe(draft.scoreXml);
  fireEvent.click(button('− Semitone'));
  expect(parseProject(await exportProject()).notes).toEqual(original.notes.map(n => ({ ...n, pitch: n.pitch + 1 })));
  fireEvent.click(button('+ Semitone'));
  expect(parseProject(await exportProject())).toEqual(draft);
  fireEvent.click(button('Save')); await screen.findByText('Saved to your library on this device.');
  expect(saved()).toEqual([draft]);
  choose(view.container, await exportProject(), 'recovered.piano.json');
  await waitFor(() => expect(saved()).toHaveLength(2));
  expect(saved()[0].notes).toEqual(draft.notes);
  expect(saved()[0].scoreXml).toBe(draft.scoreXml);
  expect(saved()[1]).toEqual(draft);
});

it.each([
  { replacement: '<step>F</step><alter>0.5</alter><octave>4</octave>', reason: /supported whole MIDI pitch.*including cue notes/ },
  { replacement: '<step>G</step><octave>9</octave>', reason: /outside the piano MIDI range/ },
])('keeps the open draft, saved source and exports unchanged after refusing $replacement', async ({ replacement, reason }) => {
  const input = xml.replace('<step>F</step><alter>1</alter><octave>4</octave>', replacement);
  const view = renderPractice(<App />); await open(view.container, input);
  const original = saved()[0];
  fireEvent.click(button('+ Semitone'));
  expect(screen.getByText(reason)).toBeTruthy();
  expect(saved()).toEqual([original]);
  expect(screen.getByTestId('score-source').textContent).toBe(input);
  expect(parseProject(await exportProject())).toEqual(original);
  clickDownload(button('Export MusicXML')); expect(await downloadText()).toBe(input);
});
