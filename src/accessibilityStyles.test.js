import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const css = postcss.parse(readFileSync(new URL("./style.css", import.meta.url), "utf8"));
function value(selector, property, media) {
  let result = "";
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const parent = rule.parent;
    const condition = parent?.type === "atrule" ? parent.params : undefined;
    if (condition !== media) return;
    rule.walkDecls(property, declaration => { result = declaration.value; });
  });
  expect(result, `${selector} ${property}${media ? ` in ${media}` : ""}`).not.toBe("");
  return result;
}
function luminance(hex) {
  const channels = hex.replace("#", "").match(/../g).map(channel => {
    const s = parseInt(channel, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(foreground, background) {
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

// These are authored-style regression checks, not browser layout or axe checks.
describe("accessible authored styles", () => {
  it.each([
    ["p", ":root"], [".nav-label", "aside"], [".nav", "aside"],
    [".sidebar-bottom p", "aside"], [".local", "aside"],
    [".breadcrumb", ":root"], [".eyebrow", ":root"],
    [".song-kicker", ":root"], [".control-label", ".settings"],
    [".control-label b", ".control-label b"], [".hand-options button", ".hand-options"],
    [".range-ends", ".settings"], [".mode small", ".mode.selected"],
    [".below-stage", ":root"], [".below-stage b", ":root"],
    ["footer", ":root"], [".section-title span", ":root"],
    [".import-card", ":root"], [".speed-presets button", ".speed-presets button"],
    [".cover", ".cover"], [".cover-1", ".cover-1"], [".cover-2", ".cover-2"],
    [".fall-note", ".right"], [".fall-note.left", ".left"],
    [".keyboard button span", ".keyboard .white"],
  ])("keeps %s text at AA contrast on %s", (foreground, background) => {
    expect(contrast(value(foreground, "color"), value(background, "background"))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives form controls and both keyboard key colors contrasting focus indicators", () => {
    for (const selector of ["button:focus-visible", "a:focus-visible", "input:focus-visible", "select:focus-visible", "textarea:focus-visible"]) {
      const outline = value(selector, "outline");
      expect(outline).toContain("3px solid");
      expect(contrast(outline.split(" ").at(-1), value(":root", "background"))).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(value(".transport :focus-visible", "outline-color"), value(".transport", "background"))).toBeGreaterThanOrEqual(3);
    expect(contrast(value(".keyboard button:focus-visible", "outline-color"), value(".keyboard .white", "background"))).toBeGreaterThanOrEqual(3);
    expect(contrast(value(".keyboard .black:focus-visible", "outline-color"), value(".keyboard .black", "background"))).toBeGreaterThanOrEqual(3);
    expect(value(".keyboard button:focus-visible", "outline-offset")).toBe("-4px");
    expect(value(".keyboard button:focus-visible", "z-index")).toBe("2");
  });

  it("allocates 44px touch targets to controls without distorting piano key geometry", () => {
    for (const selector of [".button", ".text-button", ".icon-button", ".play-button", ".nav", ".notice button", ".hand-options button", ".speed-presets button", ".mode", ".device"]) {
      expect(value(selector, "min-height")).toBe("44px");
      expect(value(selector, "min-width")).toBe("44px");
    }
    for (const selector of ['.transport input[type="range"]', '.settings input[type="range"]']) {
      expect(value(selector, "height")).toBe("44px");
    }
    expect(value(".repeat-control", "min-height")).toBe("44px");
  });

  it("allows phone navigation and long content to reflow", () => {
    const phone = "(max-width: 580px)";
    expect(value("aside", "height", phone)).toBe("auto");
    expect(value("nav", "grid-template-columns", phone)).toBe("repeat(2, minmax(0, 1fr))");
    expect(value(".nav", "font-size", phone)).toBe("11px");
    expect(value(".heading .button", "font-size", phone)).toBe("12px");
    expect(value(".song-grid", "grid-template-columns", phone)).toBe("minmax(0, 1fr)");
    expect(value("h2", "overflow-wrap")).toBe("anywhere");
    expect(value(".heading", "flex-wrap")).toBe("wrap");
  });

  it("disables decorative MIDI animation without hiding its activity state", () => {
    const reduced = "(prefers-reduced-motion: reduce)";
    expect(value(".midi-pulse.received", "animation", reduced)).toBe("none");
    expect(value(".midi-pulse.received", "background", reduced)).not.toBe(value(".midi-pulse", "background"));
    expect(value(".midi-pulse.received", "box-shadow", reduced)).toBe("none");
  });
});
