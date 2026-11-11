// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
