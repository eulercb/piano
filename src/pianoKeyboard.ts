/** Map only unmodified, non-editing keyboard input to the demo piano. */
export function pianoShortcutPitch(event: KeyboardEvent): number | undefined {
  if (
    event.defaultPrevented || event.repeat || event.isComposing ||
    event.ctrlKey || event.metaKey || event.altKey
  ) return undefined;

  // Letter shortcuts must not consume browser commands or input in controls.
  // Checking ancestors also covers nested content inside rich-text editors.
  if (event.target instanceof Element && event.target.closest(
    'dialog[open], input, select, textarea, [contenteditable], [role="textbox"], [role="combobox"], [role="slider"]',
  )) return undefined;

  const index = "awsedftgyhujkolp;".indexOf(event.key.toLowerCase());
  return event.key.length === 1 && index >= 0 ? 60 + index : undefined;
}

/** Pointer presses sound on pointerdown; native keyboard/AT clicks still play. */
export function isPianoVirtualClick(event: Pick<MouseEvent, "detail">): boolean {
  return event.detail === 0;
}
