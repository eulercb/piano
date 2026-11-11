// Preparation-only code must not be evaluated by the initial practice room.
// Never retain rejected promises in application state: an explicit retry calls
// import() again without reloading the piece. Native module-fetch/cache failure
// recovery depends on the browser and is not established by the DOM tests.
let studioAuthoring: typeof import("./StudioNoteAuthoring") | undefined;
export function loadedStudioAuthoring() { return studioAuthoring; }
export function loadStudioAuthoring() {
  return import("./StudioNoteAuthoring").then(module => {
    studioAuthoring = module;
    return module;
  });
}

export function loadScoreImporter() {
  return import("./scoreImport");
}
