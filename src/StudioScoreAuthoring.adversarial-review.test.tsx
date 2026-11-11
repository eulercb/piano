// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {StudioScoreAuthoring} from './StudioScoreAuthoring';
import {parseMusicXml} from './musicxml';
import type {Song} from './music';
afterEach(cleanup);
const raw='<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="0" implicit="yes"><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note></measure></part></score-partwise>';
const button=(name:string)=>screen.getByRole('button',{name});
it('repeated immediate add/remove actions cannot remove another tone or duplicate a tone',()=>{
 const changes=vi.fn();let latest!:Song;
 function Harness(){const [song,setSong]=useState(()=>parseMusicXml(raw).song); latest=song; return <StudioScoreAuthoring song={song} onChange={next=>{changes(next);setSong(next)}}/>;}
 render(<Harness/>);
 fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'),{target:{value:'64'}});
 const add=button('Add chord tone');
 act(()=>{fireEvent.click(add);fireEvent.click(add)});
 expect(latest.notes.map(n=>n.pitch)).toEqual([60,64]);
 const insertionCalls=changes.mock.calls.length;
 expect(insertionCalls).toBeGreaterThanOrEqual(1);
 // React batches this synthetic pair; repeated callbacks must describe the same edit.
 expect(changes.mock.calls.every(([next]) => JSON.stringify(next) === JSON.stringify(latest))).toBe(true);
 fireEvent.click(button('Remove chord tone'));
 const confirm=button('Confirm remove chord tone');
 act(()=>{fireEvent.click(confirm);fireEvent.click(confirm)});
 expect(latest.notes.map(n=>n.pitch)).toEqual([64]);
 expect(changes).toHaveBeenCalledTimes(insertionCalls+1);
 expect(screen.queryByRole('alertdialog')).toBeNull();
 expect((screen.getByLabelText('New chord pitch (MIDI)') as HTMLInputElement).value).toBe('64');
 fireEvent.click(button('Replace note with rest'));
 fireEvent.click(button('Confirm replace with rest'));
 expect(screen.getByRole('alert').textContent).toContain('at least one');
 expect(latest.notes.map(n=>n.pitch)).toEqual([64]);
 expect(changes).toHaveBeenCalledTimes(insertionCalls+1);
 fireEvent.change(screen.getByLabelText('New chord pitch (MIDI)'),{target:{value:'67'}});
 fireEvent.click(button('Add chord tone'));
 expect(latest.notes.map(n=>n.pitch)).toEqual([64,67]);
 expect(screen.queryByRole('alert')).toBeNull();
});
it('replaces confirmation with source validation failure without invoking stale edits',()=>{
 const input=parseMusicXml(raw).song; const onChange=vi.fn();
 const view=render(<StudioScoreAuthoring song={input} onChange={onChange}/>);
 fireEvent.click(button('Replace note with rest'));
 view.rerender(<StudioScoreAuthoring song={{...input,tempo:999}} onChange={onChange}/>);
 expect(screen.queryByRole('alertdialog')).toBeNull();
 expect(screen.getByRole('alert').textContent).toContain('out of date');
 expect(onChange).not.toHaveBeenCalled();
 expect((button('Add chord tone').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
});
