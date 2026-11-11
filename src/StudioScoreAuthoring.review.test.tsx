// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioScoreAuthoring } from './StudioScoreAuthoring';
import { parseMusicXml } from './musicxml';
afterEach(cleanup);
const xml = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
it('a refused deletion does not poison later confirmations on another slot', () => {
  const changed = vi.fn();
  render(<StudioScoreAuthoring song={parseMusicXml(xml).song} onChange={changed} />);
  fireEvent.change(screen.getByRole('combobox', {name: 'Written slot'}), {target: {value: '0:0:2'}});
  fireEvent.click(screen.getByRole('button', {name: 'Replace note with rest'}));
  fireEvent.click(screen.getByRole('button', {name: 'Confirm replace with rest'}));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/grace|principal/i);
  fireEvent.change(screen.getByRole('combobox', {name: 'Written slot'}), {target: {value: '0:0:0'}});
  fireEvent.click(screen.getByRole('button', {name: 'Replace note with rest'}));
  fireEvent.click(screen.getByRole('button', {name: 'Confirm replace with rest'}));
  expect(changed).toHaveBeenCalledTimes(1);
});
it('invalidates a pending confirmation when the source song snapshot changes', () => {
  const changed = vi.fn(), original = parseMusicXml(xml).song;
  const view = render(<StudioScoreAuthoring song={original} onChange={changed} />);
  fireEvent.click(screen.getByRole('button', {name: 'Replace note with rest'}));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  view.rerender(<StudioScoreAuthoring song={{...original, title: 'Changed source'}} onChange={changed} />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});
it('cancels confirmation on slot selection and uses immediate duration input', () => {
  const changed = vi.fn();
  render(<StudioScoreAuthoring song={parseMusicXml(xml).song} onChange={changed} />);
  fireEvent.click(screen.getByRole('button', {name: 'Replace note with rest'}));
  fireEvent.change(screen.getByRole('combobox', {name: 'Written slot'}), {target: {value: '0:0:3'}});
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.change(screen.getByRole('spinbutton', {name: 'Duration (quarter-note beats)'}), {target: {value: '.5'}});
  fireEvent.click(screen.getByRole('button', {name: 'Apply written duration'}));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][0].notes.find((n: {pitch: number}) => n.pitch === 67).duration).toBe(.25);
});
