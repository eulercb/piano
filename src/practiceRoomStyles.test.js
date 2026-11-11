import { readFileSync } from "node:fs";
import postcss from "postcss";
import { expect, it } from "vitest";
const css = postcss.parse(readFileSync(new URL("./practiceRoom.css", import.meta.url), "utf8"));
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
// Static CSS contracts, not a claim about rendered mobile layout.
it("contains the room in the dynamic viewport with safe area padding and shrinkable guide", () => {
  expect(value(".practice-shell", "height")).toBe("100dvh");
  expect(value(".practice-shell", "overflow")).toBe("hidden");
  expect(value(".practice-shell .content", "padding")).toContain("safe-area-inset-bottom");
  expect(value(".practice-shell .content", "padding")).toContain("safe-area-inset-left");
  expect(value(".practice-room .stage-card", "grid-template-rows")).toContain("minmax(0, 1fr)");
  expect(value(".practice-room .guide-surface", "height")).toBe("auto");
  expect(value(".practice-shell > aside", "display")).toBe("none");
  expect(value(".practice-shell main > header", "display")).toBe("none");
});
it("keeps score and dialogs internally scrollable without growing the document", () => {
  expect(value(".practice-room .compact-score", "height")).toBe("100%");
  expect(value(".practice-room .compact-score .score-sheet", "min-height")).toBe("0");
  expect(value(".practice-room .compact-score .score-sheet", "overflow")).toBe("auto");
  expect(value(".practice-panel-body", "overflow")).toBe("auto");
  expect(value("dialog.practice-panel", "max-height")).toContain("100dvh");
  expect(value(".practice-shell .app-messages", "max-height")).toBe("22%");
});
it("keeps MIDI recovery inside the bounded notices with wrapping text and a touch-sized action", () => {
  expect(value(".practice-shell .app-messages", "overflow")).toBe("auto");
  expect(value(".midi-recovery", "display")).toBe("flex");
  expect(value(".midi-recovery > div", "min-width")).toBe("0");
  expect(value(".midi-recovery > div", "overflow-wrap")).toBe("anywhere");
  expect(value(".midi-recovery .room-button", "flex-shrink")).toBe("0");
  expect(value(".room-button", "min-height")).toBe("44px");
});
it("keeps next-step choices touch-sized and wrapping inside the scrollable results panel", () => {
  expect(value(".next-step-actions", "display")).toBe("grid");
  expect(value(".next-step-actions", "grid-template-columns")).toContain("min(100%, 190px)");
  expect(value(".next-step-actions .button", "min-height")).toBe("60px");
  expect(value(".next-step-actions .button", "white-space")).toBe("normal");
  expect(value(".next-step-actions .button", "overflow-wrap")).toBe("anywhere");
  expect(value(".practice-panel-body", "overflow")).toBe("auto");
});
it("provides touch-sized transport and a short-landscape layout without fixed roll height", () => {
  expect(value(".practice-room .transport .play-button", "min-height")).toBe("44px");
  expect(value(".practice-room .transport .icon-button", "min-width")).toBe("44px");
  expect(value(".room-button", "min-height")).toBe("44px");
  const landscape = "(orientation: landscape) and (min-width: 480px) and (max-height: 540px)";
  expect(value(".practice-room", "grid-template-rows", landscape)).toBe("auto minmax(0, 1fr)");
  expect(value(".practice-room .stage-card", "grid-template-rows", landscape)).toBe("26px minmax(0, 1fr) 34px 54px");
  expect(readFileSync(new URL("../index.html", import.meta.url), "utf8")).toContain("viewport-fit=cover");
});

it("reserves a useful guide budget at 568×320 landscape even with the bounded notice area", () => {
  // Source-derived default-font budget only. Native browser layout remains unverified.
  const landscape = "(orientation: landscape) and (min-width: 480px) and (max-height: 540px)";
  const height = 320 - 16;
  const notices = height * parseFloat(value(".practice-shell .app-messages", "max-height")) / 100;
  const outerGap = parseFloat(value(".practice-shell .content", "gap", landscape));
  const toolbar = parseFloat(value(".room-button", "min-height"));
  const roomGap = parseFloat(value(".practice-room", "gap", landscape));
  const fixedStage = [26, 34, 54].reduce((sum, size) => sum + size, 0);
  expect(height - notices - outerGap - toolbar - roomGap - fixedStage).toBeGreaterThan(60);
});


it("bounds size and follow controls together to preserve half the short-landscape score interior", () => {
  const selector = ".practice-room .compact-score .score-reading-controls";
  expect(value(selector, "max-height")).toBe("50%");
  expect(value(selector, "overflow")).toBe("auto");
  expect(value(selector, "overscroll-behavior")).toBe("contain");
  expect(value(selector, "min-height")).toBe("0");
  expect(value(".practice-room .compact-score .score-follow-controls", "max-height")).toBeUndefined();
  const landscape = "(orientation: landscape) and (min-width: 480px) and (max-height: 540px)";
  const height = 320 - 16;
  const notices = height * parseFloat(value(".practice-shell .app-messages", "max-height")) / 100;
  const guide = height - notices
    - parseFloat(value(".practice-shell .content", "gap", landscape))
    - parseFloat(value(".room-button", "min-height"))
    - parseFloat(value(".practice-room", "gap", landscape))
    - (26 + 34 + 54);
  const padding = parseFloat(value(".practice-room .compact-score", "padding")) * 2;
  const interior = guide - padding;
  const controls = interior * parseFloat(value(selector, "max-height")) / 100;
  expect(interior - controls).toBeGreaterThan(29);
});
