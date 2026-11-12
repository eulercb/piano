# Authored contrast audit

This bounded audit covers the app's own text, form boundaries and focus colors
for [roadmap #7](https://github.com/eulercb/piano/issues/7). The baseline was main
`c7a11cf661a448d9f86440a6478ca0163659b80c`. It is not a WCAG conformance claim or
rendered-browser, screen-reader or physical-device acceptance.

## Reproduced findings and corrections

Ratios use the WCAG sRGB relative-luminance formula. Values below are rounded for
reporting only; the tests compare the unrounded result. The text is normal-size
(8–13px), not the large-text exception. The controls are enabled.

| Reachable context and selector | Original foreground / adjacent background | Before | Correction | After | Criterion |
| --- | --- | ---: | --- | ---: | --- |
| History introduction, assessment limits, privacy and total: `.history-heading p`, `.history-limits`, `.history-privacy`, `.history-total` | `#68756e` / page `#f6f5f0` | 4.414:1 | Reuse the shared muted text color `#57684f` throughout History | 5.499:1 | 1.4.3, 4.5:1 text |
| C labels on pressed white keys in Practice and Studio: `.keyboard .pressed span` | inherited `#57684f` / pressed fill `#accea6` | 3.468:1 | Use existing primary text `#263d36` while pressed | 6.729:1 | 1.4.3, 4.5:1 text |
| Studio authoring select focus: `.studio-note-authoring select:focus-visible` | outline `#cf9347` / panel `#fffef9` | 2.627:1 | Match the shared focus color `#80520c` | 6.644:1 | 1.4.11, 3:1 non-text |
| Studio authoring input/select boundaries: `.studio-note-authoring input`, `.studio-note-authoring select` | border `#bdc9bd` / panel `#fffef9` | 1.697:1 | Reuse existing editor border `#798b71` | 3.620:1 | 1.4.11, 3:1 non-text |
| Piano connection input selector: `.midi-device select` | border `#c5d0bb` / dialog `#f6f5f0` | 1.467:1 | Reuse existing editor border `#798b71` | 3.349:1 | 1.4.11, 3:1 non-text |
| Inset focus on pressed black keys: `.keyboard .black.pressed:focus-visible` | inherited outline `#ffe1a1` / pressed fill `#accea6` | 1.363:1 | Use the dark focus color `#80520c` only while pressed | 3.876:1 | 1.4.11, 3:1 non-text |

The input borders are authored, not unchanged native control appearance. Their
new border also contrasts with the interior: 3.656:1 against Studio's white and
3.620:1 against the MIDI selector's `#fffef9`. History's text on white cards
already passed, but uses the same muted color for a coherent treatment.

The shared button hover filter darkens all painted content to 96%. Pressed-key
text remains 6.405:1 and pressed-black-key focus remains 3.776:1 under that
filter. No key geometry, stacking, transport behavior or score logic changed.
All keyboard focus selectors explicitly return to the system `Highlight` color
in forced-colors mode, including the more specific black/pressed states.

## Regression evidence

`src/contrastAudit.test.js` reads the actual authored CSS and tests known
foreground/background pairs from the React components. It explicitly selects
the pressed-state overrides; it is not a browser cascade or layout engine.

- Before correction, the new suite reproduced ten failing assertions across
  the six finding groups above; 37 other checks passed.
- The final suite adds 49 checks, including History, Library cards, Studio
  helpers and warnings, bookmarks/setup/results panels, MIDI status, dark
  transport text, practice note labels, normal/hover buttons, pressed labels and
  focus, input boundaries, score focus and forced-colors override declarations.
- Existing accessibility and geometry checks remain in place. All audited
  text pairs require 4.5:1, rather than relying on a large-text exemption.

## Remaining acceptance and exclusions

This audit does not turn decorative separators, the incidental song icon, MIDI
status dots accompanied by text, or disabled controls into false-positive text
failures. Control labels can identify buttons without every decorative button
border meeting 3:1. Normal native widget internals, including range thumb/track,
select popup and file chooser rendering, depend on the browser and operating
system and were not inferred from the `accent-color` declaration alone.

Actual acceptance still needs rendered keyboard traversal and focus visibility
through normal, pressed, hover and forced-colors states; browser zoom and narrow
portrait/landscape layouts; native select/range/file controls; assistive
technology; Android touch/MIDI; and installed/offline/update behavior. No private
music or user data was used. No screenshot-based, screen-reader or device pass
is claimed by these deterministic checks.
