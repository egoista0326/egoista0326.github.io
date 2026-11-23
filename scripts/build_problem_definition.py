#!/usr/bin/env python3
"""Assets of the /dexgo/ 'Problem definition' figure, composed from the talk's layered renders (no new renders).

Source: the wide episode used by the talk (slides/make_layered.py) and the project video (video/c/make_full.py,
build_def), rendered into /mnt/data/jiaxli/uniassemble/runs/demo/20261118_layered_wide_render/render (stills/ and
motion_hand_object.webm). The files used here are kept, byte for byte, in SRC (the talk's copies in the Obsidian demo
folder are being cleaned up): transparent 1920x1080 layers of the initial state and the goal, the goal's rot2 wrist
frame (goal_wrist_axes_rot2.png: fixed to the wrist, turned by a fixed offset for legibility, as in the talk) and
motion_hand_object.webm (the policy's motion, VP9 with alpha).
As in the project video: motion at 1.5x, the goal shown transparent under it, transparent copies of the hand left at
source frames 0, 36, 70, 106 (opacity 0.32). The goal ghost is 0.40 in the stills and the video (talk: 0.38 / 0.42)
so the still -> video cross-fade does not jump.
The relative pose is a dashed teal arc between the origins of the wrist frame and the object frame, bowed off the
straight line (which runs along the frames' green arrows) and drawn over the frames with a white halo; that view shows
the goal hand at REL_HAND, so the frame on the wrist reads as the hand's. The overlays drawn over the looping motion
repeat each still's goal layers at OVERLAY (outline, frames and arc at full strength), so a part highlighted over the
motion looks like its still.

Output (public/assets/dexgo/problem/): pd_{start,rel,fingers,world,all}.webp (opaque, on white), ov_{rel,fingers,world}.webp
(transparent overlays drawn over the video), pd_motion.mp4 (H.264, BT.709 limited range, white lifted to pure white),
geometry.json (crop, state boxes as fractions of the frame, duration).

    python3 scripts/build_problem_definition.py
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = "/mnt/data/jiaxli/personal_web/sources/dexgo_problem_definition"
MOTION = SRC + "/motion_hand_object.webm"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "dexgo", "problem")
SPEED, GHOST, TRAIL, TRAIL_A, FPS = 1.5, 0.40, (0, 36, 70, 106), 0.32, 30
HOLD = 1.2                       # seconds the reached goal is held at the end of the clip
OUT_W = 1600                     # encoded width (the figure is at most 800 CSS px wide)
TEAL = (67, 143, 135)            # --accent
MARGIN = 20
REL_HAND = 0.45                  # the goal hand over the relative-pose view (its own layer has only a faint ghost)
OVERLAY = 0.8                    # a highlighted part's goal layers drawn over the motion


def layer(name):
    """A source layer; the goal's wrist frame is the talk's rot2 frame."""
    if name == "goal_wrist_axes":
        name = "goal_wrist_axes_rot2"
    return Image.open(f"{SRC}/{name}.png").convert("RGBA")


def fade(im, a):
    im = im.copy()
    im.putalpha(im.getchannel("A").point(lambda v: int(round(v * a))))
    return im


def stack(size, *layers, bg=(255, 255, 255, 255)):
    out = Image.new("RGBA", size, bg)
    for im in layers:
        out = Image.alpha_composite(out, im)
    return out


def outline(im, width=9):
    """A teal ring just outside the silhouette of a layer (its alpha dilated minus itself)."""
    a = im.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    ring = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(width)), a).filter(ImageFilter.GaussianBlur(0.6))
    out = Image.new("RGBA", im.size, TEAL + (0,))
    out.putalpha(ring)
    return out


def origin(axes):
    """The origin of a frame layer: the centroid of its dark origin sphere (the arrows are red, green and blue)."""
    box = axes.getbbox()
    sx = sy = n = 0
    px = axes.load()
    for y in range(box[1], box[3]):
        for x in range(box[0], box[2]):
            r, g, b, a = px[x, y]
            if a > 200 and max(r, g, b) < 70:
                sx, sy, n = sx + x, sy + y, n + 1
    if n == 0:
        sys.exit("no origin sphere in the frame layer")
    return sx / n, sy / n


def arc(size, p, q, bow=0.32, colour=TEAL, width=9, halo=4, dash=20, gap=13, clear=20, dot=8, k=2):
    """A dashed arc p -> q: a quadratic curve whose control point sits bow x |pq| off the middle of pq, on the left of
    p -> q in image coordinates. Each dash has a white halo; both ends get a dot with a white rim, and `clear` px of
    each end are left to the dots. Drawn k times larger and reduced for a smooth edge."""
    (x0, y0), (x1, y1) = p, q
    c = ((x0 + x1) / 2 + (y1 - y0) * bow, (y0 + y1) / 2 - (x1 - x0) * bow)
    pts = [((1 - t) ** 2 * x0 + 2 * (1 - t) * t * c[0] + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * c[1] + t * t * y1)
           for t in (i / 2000 for i in range(2001))]
    at = [0.0]
    for a, b in zip(pts, pts[1:]):
        at.append(at[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    dashes, s = [], clear
    while s < at[-1] - clear:
        e = min(at[-1] - clear, s + dash)
        dashes.append([(x * k, y * k) for (x, y), d in zip(pts, at) if s <= d <= e])
        s = e + gap
    big = Image.new("RGBA", (size[0] * k, size[1] * k), (255, 255, 255, 0))
    d = ImageDraw.Draw(big)

    def stroke(line, w, fill):
        if len(line) > 1:
            d.line(line, fill=fill, width=round(w * k), joint="curve")
        for x, y in (line[0], line[-1]):
            d.ellipse([x - w * k / 2, y - w * k / 2, x + w * k / 2, y + w * k / 2], fill=fill)

    for w, fill in ((width + 2 * halo, (255, 255, 255, 255)), (width, colour + (255,))):
        for line in dashes:
            stroke(line, w, fill)
    for x, y in (p, q):
        for r, fill in ((dot + halo / 2, (255, 255, 255, 255)), (dot, colour + (255,))):
            d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=fill)
    return big.resize(size, Image.LANCZOS)


def run(args):
    subprocess.run(args, check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    init, goal = layer("init_hand_object"), layer("goal_hand_object")
    size = init.size
    tmp = tempfile.mkdtemp()
    # the area the motion covers: alpha boxes of frames every 0.25 s
    run(["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", MOTION, "-vf", "fps=4,format=rgba", f"{tmp}/m%03d.png"])
    boxes = [init.getbbox(), goal.getbbox()] + [layer(n).getbbox() for n in ("goal_wrist_axes", "goal_object_axes")]
    for f in sorted(os.listdir(tmp)):
        b = Image.open(f"{tmp}/{f}").getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
        if b:
            boxes.append(b)
    x1, y1 = max(0, min(b[0] for b in boxes) - MARGIN), max(0, min(b[1] for b in boxes) - MARGIN)
    x2, y2 = min(size[0], max(b[2] for b in boxes) + MARGIN), min(size[1], max(b[3] for b in boxes) + MARGIN)
    cw, ch = (x2 - x1) // 2 * 2, (y2 - y1) // 2 * 2
    crop = (x1, y1, x1 + cw, y1 + ch)
    out_h = round(OUT_W * ch / cw / 2) * 2

    wrist_axes, obj_axes = layer("goal_wrist_axes"), layer("goal_object_axes")
    wrist_o, obj_o = origin(wrist_axes), origin(obj_axes)
    # the relative pose: an arc from the object frame's origin to the wrist frame's, bowed away from the arrows
    link = arc(size, obj_o, wrist_o)
    hand_ring, obj_ring = outline(layer("goal_hand")), outline(layer("goal_object"))
    ghost = fade(goal, GHOST)
    clear = (255, 255, 255, 0)
    # each part's goal layers: the relative pose shows object and hand, the fingers the hand, the world pose the object
    goal_rel = stack(size, layer("goal_object_solid_hand_ghost"), fade(goal, REL_HAND), bg=clear)
    goal_fingers, goal_world = layer("goal_hand_solid_object_ghost"), layer("goal_object_solid_hand_ghost")
    stills = {
        "pd_start": stack(size, ghost, init),
        "pd_rel": stack(size, goal_rel, wrist_axes, obj_axes, link, init),
        "pd_fingers": stack(size, goal_fingers, hand_ring, init),
        "pd_world": stack(size, goal_world, obj_ring, obj_axes, init),
        "pd_all": stack(size, goal, wrist_axes, obj_axes, link, init),
    }
    overlays = {
        "ov_rel": stack(size, fade(goal_rel, OVERLAY), wrist_axes, obj_axes, link, bg=clear),
        "ov_fingers": stack(size, fade(goal_fingers, OVERLAY), hand_ring, bg=clear),
        "ov_world": stack(size, fade(goal_world, OVERLAY), obj_ring, obj_axes, bg=clear),
    }
    for name, im in stills.items():
        im.crop(crop).resize((OUT_W, out_h), Image.LANCZOS).convert("RGB").save(f"{OUT}/{name}.webp", quality=84,
                                                                                 method=6)
    for name, im in overlays.items():
        im.crop(crop).resize((OUT_W, out_h), Image.LANCZOS).save(f"{OUT}/{name}.webp", quality=90, method=6)

    # the motion clip: white, the goal ghost, the copies left behind, the motion (all composed in RGB)
    under = f"{tmp}/under.png"
    stack(size, ghost).save(under)
    args, fc = ["-loop", "1", "-framerate", str(FPS), "-i", under], []
    dec = "scale=in_color_matrix=bt709:in_range=tv,format=rgba"
    for i, fr in enumerate(TRAIL):
        p = f"{tmp}/trail{i}.png"
        run(["ffmpeg", "-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", MOTION, "-vf",
             f"select=eq(n\\,{fr}),{dec}", "-frames:v", "1", p])
        fade(Image.open(p).convert("RGBA"), TRAIL_A).save(p)
        args += ["-loop", "1", "-framerate", str(FPS), "-i", p]
    src_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                    MOTION], capture_output=True, text=True).stdout)
    dur = src_dur / SPEED + HOLD
    args += ["-c:v", "libvpx-vp9", "-i", MOTION]
    m = len(TRAIL) + 1
    fc.append(f"[0:v]format=rgba[b0]")
    for i, fr in enumerate(TRAIL):
        t = fr / FPS / SPEED
        fc.append(f"[b{i}][{i + 1}:v]overlay=format=rgb:enable='gte(t,{t:.3f})'[b{i + 1}]")
    fc.append(f"[{m}:v]{dec},lutrgb=a='if(lt(val,12),0,val)',setpts=PTS/{SPEED},fps={FPS},"
              f"tpad=stop_mode=clone:stop_duration={HOLD}[mv]")
    fc.append(f"[b{len(TRAIL)}][mv]overlay=format=rgb:shortest=1,crop={cw}:{ch}:{x1}:{y1},"
              f"scale={OUT_W}:{out_h}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,"
              f"lutyuv=y='if(gte(val,232),244,val)'[out]")
    run(["ffmpeg", "-y", "-v", "error", *args, "-filter_complex", ";".join(fc), "-map", "[out]", "-t", f"{dur:.3f}",
         "-r", str(FPS), "-c:v", "libx264", "-crf", "24", "-preset", "slow", "-pix_fmt", "yuv420p",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
         "-movflags", "+faststart", "-an", f"{OUT}/pd_motion.mp4"])

    def rel(b):
        return [round((b[0] - x1) / cw, 4), round((b[1] - y1) / ch, 4), round((b[2] - x1) / cw, 4),
                round((b[3] - y1) / ch, 4)]
    geo = dict(width=OUT_W, height=out_h, crop=list(crop), init=rel(init.getbbox()), goal=rel(goal.getbbox()),
               duration=round(dur, 3), wrist_origin=[round(v, 1) for v in wrist_o], object_origin=[round(v, 1) for v in obj_o])
    json.dump(geo, open(f"{OUT}/geometry.json", "w"), indent=1)
    print(geo)


if __name__ == "__main__":
    main()
