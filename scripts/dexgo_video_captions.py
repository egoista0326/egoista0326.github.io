#!/usr/bin/env python3
"""WebVTT captions of the DexGO project video from its narration timeline.

The video's build (uniassemble-talk, video/c/make_alt.py) writes <video>.clips.json next to the video: per screen,
the narration parts placed on the timeline (`start`/`end` in seconds of the video, `text` as written, `spoken` as
sent to the voice), and per narration line its voice file (`voice.line_files`), whose .json holds edge-tts word
boundaries (seconds into that file). One cue per narration part; a part longer than MAX_CHARS characters is split at
a clause break (or the word nearest its middle) and timed by the word boundaries, and a cue longer than LINE_CHARS is
set on two balanced lines (the player would otherwise fill the first line and leave a word or two on the second).

    python3 scripts/dexgo_video_captions.py <video>.clips.json --voice <voice dir> \\
        --out public/assets/dexgo/video/dexgo_video.en.vtt

The cue text is the written form (DexGO, not the spoken "Dex Go"). Expected errors print one line and exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MAX_CHARS = 84  # two caption lines of about 42 characters
LINE_CHARS = 42  # longer cues are broken into two lines
HOLD = 0.4  # seconds a cue stays after its last word, unless the next cue starts first
GAP = 0.05  # seconds between a cue's end and the next cue's start
# Words a cue may start with when no clause mark is near the middle of a long part.
JOINING = {"and", "to", "for", "from", "where", "even", "with", "across", "reaching", "achieving"}

TOKEN = re.compile(r"[A-Za-z0-9']+")
# Spoken forms of written names, as in the video's voice.py (the voice files hold the spoken words).
SPOKEN = {"DexGO": "Dex Go", "DexterityGen": "Dexterity Gen"}


def tokens(text: str) -> list[str]:
    """Lower-case words of `text` in their spoken form (punctuation and hyphens split words, as in the boundaries)."""
    for written, spoken in SPOKEN.items():
        text = text.replace(written, spoken)
    return [t.lower() for t in TOKEN.findall(text)]


def line_words(clips: dict, voice_dir: Path) -> list[list[tuple[float, float, str]]]:
    """Word boundaries [(start, end, token)] of every narration line's voice file(s), in seconds of that file."""
    lines = []
    for files in clips["voice"]["line_files"].values():
        words: list[tuple[float, float, str]] = []
        for mp3 in (f.strip() for f in files.split("+")):
            data = json.loads((voice_dir / Path(mp3).with_suffix(".json").name).read_text())
            for w0, w1, word in data["words"]:
                words += [(w0, w1, t) for t in tokens(word)]
        lines.append(words)
    return lines


def part_timing(spoken: str, start: float, lines: list) -> list[tuple[float, float]] | None:
    """Timeline (start, end) of each token of a narration part, or None when no voice file holds its words."""
    want = tokens(spoken)
    for words in lines:
        seq = [w[2] for w in words]
        for i in range(len(seq) - len(want) + 1):
            if seq[i : i + len(want)] == want:
                first = words[i][0]
                return [(start + w0 - first, start + w1 - first) for w0, w1, _ in words[i : i + len(want)]]
    return None


def split_points(words: list[str]) -> list[int]:
    """Indices i where a cue may end after words[i - 1], best first: after a clause mark, then before a joining
    word, then anywhere; within a kind, nearest the middle (by characters)."""
    total = len(" ".join(words))
    best = []
    for i in range(1, len(words)):
        before = len(" ".join(words[:i]))
        kind = 0 if words[i - 1][-1] in ",:;" else 1 if words[i].lower() in JOINING else 2
        best.append((kind, abs(before - total / 2), i))
    return [i for _, _, i in sorted(best)]


def chunks(words: list[str]) -> list[list[str]]:
    """Words of a part split into cues of at most MAX_CHARS characters; a piece is never under a quarter of the part."""
    text = " ".join(words)
    if len(text) <= MAX_CHARS:
        return [words]
    for i in split_points(words):
        left, right = " ".join(words[:i]), " ".join(words[i:])
        if min(len(left), len(right)) >= len(text) / 4:
            return chunks(words[:i]) + chunks(words[i:])
    i = split_points(words)[0]
    return chunks(words[:i]) + chunks(words[i:])


def two_lines(text: str) -> str:
    """`text` on two lines of nearly equal length (the break after a clause mark when one is near the middle)."""
    if len(text) <= LINE_CHARS:
        return text
    words = text.split()
    i = balanced(words)
    return " ".join(words[:i]) + "\n" + " ".join(words[i:])


def balanced(words: list[str]) -> int:
    """Index where `words` splits into two lines of the most equal length, a clause mark winning within 6 chars."""
    total = len(" ".join(words))
    best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - total / 2))
    near = [i for i in range(1, len(words)) if words[i - 1][-1] in ",:;" and abs(len(" ".join(words[:i])) - total / 2) <= 6]
    return near[0] if near else best


def stamp(t: float) -> str:
    ms = round(t * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


def build(clips: dict, voice_dir: Path) -> list[tuple[float, float, str]]:
    """Cues [(start, end, text)] in seconds of the video, in order and without overlap."""
    lines = line_words(clips, voice_dir)
    cues: list[tuple[float, float, str]] = []
    for screen in clips["screens"]:
        for part in screen.get("narration", []):
            pieces = chunks(part["text"].split())
            if len(pieces) == 1:
                cues.append((part["start"], part["end"], part["text"]))
                continue
            timing = part_timing(part["spoken"], part["start"], lines)
            if timing is None or len(timing) != len(tokens(part["text"])):
                raise ValueError(f"no word boundaries for: {part['spoken']}")
            k = 0
            for n, piece in enumerate(pieces):
                k_next = k + len(tokens(" ".join(piece)))
                t0 = part["start"] if n == 0 else timing[k][0]
                t1 = part["end"] if n == len(pieces) - 1 else timing[k_next][0]
                cues.append((t0, t1, " ".join(piece)))
                k = k_next
    cues.sort()
    duration = float(clips["seconds"])
    out = []
    for n, (t0, t1, text) in enumerate(cues):
        nxt = cues[n + 1][0] if n + 1 < len(cues) else duration
        if t1 >= nxt - GAP:
            end = nxt  # a piece of a split part runs into the next piece without a gap
        else:
            end = min(t1 + HOLD, nxt - GAP)  # held a little after the voice, never into the next cue
        out.append((t0, min(end, duration), text))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path, help="<video>.clips.json of the video build")
    ap.add_argument("--voice", type=Path, required=True, help="folder of the voice files (voice/<key>.json)")
    ap.add_argument("--out", type=Path, required=True, help="WebVTT file to write")
    args = ap.parse_args()
    try:
        clips = json.loads(args.clips.read_text())
        cues = build(clips, args.voice)
    except (OSError, ValueError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    body = "".join(f"\n{stamp(t0)} --> {stamp(t1)}\n{two_lines(text)}\n" for t0, t1, text in cues)
    args.out.write_text("WEBVTT\n" + body)
    print(f"{len(cues)} cues, {cues[0][0]:.2f}-{cues[-1][1]:.2f} s -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
