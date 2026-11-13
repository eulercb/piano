// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import { importScoreFile } from './scoreImport';
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
vi.mock('./scoreImport', () => ({ importScoreFile: vi.fn() }));
const result = { format: 'mxl' as const, scoreTimeline: { entries: [], measures: [], duration: 1 }, warnings: [], measureStartTempos: [120], tempoMap: [{ beat: 0, seconds: 0, bpm: 120 }], song: { id: 'fixture', title: 'Imported synthetic score', tempo: 120, notes: [{ id: 'n', pitch: 60, start: 0, duration: 1, velocity: .7, hand: 'right' as const, finger: 2 }] } };
beforeEach(() => { localStorage.clear(); vi.mocked(importScoreFile).mockReset(); vi.mocked(importScoreFile).mockResolvedValue(result as Awaited<ReturnType<typeof importScoreFile>>); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('offers .mxl and routes a chosen compressed score through the bounded reader', async () => {
  const { container } = renderPractice(<App />);
  const input = container.querySelector('input[type="file"]')!;
  expect(input.getAttribute('accept')).toContain('.mxl');
  const file = new File(['synthetic'], 'study.mxl');
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole('heading', { name: 'Imported synthetic score' });
  expect(importScoreFile).toHaveBeenCalledWith(file);
  const saved = JSON.parse(localStorage.getItem('piano-songs')!);
  expect(saved[0].notes[0].finger).toBe(2);
});
it('keeps the current song and library intact when compressed input is rejected', async () => {
  vi.mocked(importScoreFile).mockRejectedValue(new Error('Invalid compressed score.'));
  const { container } = renderPractice(<App />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['bad'], 'bad.MXL')] } });
  await screen.findByText('Invalid compressed score.');
  expect(screen.getByRole('heading', { name: 'Morning Light' })).toBeTruthy();
  expect(localStorage.getItem('piano-songs')).toBeNull();
});
it('includes compressed scores from an explicitly selected read-only folder', async () => {
  const file = new File(['synthetic'], 'study.mxl');
  const picker = vi.fn().mockResolvedValue({ async *values() { yield { kind: 'file', name: file.name, getFile: async () => file }; } });
  vi.stubGlobal('showDirectoryPicker', picker);
  renderPractice(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'My library' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open song folder' }));
  await waitFor(() => expect(importScoreFile).toHaveBeenCalledWith(file));
  await screen.findByRole('heading', { name: 'Imported synthetic score' });
  expect(picker).toHaveBeenCalledWith({ mode: 'read' });
});

it('reports rejected folder scores without claiming successful import', async () => {
  vi.mocked(importScoreFile).mockRejectedValue(new Error('Invalid compressed score.'));
  const file = new File(['bad'], 'bad.mxl');
  vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue({
    async *values() { yield {kind: 'file', name: file.name, getFile: async () => file}; }
  }));
  renderPractice(<App />);
  fireEvent.click(screen.getByRole('button', {name: 'My library'}));
  fireEvent.click(screen.getByRole('button', {name: 'Open song folder'}));
  await screen.findByText(/Folder refresh: 0 imported.*1 rejected.*Invalid compressed score/);
  expect(localStorage.getItem('piano-songs')).toBeNull();
});
