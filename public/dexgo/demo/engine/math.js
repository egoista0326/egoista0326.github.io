// Rotation and vector math of the policy loop, Float64.
// Ports of uniassemble/geometry/transforms.py (rod worktree): matrix_to_quaternion_xyzw (+ _canonical_sign),
// so3_exp, so3_log, euler_xyz_to_matrix, nearest_euler_xyz_from_matrix; and observations/encoders.py radial_log.
// Conventions: a rotation is a row-major Float64Array(9) (or plain array) mapping local coordinates to world;
// vectors are length-3 arrays; angles in radians.

export const PI = Math.PI;

// ------------------------------------------------------------------ 3-vectors
export const vec3 = (x = 0, y = 0, z = 0) => Float64Array.of(x, y, z);
export const add3 = (a, b) => vec3(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
export const sub3 = (a, b) => vec3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const scale3 = (a, s) => vec3(a[0] * s, a[1] * s, a[2] * s);
export const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);

// ------------------------------------------------------------------ 3x3 matrices (row-major)
export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** a @ b */
export function matmul(a, b) {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  return r;
}

/** a^T @ b */
export function matTmul(a, b) {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[3 * i + j] = a[i] * b[j] + a[3 + i] * b[3 + j] + a[6 + i] * b[6 + j];
  return r;
}

/** a @ b^T */
export function matmulT(a, b) {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[3 * i + j] = a[3 * i] * b[3 * j] + a[3 * i + 1] * b[3 * j + 1] + a[3 * i + 2] * b[3 * j + 2];
  return r;
}

export function transpose(a) {
  return Float64Array.of(a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]);
}

/** a @ v */
export const mulVec = (a, v) =>
  vec3(a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2]);

/** a^T @ v (express a world vector in the frame whose rotation is a) */
export const mulTVec = (a, v) =>
  vec3(a[0] * v[0] + a[3] * v[1] + a[6] * v[2], a[1] * v[0] + a[4] * v[1] + a[7] * v[2],
    a[2] * v[0] + a[5] * v[1] + a[8] * v[2]);

/** Rotation of a MuJoCo quaternion (w, x, y, z); the formula of mju_quat2Mat (no normalization). */
export function quatWxyzToMatrix(q) {
  const [w, x, y, z] = q;
  if (w === 1 && x === 0 && y === 0 && z === 0) return Float64Array.from(IDENTITY);
  const ww = w * w, xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return Float64Array.of(
    ww + xx - yy - zz, 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), ww - xx + yy - zz, 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), ww - xx - yy + zz);
}

/** Rotation angle (rad) of R: acos(clamp((trace - 1) / 2)), as mj_port.angle. */
export function rotationAngle(r) {
  return Math.acos(Math.max(-1, Math.min(1, (r[0] + r[4] + r[8] - 1) / 2)));
}

// ------------------------------------------------------------------ quaternion / SO(3)
const QUAT_SIGN_EPS = 1e-6;

/** ABI sign of a unit XYZW quaternion (transforms._canonical_sign): w >= 0; at the equator the first
 * non-negligible of x, y, z is non-negative. */
function canonicalSign(q, eps = QUAT_SIGN_EPS) {
  const w = q[3];
  let sign = w < -eps ? -1 : 1;
  if (Math.abs(w) <= eps) {
    for (let a = 0; a < 3; a++) {
      if (Math.abs(q[a]) > eps) {
        if (q[a] < 0) sign = -sign;
        break;
      }
    }
  }
  return sign === 1 ? q : Float64Array.of(-q[0], -q[1], -q[2], -q[3]);
}

/** Shepperd's method as transforms.matrix_to_quaternion_xyzw: XYZW, normalized, canonical sign. */
export function matrixToQuatXyzw(r) {
  const m00 = r[0], m11 = r[4], m22 = r[8];
  const trace = m00 + m11 + m22;
  // torch.argmax: first index of the maximum
  let maxIndex = 0;
  if (m11 > m00) maxIndex = 1;
  if (m22 > (maxIndex === 0 ? m00 : m11)) maxIndex = 2;
  const positive = trace > 0;
  const kase = positive ? 3 : maxIndex;
  let s;
  if (positive) s = trace + 1;
  else if (maxIndex === 0) s = 1 + m00 - m11 - m22;
  else if (maxIndex === 1) s = 1 + m11 - m00 - m22;
  else s = 1 + m22 - m00 - m11;
  const scale = Math.sqrt(s) * 2;
  const wx = r[7] - r[5], wy = r[2] - r[6], wz = r[3] - r[1];
  const xy = r[1] + r[3], xz = r[2] + r[6], yz = r[5] + r[7];
  const table = [
    [0, xy, xz, wx],
    [xy, 0, yz, wy],
    [xz, yz, 0, wz],
    [wx, wy, wz, 0],
  ][kase];
  const q = new Float64Array(4);
  for (let c = 0; c < 4; c++) q[c] = c === kase ? 0.25 * scale : table[c] / scale;
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  for (let c = 0; c < 4; c++) q[c] /= n;
  return canonicalSign(q);
}

/** SO(3) exponential map (transforms.so3_exp), series below 1e-4 rad. */
export function so3Exp(w) {
  const theta = norm3(w);
  const t2 = theta * theta;
  const small = theta <= 1e-4;
  const a = small ? 1 - t2 / 6 + (t2 * t2) / 120 : Math.sin(theta) / theta;
  const b = small ? 0.5 - t2 / 24 + (t2 * t2) / 720 : (1 - Math.cos(theta)) / t2;
  const [x, y, z] = w;
  // K = skew(w); K @ K = w w^T - |w|^2 I
  const k = [0, -z, y, z, 0, -x, -y, x, 0];
  const kk = [-(y * y + z * z), x * y, x * z, x * y, -(x * x + z * z), y * z, x * z, y * z, -(x * x + y * y)];
  const r = new Float64Array(9);
  for (let i = 0; i < 9; i++) r[i] = IDENTITY[i] + a * k[i] + b * kk[i];
  return r;
}

/** Shortest-path SO(3) logarithm (transforms.so3_log): rotation vector (rad). */
export function so3Log(r) {
  const q = matrixToQuatXyzw(r);
  const sinHalf = Math.hypot(q[0], q[1], q[2]);
  const angle = 2 * Math.atan2(sinHalf, Math.min(1, Math.max(0, q[3])));
  const s = sinHalf <= 1e-8 ? 2 + (sinHalf * sinHalf) / 3 : angle / sinHalf;
  return vec3(q[0] * s, q[1] * s, q[2] * s);
}

// ------------------------------------------------------------------ source Euler (RxRyRz virtual joints)
/** Rx(x) @ Ry(y) @ Rz(z) (transforms.euler_xyz_to_matrix). */
export function eulerXyzToMatrix(e) {
  const cx = Math.cos(e[0]), sx = Math.sin(e[0]);
  const cy = Math.cos(e[1]), sy = Math.sin(e[1]);
  const cz = Math.cos(e[2]), sz = Math.sin(e[2]);
  return Float64Array.of(
    cy * cz, -cy * sz, sy,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy);
}

/** torch.round: round half to even. */
function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const wrapNearest = (c, ref) => c + 2 * PI * roundHalfEven((ref - c) / (2 * PI));

/** Source-Euler branch of R nearest the current Euler (transforms.nearest_euler_xyz_from_matrix). */
export function nearestEulerXyzFromMatrix(r, current) {
  const sy = r[2];
  const cosPitch = Math.hypot(r[5], r[8]);
  const pitch = Math.atan2(sy, cosPitch);
  const regular = cosPitch > 1e-3;
  let roll, yaw;
  if (regular) {
    roll = Math.atan2(-r[5], r[8]);
    yaw = Math.atan2(-r[1], r[0]);
  } else {
    const yawSingular = Math.atan2(r[3], r[4]);
    roll = current[0];
    yaw = sy >= 0 ? yawSingular - roll : yawSingular + roll;
  }
  const primary = [roll, pitch, yaw].map((v, i) => wrapNearest(v, current[i]));
  const alternate = [roll + PI, PI - pitch, yaw + PI].map((v, i) => wrapNearest(v, current[i]));
  const dist = (e) => (e[0] - current[0]) ** 2 + (e[1] - current[1]) ** 2 + (e[2] - current[2]) ** 2;
  return Float64Array.from(dist(primary) <= dist(alternate) ? primary : alternate);
}

// ------------------------------------------------------------------ encoder maps
/** Direction-preserving unit-ball map (encoders.radial_log): v / |v| * log1p(min(|v|, cap) / d0) / log1p(cap / d0). */
export function radialLog(v, d0, cap) {
  const r = norm3(v);
  const k = Math.log1p(Math.min(r, cap) / d0) / Math.log1p(cap / d0) / Math.max(r, 1e-12);
  return vec3(v[0] * k, v[1] * k, v[2] * k);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
