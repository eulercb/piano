import { expect, it, vi } from "vitest";
import { loadedStudioAuthoring, loadStudioAuthoring, loadScoreImporter } from "./preparationModules";

const evaluated = vi.hoisted(() => ({ studio: vi.fn(), importer: vi.fn() }));
vi.mock("./StudioNoteAuthoring", () => {
  evaluated.studio();
  return { StudioNoteAuthoring: () => null };
});
vi.mock("./scoreImport", () => {
  evaluated.importer();
  return { importScoreFile: vi.fn() };
});

it("defers both preparation modules, loads each only on request and retains only successful authoring", async () => {
  expect(evaluated.studio).not.toHaveBeenCalled();
  expect(evaluated.importer).not.toHaveBeenCalled();
  expect(loadedStudioAuthoring()).toBeUndefined();
  const studio = await loadStudioAuthoring();
  expect(loadedStudioAuthoring()).toBe(studio);
  expect(evaluated.studio).toHaveBeenCalledTimes(1);
  expect(evaluated.importer).not.toHaveBeenCalled();
  expect(await loadStudioAuthoring()).toBe(studio);
  const importer = await loadScoreImporter();
  expect(evaluated.importer).toHaveBeenCalledTimes(1);
  expect(await loadScoreImporter()).toBe(importer);
  expect(evaluated.studio).toHaveBeenCalledTimes(1);
  expect(evaluated.importer).toHaveBeenCalledTimes(1);
});
