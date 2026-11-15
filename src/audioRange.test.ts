import { afterEach, expect, it, vi } from 'vitest';
import { PianoAudio } from './audio';
class Audio extends EventTarget {
  static instance: Audio; state = 'running'; currentTime = 10; destination = {};
  stops: (number | undefined)[] = []; attack: number[] = []; decay: number[] = [];
  constructor() { super(); Audio.instance = this; }
  close() { return Promise.resolve(); }
  createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop: (time?: number) => this.stops.push(time), onended: null }; }
  createGain() { return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime: (_v: number, time: number) => this.attack.push(time), exponentialRampToValueAtTime: (_v: number, time: number) => this.decay.push(time) } }; }
}
afterEach(() => vi.unstubAllGlobals());
it.each([0.005, 0.02, 0.4])('clips a long source note and its envelope to remaining %s real seconds', maximum => {
  vi.stubGlobal('AudioContext', Audio); const audio = new PianoAudio(); audio.ensureRunning();
  audio.sound(60, 3, 0.5, maximum);
  expect(Audio.instance.stops).toEqual([10 + maximum]);
  expect(Audio.instance.attack[0]).toBeLessThan(Audio.instance.decay[0]);
  expect(Audio.instance.decay[0]).toBeLessThanOrEqual(10 + maximum);
  audio.dispose();
});
it('does not schedule source sound after the range endpoint', () => {
  vi.stubGlobal('AudioContext', Audio); const audio = new PianoAudio(); audio.ensureRunning();
  audio.sound(60, 3, 0.5, 0); expect(Audio.instance.stops).toEqual([]); audio.dispose();
});
it('retains the legacy minimum preview envelope without a range boundary', () => {
  vi.stubGlobal('AudioContext', Audio); const audio = new PianoAudio(); audio.ensureRunning();
  audio.sound(60, 0.001); expect(Audio.instance.stops).toEqual([10.04]); audio.dispose();
});
