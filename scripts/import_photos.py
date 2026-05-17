#!/usr/bin/env python3
"""Import selected photography works into optimized public assets and metadata."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/Users/lijiaxin/Desktop/Untitled Export")
DEFAULT_ASSET_DIR = REPO_ROOT / "public/assets/photography/works"
DEFAULT_CONTENT_DIR = REPO_ROOT / "src/content/photos"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
EXCLUDED_NAMES = {
    ".DS_Store",
    "contact_sheet_all_photos.jpg",
    "forphotographeronly_contest_candidates_2026-05-14.json",
}
EXCLUDED_MARKERS = (
    "contact_sheet",
    "bw_conversion_review",
    "forphotographeronly",
    "/docs/",
)
DEFAULT_CATEGORY = "street"
DEFAULT_CAMERA = "nikon-zf"
DEFAULT_LANGUAGE = "en"
MAX_LONG_EDGE = 2400
WEBP_QUALITY = 88


@dataclass
class SourcePhoto:
    path: Path
    slug: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import top-level source photos as WebP derivatives plus Astro Markdown metadata."
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--verify-derivative-policy", action="store_true")
    parser.add_argument("--max-long-edge", type=int, default=MAX_LONG_EDGE)
    parser.add_argument("--quality", type=int, default=WEBP_QUALITY)
    return parser.parse_args()


def slugify_source(path: Path) -> str:
    stem = path.stem.lower().lstrip("_").replace("_", "-")
    stem = re.sub(r"[^a-z0-9-]+", "-", stem)
    stem = re.sub(r"-+", "-", stem).strip("-")
    stem = re.sub(r"^dsc(\d+)$", r"dsc-\1", stem)
    return stem or "photo"


def inventory_source(source_dir: Path) -> tuple[list[SourcePhoto], list[str]]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")
    included: list[SourcePhoto] = []
    excluded: list[str] = []
    seen_slugs: dict[str, Path] = {}

    for path in sorted(source_dir.iterdir(), key=lambda item: item.name.lower()):
        name = path.name
        marker_path = str(path)

        if path.is_dir():
            excluded.append(f"{marker_path} [directory ignored]")
            continue
        if name.startswith(".") or name in EXCLUDED_NAMES:
            excluded.append(f"{marker_path} [explicitly excluded]")
            continue
        if any(marker in marker_path for marker in EXCLUDED_MARKERS):
            excluded.append(f"{marker_path} [excluded marker]")
            continue
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            excluded.append(f"{marker_path} [not an image candidate]")
            continue

        slug = slugify_source(path)
        if slug in seen_slugs:
            raise ValueError(f"Slug collision for {path} and {seen_slugs[slug]}: {slug}")
        seen_slugs[slug] = path
        included.append(SourcePhoto(path=path, slug=slug))

    return included, excluded


def load_manifest(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Manifest must be a JSON array")
    manifest: dict[str, dict[str, Any]] = {}
    for entry in data:
        if not isinstance(entry, dict) or not isinstance(entry.get("source"), str):
            raise ValueError("Each manifest entry must contain a string source field")
        source_name = Path(entry["source"]).name
        if source_name in manifest:
            raise ValueError(f"Duplicate manifest source: {source_name}")
        manifest[source_name] = entry
    return manifest


def orientation_for(width: int, height: int) -> str:
    if width == height:
        return "square"
    return "portrait" if height > width else "landscape"


def resize_and_save(source: Path, target: Path, max_long_edge: int, quality: int) -> tuple[int, int, str]:
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((max_long_edge, max_long_edge), Image.Resampling.LANCZOS)

        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")

        target.parent.mkdir(parents=True, exist_ok=True)
        save_kwargs: dict[str, Any] = {"format": "WEBP", "quality": quality, "method": 6}
        icc_profile = image.info.get("icc_profile")
        if icc_profile:
            save_kwargs["icc_profile"] = icc_profile
        image.save(target, **save_kwargs)
        width, height = image.size

    return width, height, orientation_for(width, height)


def image_dimensions(source: Path) -> tuple[int, int, str]:
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        width, height = image.size
    return width, height, orientation_for(width, height)


def default_entry(photo: SourcePhoto, order: int) -> dict[str, Any]:
    return {
        "source": photo.path.name,
        "slug": photo.slug,
        "title": "Untitled",
        "category": DEFAULT_CATEGORY,
        "location": "",
        "camera": DEFAULT_CAMERA,
        "lens": "",
        "weather": "",
        "featured": True,
        "order": order,
        "note": "",
        "alt": "Photograph by Jiaxin Li.",
    }


def merged_entry(photo: SourcePhoto, manifest: dict[str, dict[str, Any]], order: int) -> dict[str, Any]:
    entry = default_entry(photo, order)
    entry.update(manifest.get(photo.path.name, {}))
    entry["source"] = photo.path.name
    entry["slug"] = entry.get("slug") or photo.slug
    entry["title"] = entry.get("title") or "Untitled"
    entry["category"] = entry.get("category") or DEFAULT_CATEGORY
    entry["camera"] = entry.get("camera", DEFAULT_CAMERA)
    entry["featured"] = bool(entry.get("featured", True))
    entry["order"] = int(entry.get("order", order))
    return entry


def yaml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if value is None:
        return '""'
    return json.dumps(str(value), ensure_ascii=False)


def metadata_frontmatter(entry: dict[str, Any], width: int, height: int, orientation: str) -> str:
    slug = entry["slug"]
    fields: list[tuple[str, Any]] = [
        ("title", entry.get("title", "Untitled")),
        ("slug", slug),
        ("category", entry.get("category", DEFAULT_CATEGORY)),
        ("image", f"/assets/photography/works/{slug}.webp"),
        ("alt", entry.get("alt", "")),
        ("width", width),
        ("height", height),
        ("orientation", orientation),
        ("date", entry.get("date", "")),
        ("year", entry.get("year", "")),
        ("location", entry.get("location", "")),
        ("camera", entry.get("camera", DEFAULT_CAMERA)),
        ("lens", entry.get("lens", "")),
        ("weather", entry.get("weather", "")),
        ("featured", entry.get("featured", True)),
        ("order", entry.get("order", 0)),
        ("note", entry.get("note", "")),
        ("draftMetadata", True),
        ("language", entry.get("language", DEFAULT_LANGUAGE)),
    ]
    lines = ["---", *(f"{key}: {yaml_value(value)}" for key, value in fields), "---", ""]
    return "\n".join(lines)


def clean_outputs(asset_dir: Path, content_dir: Path) -> None:
    asset_dir.mkdir(parents=True, exist_ok=True)
    content_dir.mkdir(parents=True, exist_ok=True)
    for path in asset_dir.iterdir():
        if path.is_file():
            path.unlink()
    for path in content_dir.glob("*.md"):
        path.unlink()


def verify_derivative_policy(photo: SourcePhoto, max_long_edge: int, quality: int) -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        target = Path(tmp_dir) / f"{photo.slug}.webp"
        resize_and_save(photo.path, target, max_long_edge, quality)
        with Image.open(photo.path) as source_image, Image.open(target) as target_image:
            if target_image.getexif():
                raise RuntimeError(f"Derivative retained EXIF metadata: {target}")
            if target.stat().st_size >= photo.path.stat().st_size:
                print(
                    f"warning: derivative is not smaller than source for {photo.path.name}",
                    file=sys.stderr,
                )
            if target_image.format != "WEBP":
                raise RuntimeError(f"Derivative is not WebP: {target}")
            if max(target_image.size) > max_long_edge:
                raise RuntimeError(f"Derivative exceeds max long edge: {target}")
            _ = source_image.size


def write_report(report_path: Path | None, report: dict[str, Any]) -> None:
    if report_path is None:
        return
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run() -> int:
    args = parse_args()
    source_dir = args.source.expanduser().resolve()
    included, excluded = inventory_source(source_dir)
    manifest = load_manifest(args.manifest)

    if args.manifest is not None:
        source_names = {photo.path.name for photo in included}
        manifest_names = set(manifest)
        missing = sorted(source_names - manifest_names)
        extra = sorted(manifest_names - source_names)
        if missing or extra:
            raise ValueError(
                "Manifest/source mismatch: "
                f"missing={missing or 'none'}, extra={extra or 'none'}"
            )

    if args.verify_derivative_policy and included:
        verify_derivative_policy(included[0], args.max_long_edge, args.quality)

    planned: list[dict[str, Any]] = []

    if args.dry_run:
        for index, photo in enumerate(included, start=1):
            entry = merged_entry(photo, manifest, index * 10)
            width, height, orientation = image_dimensions(photo.path)
            planned.append(
                {
                    "source": str(photo.path),
                    "slug": entry["slug"],
                    "category": entry.get("category", DEFAULT_CATEGORY),
                    "asset": str(DEFAULT_ASSET_DIR / f"{entry['slug']}.webp"),
                    "metadata": str(DEFAULT_CONTENT_DIR / f"{entry['slug']}.md"),
                    "width": width,
                    "height": height,
                    "orientation": orientation,
                }
            )
    else:
        if not args.replace:
            raise RuntimeError("Refusing to write import output without --replace")
        clean_outputs(DEFAULT_ASSET_DIR, DEFAULT_CONTENT_DIR)
        for index, photo in enumerate(included, start=1):
            entry = merged_entry(photo, manifest, index * 10)
            width, height, orientation = resize_and_save(
                photo.path,
                DEFAULT_ASSET_DIR / f"{entry['slug']}.webp",
                args.max_long_edge,
                args.quality,
            )
            metadata_path = DEFAULT_CONTENT_DIR / f"{entry['slug']}.md"
            metadata_path.write_text(
                metadata_frontmatter(entry, width, height, orientation),
                encoding="utf-8",
            )
            planned.append(
                {
                    "source": str(photo.path),
                    "slug": entry["slug"],
                    "category": entry.get("category", DEFAULT_CATEGORY),
                    "asset": str(DEFAULT_ASSET_DIR / f"{entry['slug']}.webp"),
                    "metadata": str(metadata_path),
                    "width": width,
                    "height": height,
                    "orientation": orientation,
                }
            )

    report = {
        "source": str(source_dir),
        "dry_run": bool(args.dry_run),
        "included_count": len(included),
        "excluded_count": len(excluded),
        "included": planned,
        "excluded": excluded,
        "settings": {
            "asset_dir": str(DEFAULT_ASSET_DIR),
            "content_dir": str(DEFAULT_CONTENT_DIR),
            "max_long_edge": args.max_long_edge,
            "quality": args.quality,
            "format": "WEBP",
            "exif": "not copied",
            "icc": "preserved when available",
        },
    }
    write_report(args.report, report)
    print(f"included: {len(included)}")
    print(f"excluded: {len(excluded)}")
    if args.report:
        print(f"report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
