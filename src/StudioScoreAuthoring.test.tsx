// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Song } from './music';
import { editScoreSlot, scoreAuthoringSlots } from './musicxmlAuthoring';
import { StudioScoreAuthoring } from './StudioScoreAuthoring';
import { parseMusicXml } from './musicxml';
afterEach(cleanup);
const score = () => parseMusicXml('<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><type>half</type></note><note><rest/><duration>8</duration><type>half</type></note></measure><measure number="2"><note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note></measure></part></score-partwise>').song;
describe('MusicXML authoring controls', () => {
  it('prefills duration and updates draft on slot selection without erasing first typing', () => {
    render(<StudioScoreAuthoring song={score()} onChange={vi.fn()} />);
    expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('Written slot'), { target: { value: '0:1:0' } });
    expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('4');
    fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '2' } });
    expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('2');
  });
  it('inserts from an explicit rest with synchronized callback', () => {
    const onChange = vi.fn();
    render(<StudioScoreAuthoring song={score()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Written slot'), { target: { value: '0:0:1' } });
    fireEvent.change(screen.getByLabelText('New pitch (MIDI)'), { target: { value: '62' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert into rest' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].notes.find((n: {pitch: number}) => n.pitch === 62)).toMatchObject({ start: 1, duration: 1 });
    expect(onChange.mock.calls[0][1]).toEqual({ action: 'insert', noteId: null });
  });
  it('cancels, confirms once, and invalidates confirmation when song changes', () => {
    const onChange = vi.fn(), s = score();
    const view = render(<StudioScoreAuthoring song={s} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace note with rest' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep written note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep written note' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace note with rest' }));
    view.rerender(<StudioScoreAuthoring song={{ ...s }} onChange={onChange} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replace note with rest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm replace with rest' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it('shows a clear error for stale source and disables writes', () => {
    const s = score(); s.tempo = 77;
    render(<StudioScoreAuthoring song={s} onChange={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('out of date');
    expect((screen.getByRole('button', { name: 'Apply written duration' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });
  it('does not retain stale pitch/duration inputs after external song changes', () => {
    const s = score(), onChange = vi.fn();
    const view = render(<StudioScoreAuthoring song={s} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Written slot'), { target: { value: '0:0:1' } });
    fireEvent.change(screen.getByLabelText('New pitch (MIDI)'), { target: { value: '77' } });
    fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '.5' } });
    view.rerender(<StudioScoreAuthoring song={score()} onChange={onChange} />);
    expect((screen.getByLabelText('New pitch (MIDI)') as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('2');
  });
});

it('adds a chord tone without using the duration draft and exposes operation-specific controls', () => {
  const onChange = vi.fn(), input = score();
  const view = render(<StudioScoreAuthoring song={input} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '.5' } });
  fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'), { target: { value: '67' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add chord tone' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][1]).toEqual({ action: 'insert', noteId: null });
  const next = onChange.mock.calls[0][0];
  expect(next.notes.find((n: {pitch: number; start: number}) => n.pitch === 67 && n.start === 0)).toMatchObject({ duration: 1 });
  view.rerender(<StudioScoreAuthoring song={next} onChange={onChange} />);
  expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Apply chord duration' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText(/Duration changes apply to all 2 tones/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Add chord tone' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('combobox', { name: 'Written slot' }).textContent).toContain('MIDI 64 · 2-tone chord');
  expect(screen.getByRole('button', { name: 'Remove chord tone' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Replace note with rest' })).toBeNull();
});

it('requires chord-tone confirmation, supports cancel and invalidates it on selection or source replacement', () => {
  const onChange = vi.fn(), input = score();
  // An independent real callback constructs the initial chord as the UI does.
  const initial = render(<StudioScoreAuthoring song={input} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'), { target: { value: '67' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add chord tone' }));
  const chord = onChange.mock.calls[0][0]; onChange.mockClear();
  initial.rerender(<StudioScoreAuthoring song={chord} onChange={onChange} />);
  const remove = () => fireEvent.click(screen.getByRole('button', { name: 'Remove chord tone' }));
  remove();
  expect(screen.getByRole('alertdialog', { name: 'Remove chord tone confirmation' }).textContent).toContain('Remove MIDI 64');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep written note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep written note' }));
  expect(onChange).not.toHaveBeenCalled();
  remove();
  fireEvent.change(screen.getByLabelText('Written slot'), { target: { value: '0:0:1' } });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  remove();
  initial.rerender(<StudioScoreAuthoring song={{ ...chord }} onChange={onChange} />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  remove();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm remove chord tone' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][1]).toEqual({ action: 'delete', noteId: null });
  expect(onChange.mock.calls[0][0].notes).toHaveLength(input.notes.length);
});

it('rejects a duplicate or blank chord pitch without issuing a change and permits correction', () => {
  const onChange = vi.fn();
  render(<StudioScoreAuthoring song={score()} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add chord tone' }));
  expect(screen.getByRole('alert').textContent).toContain('already contains');
  fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add chord tone' }));
  expect(screen.getByRole('alert').textContent).toContain('Pitch');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'), { target: { value: '65' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add chord tone' }));
  expect(onChange).toHaveBeenCalledTimes(1);
});


it.each(['0:0:0', '0:0:1'])('applies an explicit whole-chord duration from %s without inserting the new-pitch draft', selected => {
  const input = editScoreSlot(score(), '0:0:0', { action: 'addChordTone', pitch: 67 });
  const onChange = vi.fn();
  const view = render(<StudioScoreAuthoring song={input} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Written slot'), { target: { value: selected } });
  expect(screen.getByText(/Duration changes apply to all 2 tones/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'), { target: { value: '72' } });
  fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply chord duration' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][1]).toEqual({ action: 'edit', noteId: null });
  const next: Song = onChange.mock.calls[0][0];
  expect(next.notes.filter(n => n.start === 0).map(n => [n.pitch, n.duration])).toEqual([[64, 1.5], [67, 1.5]]);
  expect(scoreAuthoringSlots(next).slice(0, 3).map(s => s.beats)).toEqual([3, 3, 1]);
  view.rerender(<StudioScoreAuthoring song={next} onChange={onChange} />);
  expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('3');
  fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply chord duration' }));
  expect(onChange.mock.calls[1][0].notes.filter((n: {start: number}) => n.start === 0).map((n: {duration: number}) => n.duration)).toEqual([.5, .5]);
});

it('rejects invalid chord durations without changing the song and permits correction', () => {
  const input = editScoreSlot(score(), '0:0:0', { action: 'addChordTone', pitch: 67 }), onChange = vi.fn();
  render(<StudioScoreAuthoring song={input} onChange={onChange} />);
  for (const value of ['', '1.25', '6']) {
    fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply chord duration' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  }
  fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply chord duration' }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('resizes repeatedly without extra rests and keeps chord removal confirmed once', () => {
  const input = editScoreSlot(score(), '0:0:0', { action: 'addChordTone', pitch: 67 });
  const changes = vi.fn(); let latest = input;
  function Harness() {
    const [song, setSong] = useState(input); latest = song;
    return <StudioScoreAuthoring song={song} onChange={next => { changes(next); setSong(next); }} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '1' } });
  const apply = screen.getByRole('button', { name: 'Apply chord duration' });
  act(() => { fireEvent.click(apply); fireEvent.click(apply); });
  expect(scoreAuthoringSlots(latest).map(s => s.beats)).toEqual([1, 1, 1, 2, 4]);
  expect(changes.mock.calls.every(([next]) => JSON.stringify(next) === JSON.stringify(latest))).toBe(true);
  // A later click at the same duration does not split another rest.
  fireEvent.click(screen.getByRole('button', { name: 'Apply chord duration' }));
  expect(scoreAuthoringSlots(latest).map(s => s.beats)).toEqual([1, 1, 1, 2, 4]);
  fireEvent.click(screen.getByRole('button', { name: 'Remove chord tone' }));
  expect((apply.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  const pendingChanges = changes.mock.calls.length;
  fireEvent.click(apply);
  expect(changes).toHaveBeenCalledTimes(pendingChanges);
  fireEvent.click(screen.getByRole('button', { name: 'Keep written note' }));
  expect(latest.notes.filter(n => n.start === 0)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Remove chord tone' }));
  const confirm = screen.getByRole('button', { name: 'Confirm remove chord tone' });
  const before = changes.mock.calls.length;
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(changes).toHaveBeenCalledTimes(before + 1);
  expect(latest.notes.filter(n => n.start === 0).map(n => [n.pitch, n.duration])).toEqual([[67, .5]]);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Apply written duration' })).toBeTruthy();
});

it('invalidates chord duration drafts and confirmations when the source becomes stale or unsupported', () => {
  const input = editScoreSlot(score(), '0:0:0', { action: 'addChordTone', pitch: 67 }), onChange = vi.fn();
  const view = render(<StudioScoreAuthoring song={input} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Duration (quarter-note beats)'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove chord tone' }));
  view.rerender(<StudioScoreAuthoring song={{ ...input, tempo: 77 }} onChange={onChange} />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('out of date');
  expect(onChange).not.toHaveBeenCalled();
  const unsupported = parseMusicXml(input.scoreXml!.replace('<chord/>', '<chord/><beam>begin</beam>')).song;
  view.rerender(<StudioScoreAuthoring song={unsupported} onChange={onChange} />);
  expect((screen.getByRole('button', { name: 'Apply chord duration' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  expect((screen.getByLabelText('Duration (quarter-note beats)') as HTMLInputElement).value).toBe('2');
  expect(screen.getByText(/This chord is not supported/)).toBeTruthy();
});
