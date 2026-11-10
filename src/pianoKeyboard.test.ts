// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isPianoVirtualClick, pianoShortcutPitch } from "./pianoKeyboard";

afterEach(() => { document.body.replaceChildren(); });

function pitch(init: KeyboardEventInit, target: Element = document.body) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return pianoShortcutPitch(event);
}

describe("demo piano keyboard input", () => {
  it("maps the documented A–; range, including Shift-uppercase input", () => {
    for (const [index, key] of [..."awsedftgyhujkolp;"].entries()) {
      expect(pitch({ key })).toBe(60 + index);
    }
    expect(pitch({ key: "A", shiftKey: true })).toBe(60);
    for (const key of ["", "Enter", " ", "ArrowLeft", "z"]) expect(pitch({ key })).toBeUndefined();
  });

  it("preserves browser shortcuts, composition, auto-repeat and consumed input", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "isComposing", "repeat"]) {
      expect(pitch({ key: "a", [modifier]: true })).toBeUndefined();
    }
    const event = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    event.preventDefault();
    expect(pianoShortcutPitch(event)).toBeUndefined();
  });

  it("leaves all form and rich-text controls alone, including nested targets", () => {
    document.body.innerHTML = `
      <input><select><option>song</option></select><textarea></textarea>
      <div contenteditable="true"><span id="rich-child">text</span></div>
      <div role="textbox"><span id="textbox-child">text</span></div>
      <div role="combobox"></div><div role="slider"></div>
    `;
    for (const element of document.body.querySelectorAll("input, select, textarea, #rich-child, #textbox-child, [role=combobox], [role=slider]")) {
      expect(pitch({ key: "a" }, element)).toBeUndefined();
    }
    const button = document.createElement("button");
    document.body.append(button);
    expect(pitch({ key: "a" }, button)).toBe(60);
  });

  it("does not sound demo notes from a modal panel's controls", () => {
    document.body.innerHTML = '<dialog open><button><span id="label">Setup action</span></button></dialog>';
    expect(pitch({ key: "a" }, document.querySelector("#label")!)).toBeUndefined();
  });

  it("plays native keyboard/assistive clicks without replaying a pointer press", () => {
    expect(isPianoVirtualClick(new MouseEvent("click", { detail: 0 }))).toBe(true);
    expect(isPianoVirtualClick(new MouseEvent("click", { detail: 1 }))).toBe(false);
    expect(isPianoVirtualClick(new MouseEvent("click", { detail: 2 }))).toBe(false);
  });
});
