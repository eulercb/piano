// Keep the engraving engine out of the initial application module graph.
// Do not cache a rejected promise: a transient chunk download can be retried.
export function loadScoreRenderer() {
  return import("opensheetmusicdisplay");
}
