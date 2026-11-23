// Grasp chip names and rows of Set goal (owner 2026-11-23): grasps are named by the OBJECT's own +Y axis, the green
// arrow of the object frame drawn over the scene (app/axes_overlay.js: X / Y / Z red / green / blue). Families
// (app/editor.js, RESULTS.md section 2): E_r / E_n enclosures with the rod's +Y / -Y end at the thumb side (E_n holds
// +Y at the little finger), T_b / T_s pinches at the rod's +Y / -Y end. Layout: one row per grasp type; the current
// type's row holds only Keep (the current grasp, with its own name), the other type's row its two families; a reversal
// (same type, other end) is never shown. Pure data and functions (no DOM).

/** The grasp types in row order, each with its families in chip order (+Y first). */
export const GRASP_TYPES = Object.freeze([
  Object.freeze({ type: 'Wrap', families: Object.freeze(['E_r', 'E_n']) }),
  Object.freeze({ type: 'Pinch', families: Object.freeze(['T_b', 'T_s']) }),
]);

/** Per family: type, axis sign (display, U+2212 for minus), the text after the axis glyph, and the spoken name. */
export const GRASP_LABEL = Object.freeze({
  E_r: Object.freeze({ type: 'Wrap', sign: '+', rest: ' at thumb', spoken: 'wrap, +Y end at the thumb' }),
  E_n: Object.freeze({ type: 'Wrap', sign: '−', rest: ' at thumb', spoken: 'wrap, -Y end at the thumb' }),
  T_b: Object.freeze({ type: 'Pinch', sign: '+', rest: ' end', spoken: 'pinch at the +Y end' }),
  T_s: Object.freeze({ type: 'Pinch', sign: '−', rest: ' end', spoken: 'pinch at the -Y end' }),
});

/** The chip rows of the offered grasp types (Editor.offered: [{family, enabled, keep}], Keep first): one row per type
 *  in GRASP_TYPES order that has an option; the current type's row only its Keep option, the other type's row its
 *  offered families in chip order. -> [{type, chips: [{family, enabled, keep, label}]}] */
export function graspRows(options) {
  const keep = options.find((o) => o.keep);
  return GRASP_TYPES.map(({ type, families }) => ({
    type,
    chips: (GRASP_LABEL[keep?.family]?.type === type ? [keep] : families.map((f) => options.find((o) => o.family === f && !o.keep)))
      .filter(Boolean).map((o) => ({ ...o, label: GRASP_LABEL[o.family] })),
  })).filter((row) => row.chips.length);
}
