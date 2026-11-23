// The follow camera's deadband on one screen axis (main.js followStep), as a pure function so it can be tested.

/**
 * Deadband aim on one screen axis: the smallest move of the aim a (m, along the view's right or up vector) that puts
 * the span [x0, x1] (m, same axis) inside a +- half (m). A span wider than 2 half cannot fit: the aim goes to the
 * span's centre. The result is a fixed point (applying it again returns the same aim).
 * Owner bug 2026-11-23 (Manual goal, far relocation, whole view shaking): the earlier per-side shift
 * max(0, x1 - (a + half)) - max(0, a - half - x0) reflects the aim about the span's centre (a -> x0 + x1 - a) when
 * both sides overflow, so the aim flipped between two points every frame (17 cm apart on a 1 m span).
 * @param {number} a current aim (m)
 * @param {number} x0 span minimum (m)
 * @param {number} x1 span maximum (m)
 * @param {number} half usable half width of the view at the aim (m; may be <= 0 on a tiny view)
 * @returns {number} the new aim (m)
 */
export function deadbandAim(a, x0, x1, half) {
  const lo = x1 - half, hi = x0 + half; // aims that keep the span inside a +- half
  return lo <= hi ? Math.min(hi, Math.max(lo, a)) : (x0 + x1) / 2;
}

const DEG = Math.PI / 180;
/**
 * The follow view's direction at a started Manual goal goal (main.js editorCamera), relative to the view now (owner
 * bug 2026-11-23: the elevation was set absolutely, so every Go reset the viewer's orbit): the azimuth turns by the
 * goal's Turn, the elevation changes by the goal palm's drop minus the drop applied before. Drop (rad, <= 0): 0 up to
 * a sideways palm (palm tilt <= 90 deg), falling linearly to lowDeg - elevation at palm down (180 deg). The elevation
 * stays within -4..79 deg (OrbitControls' polar limits 10-95 deg with 1 deg to spare, or the eased turn never arrives).
 * @param {number[]} base the view direction now, target -> camera (unit, world, z up)
 * @param {number} turnDeg the goal's applied Turn (deg, about the vertical)
 * @param {number} palmDeg the goal palm's tilt (deg; 0 up, 90 sideways, 180 down)
 * @param {number} prevDrop the drop applied before (rad; 0 after a reset)
 * @param {number} elevation the default view elevation (rad)
 * @param {number} lowDeg the elevation at palm down (deg)
 * @returns {{dir: number[], drop: number}} the direction to ease to (unit) and the drop it applies (rad)
 */
export function goalViewDir(base, turnDeg, palmDeg, prevDrop, elevation, lowDeg) {
  const az = Math.atan2(base[1], base[0]) + turnDeg * DEG, palm = Math.min(180, Math.max(90, palmDeg));
  const drop = ((lowDeg * DEG - elevation) * (palm - 90)) / 90;
  const el0 = Math.asin(Math.min(1, Math.max(-1, base[2])));
  const el = Math.min(79 * DEG, Math.max(-4 * DEG, el0 + drop - prevDrop));
  return { dir: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)], drop };
}
