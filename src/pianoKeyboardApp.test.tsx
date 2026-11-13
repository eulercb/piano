// @vitest-environment jsdom
import { renderPractice, openPracticeRoom } from "./testPracticeLaunch";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./main";
vi.mock("virtual:pwa-register/react", () => ({useRegisterSW: () => ({needRefresh:[false],updateServiceWorker:vi.fn()})}));
vi.mock("./Score", () => ({Score:()=>null}));
vi.mock("./MidiConnection", () => ({MidiConnection:()=>null}));
const start = vi.fn();
class SilentAudio extends EventTarget {
  state = "running";
  close() { return Promise.resolve(); }
 currentTime=0; destination={};
 resume(){return Promise.resolve()}
 createOscillator(){return {type:"",frequency:{value:0},connect(){},disconnect(){},start,stop(){},onended:null}}
 createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}}}
}
beforeEach(()=>{vi.useFakeTimers();localStorage.clear(); start.mockClear(); vi.stubGlobal("AudioContext",SilentAudio)});
afterEach(()=>{cleanup();vi.useRealTimers();localStorage.clear();vi.unstubAllGlobals()});
it("plays native keyboard/assistive clicks once and ignores duplicate pointer click",()=>{
 renderPractice(<App/>);
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
 renderPractice(<App/>);
 const modified=new KeyboardEvent("keydown",{key:"a",ctrlKey:true,bubbles:true,cancelable:true});
 window.dispatchEvent(modified);
 expect(modified.defaultPrevented).toBe(false);
 expect(start).not.toHaveBeenCalled();
 fireEvent.keyDown(window,{key:"a"});
 expect(start).toHaveBeenCalledTimes(1);
});
it("keeps a repeated pitch highlighted until 180 ms after the latest input",()=>{
 renderPractice(<App/>);
 const key=screen.getByRole("button",{name:"Play C4"});
 fireEvent.click(key,{detail:0});
 expect(key.classList.contains("pressed")).toBe(true);
 act(()=>vi.advanceTimersByTime(100));
 fireEvent.keyDown(window,{key:"a"});
 expect(vi.getTimerCount()).toBe(1);
 act(()=>vi.advanceTimersByTime(80));
 expect(key.classList.contains("pressed")).toBe(true);
 act(()=>vi.advanceTimersByTime(99));
 expect(key.classList.contains("pressed")).toBe(true);
 act(()=>vi.advanceTimersByTime(1));
 expect(key.classList.contains("pressed")).toBe(false);
 expect(vi.getTimerCount()).toBe(0);
});
it("expires different pitch highlights independently",()=>{
 renderPractice(<App/>);
 const c=screen.getByRole("button",{name:"Play C4"});
 const d=screen.getByRole("button",{name:"Play D4"});
 fireEvent.keyDown(window,{key:"a"});
 act(()=>vi.advanceTimersByTime(100));
 fireEvent.keyDown(window,{key:"s"});
 act(()=>vi.advanceTimersByTime(80));
 expect(c.classList.contains("pressed")).toBe(false);
 expect(d.classList.contains("pressed")).toBe(true);
 act(()=>vi.advanceTimersByTime(100));
 expect(d.classList.contains("pressed")).toBe(false);
 expect(vi.getTimerCount()).toBe(0);
});
it("cancels pending highlights on unmount and supports a fresh StrictMode mount",()=>{
 const view=renderPractice(<StrictMode><App/></StrictMode>);
 // Settle the launch/start/reset transition before measuring note-highlight timers.
 act(()=>vi.advanceTimersByTime(0));
 fireEvent.keyDown(window,{key:"a"});
 fireEvent.keyDown(window,{key:"s"});
 expect(vi.getTimerCount()).toBe(2);
 view.unmount();
 expect(vi.getTimerCount()).toBe(0);
 // Advancing the old lifetime must have nothing left to call after teardown.
 act(()=>vi.advanceTimersByTime(180));
 const next=renderPractice(<StrictMode><App/></StrictMode>);
 act(()=>vi.advanceTimersByTime(0));
 const key=screen.getByRole("button",{name:"Play C4"});
 fireEvent.click(key,{detail:0});
 expect(key.classList.contains("pressed")).toBe(true);
 act(()=>vi.advanceTimersByTime(180));
 expect(key.classList.contains("pressed")).toBe(false);
 expect(vi.getTimerCount()).toBe(0);
 next.unmount();
});
