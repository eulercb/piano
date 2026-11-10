import { expect, it, vi } from "vitest";
import { loadScoreRenderer } from "./scoreRenderer";

const evaluateModule = vi.hoisted(() => vi.fn());
vi.mock("opensheetmusicdisplay", () => {
  evaluateModule();
  return { OpenSheetMusicDisplay: class {} };
});

it("does not evaluate OSMD until requested, then reuses the loaded module", async () => {
  expect(evaluateModule).not.toHaveBeenCalled();
  const first = await loadScoreRenderer();
  const second = await loadScoreRenderer();
  expect(evaluateModule).toHaveBeenCalledTimes(1);
  expect(first).toBe(second);
});
