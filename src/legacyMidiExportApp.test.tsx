// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './main';
import { type Song } from './music';
import { parseProject } from './project';
import { SONGS_KEY } from './songLibrary';
import { stubDialogs } from './testDialog';
import { clickDownload } from './testDownload';

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker: vi.fn() }) }));
vi.mock('./Score', () => ({ Score: () => null }));
vi.mock('./MidiConnection', () => ({ MidiConnection: () => null }));
const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
const source: Song = { id:'audit-app',title:'Synthetic overlap Studio',tempo:120,duration:3,scoreXml:xml,notes:[
  {id:'outer',pitch:60,start:0,duration:3,velocity:100/127,hand:'right',finger:3},
] };
let downloads: Blob[];
beforeEach(()=>{
  stubDialogs();localStorage.clear();downloads=[];
  vi.spyOn(window,'confirm').mockReturnValue(false);
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  vi.stubGlobal('URL',class extends URL { static createObjectURL(blob:Blob){downloads.push(blob);return 'blob:audit';} static revokeObjectURL(){} });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
const button=(name:string)=>screen.getByRole('button',{name});
const change=(name:string,value:string)=>fireEvent.change(screen.getByRole('spinbutton',{name:new RegExp(`^${name}`)}),{target:{value}});
function read(blob:Blob,asText=false):Promise<string|ArrayBuffer>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as string|ArrayBuffer);r.onerror=reject;if(asText)r.readAsText(blob);else r.readAsArrayBuffer(blob);});}
it.each([true, false])('refuses an incompatible Studio MIDI download and preserves project/reference-score recovery and saved original (reference score: %s)',async(withScore)=>{
  const view=render(<App/>);
  const serialized=JSON.stringify({version:1,song:{ ...source, scoreXml: withScore ? xml : undefined }});
  const input=Object.assign(new File([serialized],'audit.piano.json'),{text:async()=>serialized});
  fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[input]}});
  await screen.findByRole('heading',{name:source.title});
  await screen.findByRole('heading',{name:'Add, delete & retime notes'});
  const saved=localStorage.getItem(SONGS_KEY);
  fireEvent.click(button('Add a note'));
  change('New note pitch','60');change('Start','1');change('Duration','1');
  fireEvent.click(button('Add note'));
  fireEvent.click(button('Export MIDI'));
  fireEvent.click(button('Export MIDI'));
  expect(downloads).toHaveLength(0);
  expect(screen.getByText(/overlapping notes.*Piano project/)).toBeTruthy();
  expect(localStorage.getItem(SONGS_KEY)).toBe(saved);
  clickDownload(button('Export project + fingers'));
  const project=parseProject(await read(downloads.at(-1)!,true) as string);
  expect(project.notes.map(n=>[n.start,n.duration,Math.round(n.velocity*127)]))
    .toEqual([[0,3,100],[1,1,91]]);
  expect(project.notes[0].finger).toBe(3);
  expect(project.scoreXml).toBe(withScore ? xml : undefined);
  if (withScore) {
    clickDownload(button('Export MusicXML'));
    expect(await read(downloads.at(-1)!,true)).toBe(xml);
  }
  expect(localStorage.getItem(SONGS_KEY)).toBe(saved);
});
