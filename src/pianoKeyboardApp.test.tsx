// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
vi.mock("virtual:pwa-register/react", () => ({useRegisterSW: () => ({needRefresh:[false],updateServiceWorker:vi.fn()})}));
vi.mock("./Score", () => ({Score:()=>null}));
vi.mock("./MidiConnection", () => ({MidiConnection:()=>null}));
const start = vi.fn();
class SilentAudio {
 currentTime=0; destination={};
 resume(){return Promise.resolve()}
 createOscillator(){return {type:"",frequency:{value:0},connect(){},disconnect(){},start,stop(){},onended:null}}
 createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}}}
}
beforeEach(()=>{localStorage.clear(); start.mockClear(); vi.stubGlobal("AudioContext",SilentAudio)});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()});
it("plays native keyboard/assistive clicks once and ignores duplicate pointer click",()=>{
 render(<App/>);
 const key=screen.getByRole("button",{name:"Play C4"});
 fireEvent.click(key,{detail:0});
 expect(start).toHaveBeenCalledTimes(1);
 fireEvent.click(key,{detail:1});
 expect(start).toHaveBeenCalledTimes(1);
 fireEvent(key, new MouseEvent("pointerdown", {bubbles:true,button:0}));
 expect(start).toHaveBeenCalledTimes(2);
 fireEvent.click(key,{detail:1});
 expect(start).toHaveBeenCalledTimes(2);
 fireEvent(key, new MouseEvent("pointerdown", {bubbles:true,button:2}));
 expect(start).toHaveBeenCalledTimes(2);
});
it("preserves browser modifier shortcuts while allowing plain demo notes",()=>{
 render(<App/>);
 const modified=new KeyboardEvent("keydown",{key:"a",ctrlKey:true,bubbles:true,cancelable:true});
 window.dispatchEvent(modified);
 expect(modified.defaultPrevented).toBe(false);
 expect(start).not.toHaveBeenCalled();
 fireEvent.keyDown(window,{key:"a"});
 expect(start).toHaveBeenCalledTimes(1);
});
