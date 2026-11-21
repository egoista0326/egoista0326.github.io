// Coordinate-frame arrows over the 3D view, drawn as the project videos draw them: overlay.py draw_axes
// (demo worktree runs/demo/20261115_fig2_multi_v7/scripts/), called by runs/demo/20261119_everyday_L_render
// everyday_L.py with width 8 px at 1280 px, goal alpha 0.5, goal dashed, no outline:
//   X / Y / Z = red / green / blue, sRGB (215, 25, 25) / (20, 150, 40) / (25, 70, 230);
//   object frame: solid lines, filled heads, dark origin dot; goal frame: dashed lines (dash max(9, 2.2 w) px,
//   period 1.8 dash), hollow heads, white origin dot, on its own layer at 50 % opacity, under the object frame;
//   head length h = 4.2 w (tip 0.4 h past the axis end, base 0.6 h before it, half width 0.45 h), head outline
//   0.6 w; origin dot radius 1.6 w with a 1 px dark rim (40, 40, 40).
// Screen space, on top of everything, as the videos composite them over the rendered frame. Points are CSS pixels.

const COLORS = ['rgb(215,25,25)', 'rgb(20,150,40)', 'rgb(25,70,230)'];
const DARK = 'rgb(40,40,40)';

export class AxesOverlay {
  /** @param {HTMLCanvasElement} canvas a transparent canvas over the view */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas'); // the goal frame's own layer
    this.layerCtx = this.layer.getContext('2d');
    this.dpr = 1;
  }

  /** Match the view size (CSS px) and device pixel ratio. */
  resize(width, height, dpr) {
    this.dpr = dpr;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(height * dpr));
    }
  }

  /**
   * @param {{origin: number[], tips: number[][], style: 'object'|'goal'}[]} frames projected origin and x / y / z
   *   tips (CSS px); null entries are skipped (behind the camera)
   * @param {number} width line width w (CSS px)
   * @param {number} [goalAlpha] extra opacity factor of the goal frame (its fade-in when a new goal appears)
   */
  draw(frames, width, goalAlpha = 1) {
    const { ctx, layerCtx, dpr } = this;
    for (const c of [ctx, layerCtx]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const goals = frames.filter((f) => f && f.style === 'goal');
    if (goals.length && goalAlpha > 0) {
      for (const f of goals) drawFrame(layerCtx, f, width);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.5 * goalAlpha;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }
    for (const f of frames) if (f && f.style === 'object') drawFrame(ctx, f, width);
  }
}

function drawFrame(ctx, frame, w) {
  const [ox, oy] = frame.origin, goal = frame.style === 'goal';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  frame.tips.forEach(([ex, ey], k) => {
    const n = Math.hypot(ex - ox, ey - oy);
    if (n < 1) return;
    const ux = (ex - ox) / n, uy = (ey - oy) / n;
    ctx.strokeStyle = ctx.fillStyle = COLORS[k];
    ctx.lineWidth = w;
    ctx.beginPath();
    if (goal) {
      const dash = Math.max(9, 2.2 * w);
      for (let t = 0; t < n - 0.5 * dash; t += 1.8 * dash) {
        ctx.moveTo(ox + ux * t, oy + uy * t);
        ctx.lineTo(ox + ux * Math.min(t + dash, n), oy + uy * Math.min(t + dash, n));
      }
    } else {
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    const h = 4.2 * w, sx = -uy * 0.45 * h, sy = ux * 0.45 * h;
    ctx.beginPath();
    ctx.moveTo(ex + ux * 0.4 * h, ey + uy * 0.4 * h);
    ctx.lineTo(ex - ux * 0.6 * h + sx, ey - uy * 0.6 * h + sy);
    ctx.lineTo(ex - ux * 0.6 * h - sx, ey - uy * 0.6 * h - sy);
    ctx.closePath();
    if (!goal) ctx.fill();
    ctx.lineWidth = Math.max(1, 0.6 * w);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(ox, oy, 1.6 * w, 0, 2 * Math.PI);
  ctx.fillStyle = goal ? 'rgba(255,255,255,0.9)' : DARK;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = DARK;
  ctx.stroke();
}
