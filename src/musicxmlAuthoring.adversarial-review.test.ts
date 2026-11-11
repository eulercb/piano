import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXml } from './musicxml';
import { editScoreSlot, scoreAuthoringSlots } from './musicxmlAuthoring';
const note = (step='C', chord=false) => `<note>${chord?'<chord/>':''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>quarter</type><dot/><staff>1</staff></note>`;
const wrap = (body:string) => `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><staves>2</staves></attributes>${body}<note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>`;
const nodes = (xml:string) => Array.from(new DOMParser().parseFromString(xml,'application/xml').getElementsByTagName('*')).filter(n => n.localName==='note');
it('does not transfer selected-tone dot coordinates to a new tone',()=>{
 const input=parseMusicXml(wrap(note().replace('<dot/>','<dot default-x="22" default-y="-25" relative-y="5"/>'))).song;
 const result=editScoreSlot(input,'0:0:0',{action:'addChordTone',pitch:84});
 const dots=nodes(result.scoreXml!).slice(0,2).map(n=>n.getElementsByTagName('dot')[0]);
 expect(dots[0].getAttribute('default-y')).toBe('-25');
 expect(dots[1].attributes.length).toBe(0);
});
it('does not permit nested unsupported notation disguised as a fingering',()=>{
 const input=parseMusicXml(wrap(note()+note('E',true).replace('</note>','<notations><technical><fingering><slur type="start"/></fingering></technical></notations></note>'))).song;
 expect(scoreAuthoringSlots(input)[0].reason).toMatch(/not supported/);
});
it('preserves a second part while reindexing the edited chord',()=>{
 const input=parseMusicXml(wrap(note()+note('E',true)+note('G',true)).replace('</score-partwise>','<part id="P2"><measure number="1"><attributes><divisions>4</divisions></attributes>'+note('A')+'</measure></part></score-partwise>')).song;
 const before=input.notes.find(n=>n.sourceNoteIds?.includes('1:0:0'))!;
 const a=editScoreSlot(input,'0:0:1',{action:'addChordTone',pitch:65});
 const b=editScoreSlot(a,'0:0:0',{action:'delete'});
 expect(b.notes.find(n=>n.sourceNoteIds?.includes('1:0:0'))).toEqual(before);
 expect(b.notes.filter(n=>n.start===0 && n.hand==='right').map(n=>n.pitch)).toEqual([64,65,67,69]);
});
it.each(['barline','print','sound','harmony'])('rejects chord continuation across %s',tag=>{
 const input=parseMusicXml(wrap(note()+`<${tag}/>`+note('E',true))).song;
 expect(scoreAuthoringSlots(input).slice(0,2).every(n=>!!n.reason)).toBe(true);
});
it('rejects semantically identical enharmonic duplicate pitches',()=>{
 const input=parseMusicXml(wrap(note('C').replace('<octave>','<alter>1</alter><octave>')+note('D',true).replace('<octave>','<alter>-1</alter><octave>'))).song;
 expect(scoreAuthoringSlots(input).slice(0,2).every(n=>!!n.reason)).toBe(true);
});
it('does not change sound offsets within a newly extended chord',()=>{
 const input=parseMusicXml(wrap(note()+note('E',true)+'<direction><offset>-4</offset><sound tempo="75"><offset>-2</offset></sound></direction>')).song;
 const before=input.notes.filter(n=>n.pitch!==60);
 const output=editScoreSlot(input,'0:0:0',{action:'addChordTone',pitch:84});
 expect(output.notes.filter(n=>n.pitch!==60&&n.pitch!==84).map(({id,sourceNoteIds,...n})=>n)).toEqual(before.map(({id,sourceNoteIds,...n})=>n));
});
