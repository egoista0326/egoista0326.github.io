// The v7 actor as a plain-JS MLP: the runtime policy (onnxruntime-web is only a test reference since 2026-11-21).
// Weights: assets/policy/actor_mlp.{json,bin} (../scripts/export_mlp.py, checkpoint af31c6ee), the network of
// export_onnx.Actor:
//   input  obs141 (141) raw encoded columns (encoder.js ACTOR_FIELDS order), cast to float32 as the ONNX input was
//   x      clamp((obs141 - mean) / std, -clip, clip), each operation rounded to float32 (the ONNX graph's arithmetic)
//   h      Linear 141->512, ELU; Linear 512->256, ELU; Linear 256->128, ELU (alpha 1)
//   output Linear 128->26: the mean action, latent units (clipped to [-1, 1] only by the decoder)
// Weights are Float32Array (W out x in, row-major). Accumulation (constructor option): 'f64' (default) sums the
// float32 products in Float64 and keeps the activations in Float64; 'f32' rounds every product, sum and activation to
// float32 (Math.fround). Measured against onnxruntime-web on 2000 recorded inputs (test/mlp.test.mjs): f64 is closer
// (README). Same interface as engine/policy.js Policy: static async create(...), async act(obs), async release().

import { ACTOR_FIELDS, OBS_DIM } from './encoder.js';

const f32 = Math.fround;
const elu = (x) => (x > 0 ? x : Math.expm1(x));

/**
 * out = act(W input + b), Float64 sums of the float32 products, four output rows at a time (four independent
 * accumulators share each input load; one row's sum is still in input order).
 */
function denseF64(layer, input, out) {
  const { W, b, nIn, nOut } = layer;
  let j = 0;
  for (; j + 4 <= nOut; j += 4) {
    const r0 = j * nIn, r1 = r0 + nIn, r2 = r1 + nIn, r3 = r2 + nIn;
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let i = 0; i < nIn; i++) {
      const v = input[i];
      a0 += W[r0 + i] * v;
      a1 += W[r1 + i] * v;
      a2 += W[r2 + i] * v;
      a3 += W[r3 + i] * v;
    }
    out[j] = a0 + b[j];
    out[j + 1] = a1 + b[j + 1];
    out[j + 2] = a2 + b[j + 2];
    out[j + 3] = a3 + b[j + 3];
  }
  for (; j < nOut; j++) {
    const r = j * nIn;
    let a = 0;
    for (let i = 0; i < nIn; i++) a += W[r + i] * input[i];
    out[j] = a + b[j];
  }
  if (layer.elu) for (let k = 0; k < nOut; k++) out[k] = elu(out[k]);
  return out;
}

export class MlpPolicy {
  /**
   * @param {object} header actor_mlp.json
   * @param {Uint8Array|ArrayBuffer} bytes actor_mlp.bin (float32 little-endian)
   * @param {{accumulate?: 'f64' | 'f32'}} [options]
   */
  static async create(header, bytes, options = {}) {
    return new MlpPolicy(header, bytes, options);
  }

  /** Both files through an engine/loader.js loader rooted at assets/. */
  static async load(loader, base = 'policy/actor_mlp', options = {}) {
    const [header, bytes] = await Promise.all([loader.json(`${base}.json`), loader.bytes(`${base}.bin`)]);
    return MlpPolicy.create(header, bytes, options);
  }

  constructor(header, bytes, { accumulate = 'f64' } = {}) {
    const fields = header.fields.map((f) => [f.field, f.width]);
    if (JSON.stringify(fields) !== JSON.stringify(ACTOR_FIELDS))
      throw new Error(`actor_mlp.json fields ${JSON.stringify(fields)} differ from the encoder's`);
    if (header.dtype !== 'float32' || header.byte_order !== 'little') throw new Error('actor_mlp.bin must be float32 LE');
    if (new Uint8Array(Uint16Array.of(1).buffer)[0] !== 1) throw new Error('big-endian host');
    if (!['f64', 'f32'].includes(accumulate)) throw new Error(`accumulate ${accumulate}`);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.byteLength !== header.bytes) throw new Error(`actor_mlp.bin has ${u8.byteLength} bytes, header ${header.bytes}`);
    const w = new Float32Array(u8.slice().buffer); // own aligned copy
    const n = header.normaliser;
    this.mean = w.subarray(n.mean.offset, n.mean.offset + n.mean.length);
    this.std = w.subarray(n.std.offset, n.std.offset + n.std.length);
    this.clip = f32(n.clip);
    this.layers = header.layers.map((l) => ({
      nIn: l.in_features, nOut: l.out_features, elu: l.activation === 'elu',
      W: w.subarray(l.weight.offset, l.weight.offset + l.in_features * l.out_features),
      b: w.subarray(l.bias.offset, l.bias.offset + l.out_features),
    }));
    if (this.layers[0].nIn !== OBS_DIM) throw new Error('input width');
    this.accumulate = accumulate;
    const Buf = accumulate === 'f64' ? Float64Array : Float32Array;
    this.x = new Buf(OBS_DIM);
    this.h = this.layers.map((l) => new Buf(l.nOut));
    this.header = header;
  }

  /** Synchronous forward pass. @param {ArrayLike<number>} obs (141) @returns {Float64Array} (26) */
  forward(obs) {
    const { mean, std, clip, x } = this;
    for (let i = 0; i < OBS_DIM; i++) {
      const v = f32(f32(f32(obs[i]) - mean[i]) / std[i]);
      x[i] = v > clip ? clip : v < -clip ? -clip : v;
    }
    let input = x;
    if (this.accumulate === 'f64') {
      for (let k = 0; k < this.layers.length; k++) input = denseF64(this.layers[k], input, this.h[k]);
    } else {
      this.layers.forEach((l, k) => {
        const out = this.h[k], { W, b, nIn, nOut } = l;
        for (let j = 0; j < nOut; j++) {
          let acc = 0;
          const row = j * nIn;
          for (let i = 0; i < nIn; i++) acc = f32(acc + f32(W[row + i] * input[i]));
          acc = f32(acc + b[j]);
          out[j] = l.elu ? f32(elu(acc)) : acc;
        }
        input = out;
      });
    }
    return Float64Array.from(input);
  }

  /** Same call as Policy.act (the engine awaits it). @returns {Promise<Float64Array>} (26) */
  async act(obs) {
    return this.forward(obs);
  }

  async release() {}
}
