import { readFileSync } from "node:fs";
import postcss from "postcss";
import { expect, it } from "vitest";

const css = postcss.parse(["style.css", "practiceRoom.css"].map(file => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n"));
function value(selector, property, media) {
  let result;
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    const condition = rule.parent?.type === "atrule" ? rule.parent.params : undefined;
    if (condition !== media) return;
    rule.walkDecls(property, declaration => { result = declaration.value; });
  });
  return result;
}

// Authored CSS contracts. These do not simulate a browser layout engine.
it("uses an unpadded shared width and overlays black keys without consuming white-key space", () => {
  expect(value(".keyboard", "position")).toBe("relative");
  expect(value(".keyboard", "padding")).toBe("0");
  expect(value(".keyboard", "gap")).toBeUndefined();
  expect(value(".keyboard", "display")).not.toBe("flex");
  expect(value(".keyboard button", "position")).toBe("absolute");
  expect(value(".keyboard button", "top")).toBe("0");
  for (const property of ["transform", "margin-left", "margin-right"]) {
    expect(value(".keyboard .black", property)).toBeUndefined();
  }
  expect(value(".keyboard .white", "box-shadow")).toContain("inset");
  expect(value(".fall-note", "min-width")).toBeUndefined();
});

it("keeps black-key hit targets above white keys even during visible focus", () => {
  expect(Number(value(".keyboard .black", "z-index"))).toBeGreaterThan(Number(value(".keyboard button:focus-visible", "z-index")));
  expect(Number(value(".keyboard .black:focus-visible", "z-index"))).toBeGreaterThan(Number(value(".keyboard .black", "z-index")));
  expect(value(".keyboard button:focus-visible", "outline-offset")).toBe("-4px");
});

it("joins the roll strike boundary directly to the keyboard at responsive heights", () => {
  expect(value(".strike-line", "bottom")).toBe("0");
  expect(value(".strike-line", "pointer-events")).toBe("none");
  expect(value(".guide-surface > .roll", "height")).toBe("100%");
  expect(value(".practice-room .guide-surface", "height")).toBe("auto");
  const landscape = "(orientation: landscape) and (min-width: 480px) and (max-height: 540px)";
  expect(value(".practice-room .stage-card", "grid-template-rows")).toBe("auto minmax(0, 1fr) 48px auto");
  expect(value(".practice-room .keyboard", "height")).toBe("48px");
  expect(value(".practice-room .stage-card", "grid-template-rows", landscape)).toBe("26px minmax(0, 1fr) 34px 54px");
  expect(value(".practice-room .keyboard", "height", landscape)).toBe("34px");
});

it("fills usable practice width to safe-area edges while leaving controls readable", () => {
  expect(value(".practice-shell .content", "max-width")).toBe("none");
  expect(value(".practice-shell .content", "margin")).toBe("0");
  expect(value(".practice-shell .content", "padding")).toBe("max(8px, env(safe-area-inset-top)) env(safe-area-inset-right, 0px) max(8px, env(safe-area-inset-bottom)) env(safe-area-inset-left, 0px)");
  expect(value(".practice-room .stage-card", "border-radius")).toBe("0");
  for (const selector of [".room-heading", ".room-tools", ".room-score-hint", ".practice-shell .app-messages"]) {
    expect(value(selector, "margin-inline")).toBe("8px");
  }
});
