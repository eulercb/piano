import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { expect, it } from 'vitest';
const text = readFileSync(new URL('./practiceLaunch.css', import.meta.url), 'utf8');
const css = postcss.parse(text);
function value(selector, property) {
  let result;
  css.walkRules(rule => { if (rule.parent.type === 'root' && rule.selectors.includes(selector)) rule.walkDecls(property, declaration => { result = declaration.value; }); });
  return result;
}
function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const pair = [luminance(a), luminance(b)].sort((a,b) => b-a); return (pair[0]+.05)/(pair[1]+.05); }
it('retains visible choice boundaries against both adjacent backgrounds', () => {
  expect(value('.launch-choice', 'border')).toContain('#798b71');
  expect(value('.launch-speeds button', 'border')).toContain('#798b71');
  for (const bg of ['fffef9', 'f6f5f0']) expect(contrast('798b71', bg)).toBeGreaterThanOrEqual(3);
  for (const bg of ['fffef9', 'e5edda', 'eef2e8', 'f6f5f0']) expect(contrast('526257', bg)).toBeGreaterThanOrEqual(4.5);
});
it('keeps readable text, touch targets, wrapping, responsive choices and explicit keyboard focus', () => {
  expect(value('.launch-choice', 'min-height')).toBe('90px');
  expect(value('.launch-speeds button', 'min-height')).toBe('48px');
  expect(value('.launch-start-button', 'min-height')).toBe('54px');
  expect(value('.launch-choice', 'overflow-wrap')).toBe('anywhere');
  expect(text).toContain('repeat(3, minmax(0, 1fr))');
  expect(text).toContain('@media (max-width: 380px)');
  expect(text).toContain('outline: 3px solid #80520c');
  expect(text).toContain('@media (forced-colors: active)');
});
