import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const css = postcss.parse([
  "style.css", "practiceRoom.css", "practiceHistory.css", "studioNoteAuthoring.css", "scoreCursor.css",
].map(file => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n"));

// Read explicit declarations, not a simulated browser cascade. The pairs below
// name the actual backgrounds/overrides in the corresponding React components.
function declaration(selector, property, media) {
  let result;
  css.walkRules(rule => {
    const condition = rule.parent?.type === "atrule" ? rule.parent.params : undefined;
    if (!rule.selectors.includes(selector) || condition !== media) return;
    rule.walkDecls(property, node => { result = node.value; });
  });
  return result;
}
function value(selector, property) {
  const result = declaration(selector, property);
  expect(result, `${selector} ${property}`).toBeDefined();
  return result;
}
function luminance(color, brightness = 1) {
  const named = { white: "#ffffff", black: "#000000" };
  let hex = named[color] ?? color;
  expect(hex).toMatch(/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i);
  hex = hex.slice(1);
  if (hex.length === 3) hex = [...hex].map(channel => channel + channel).join("");
  const [r, g, b] = hex.match(/../g).map(channel => {
    const s = Math.min(1, parseInt(channel, 16) / 255 * brightness);
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  });
  return r * .2126 + g * .7152 + b * .0722;
}
function contrast(foreground, background, brightness = 1) {
  const [low, high] = [luminance(foreground, brightness), luminance(background, brightness)].sort((a, b) => a - b);
  return (high + .05) / (low + .05);
}
function assertContrast(foreground, background, minimum, brightness = 1) {
  expect(contrast(foreground, background, brightness), `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
}
const hoverBrightness = () => {
  const filter = value("button:hover", "filter");
  expect(filter).toMatch(/^brightness\([\d.]+\)$/);
  return Number(filter.match(/[\d.]+/)[0]);
};

// WCAG 2.x relative luminance, without rounding before comparison. These are
// source-level contracts for enabled controls, not rendered-browser acceptance.
describe("normal-size text across pages and panels (SC 1.4.3)", () => {
  it.each([
    [".history-heading p", ":root"], [".history-limits", ":root"],
    [".history-privacy", ":root"], [".history-total", ":root"],
    [".history-empty p", ".history-empty"],
    [".history-pass-heading time", ".history-list li"],
    [".history-passage", ".history-list li"],
    [".history-counts dt", ".history-list li"],
    [".history-written-parts p", ".history-list li"],
    ["p", ".song-card"], ["p", ".editor"], ["p", ".note-editor"],
    ["p", ".score-panel"], ["p", ".history-suggestion"],
    // Bookmarks and setup/results settings sit on a transparent panel body.
    ["p", "dialog.practice-panel"], [".control-label span", "dialog.practice-panel"],
    [".mode small", "dialog.practice-panel"], [".rhythm-panel p", "dialog.practice-panel"],
    [".timing-summary dt", "dialog.practice-panel"],
    [".room-piece p", ":root"], [".room-hint", "dialog.practice-panel"],
    [".midi-status", "dialog.practice-panel"], [".midi-activity", "dialog.practice-panel"],
    [".studio-note-authoring p", ".studio-note-authoring"],
    [".authoring-fields small", ".studio-note-authoring"],
    [".authoring-selection > span", ".studio-note-authoring"],
    [".studio-note-authoring .authoring-warning", ".studio-note-authoring .authoring-warning"],
    [".studio-note-authoring .authoring-error", ".studio-note-authoring"],
    [".studio-note-authoring .authoring-status", ".studio-note-authoring"],
    [".stage-top", ".stage-card"], [".transport", ".transport"],
    [".practice-room .fall-note", ".right"], [".practice-room .fall-note.left", ".left"],
  ])("keeps %s readable on %s", (foreground, background) => {
    assertContrast(value(foreground, "color"), value(background, "background"), 4.5);
  });

  it.each([
    [".button", ".button"], [".button.light", ".button.light"],
    [".cover", ".cover"], [".cover-1", ".cover-1"], [".cover-2", ".cover-2"],
    [".room-button", ".room-button"],
    ['.room-button[aria-pressed="true"]', '.room-button[aria-pressed="true"]'],
  ])("keeps %s readable at rest and under the shared hover filter", (foreground, background) => {
    for (const brightness of [1, hoverBrightness()]) {
      assertContrast(value(foreground, "color"), value(background, "background"), 4.5, brightness);
    }
  });

  it("keeps C labels readable on pressed white keys, including hover", () => {
    const foreground = declaration(".keyboard .pressed span", "color") ?? value(".keyboard button span", "color");
    for (const brightness of [1, hoverBrightness()]) {
      assertContrast(foreground, value(".keyboard .pressed", "background"), 4.5, brightness);
    }
  });
});

describe("authored focus and input boundaries (SC 1.4.11)", () => {
  it("keeps Studio select focus visible against the surrounding authoring panel", () => {
    const outline = declaration(".studio-note-authoring select:focus-visible", "outline") ?? value("select:focus-visible", "outline");
    expect(outline).toContain("3px solid");
    assertContrast(outline.split(" ").at(-1), value(".studio-note-authoring", "background"), 3);
  });

  it.each([
    [".studio-note-authoring input", ".studio-note-authoring"],
    [".studio-note-authoring select", ".studio-note-authoring"],
    [".midi-device select", "dialog.practice-panel"],
  ])("keeps the authored %s boundary visible against %s and the control fill", (selector, surrounding) => {
    const border = value(selector, "border");
    expect(border).toContain("1px solid");
    const color = border.split(" ").at(-1);
    assertContrast(color, value(surrounding, "background"), 3);
    assertContrast(color, value(selector, "background"), 3);
  });

  it("keeps the inset focus visible while a black key is pressed, including hover", () => {
    const foreground = declaration(".keyboard .black.pressed:focus-visible", "outline-color") ?? value(".keyboard .black:focus-visible", "outline-color");
    for (const brightness of [1, hoverBrightness()]) {
      assertContrast(foreground, value(".keyboard .pressed", "background"), 3, brightness);
    }
    // A state override must not reduce the black key's established stacking.
    expect(declaration(".keyboard .black.pressed:focus-visible", "z-index")).toBeUndefined();
  });

  it("keeps white-key focus visible on both fills, including hover", () => {
    for (const background of [".keyboard .white", ".keyboard .pressed"]) {
      for (const brightness of [1, hoverBrightness()]) {
        assertContrast(value(".keyboard button:focus-visible", "outline-color"), value(background, "background"), 3, brightness);
      }
    }
  });

  it("lets the system focus color override every authored key state in forced colors", () => {
    for (const selector of [".keyboard button:focus-visible", ".keyboard .black:focus-visible", ".keyboard .black.pressed:focus-visible"]) {
      expect(declaration(selector, "outline-color", "(forced-colors: active)")).toBe("Highlight");
    }
  });

  it("keeps the dedicated score focus color visible on the score panel", () => {
    for (const selector of [".score-sheet.score-follow-viewport:focus-visible", ".score-reading-controls:focus-visible"]) {
      assertContrast(value(selector, "outline").split(" ").at(-1), value(".score-panel", "background"), 3);
    }
  });
});
