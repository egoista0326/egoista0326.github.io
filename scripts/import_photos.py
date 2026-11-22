#!/usr/bin/env python3
"""Import photographs as WebP derivatives, width variants and Astro Markdown metadata.

Add and batch mode take their metadata from the import manifest (scripts/photo-import-drafts.json),
one entry per photo, matched to an image by its file name (`"source"`):

  Add mode: import only the named images. Never deletes and never overwrites an existing photo.
    python3 scripts/import_photos.py --add path/to/photo.jpg \\
        --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json

  Batch mode: import every top-level image of --source. With --replace the library is rewritten
  from that folder, and photos that are no longer in it are deleted with their variants.
  It refuses to overwrite Markdown values that differ from the manifest (hand edits) unless
  --overwrite-edits is given.
    python3 scripts/import_photos.py --source source_photos/average --replace \\
        --manifest scripts/photo-import-drafts.json --report docs/photo-import-report.json

  Backfill mode: write the missing width variants of every published WebP (no paths), or of the
  given images under public/assets/photography/. Originals are never rewritten.
    python3 scripts/import_photos.py --backfill-variants --report docs/photo-import-report.json

Every photo gets public/assets/photography/variants/<slug>-<width>.webp for each width of
VARIANT_WIDTHS that is smaller than the derivative's width; the derivative itself is the largest
candidate. Add and batch mode write all files into a dot-directory at the repository root first
and move them into place only after every write succeeded, so a failure leaves the library as it
was. Add --dry-run to any mode to print the plan without writing anything (not even the report).
Expected errors print one line and exit with code 2; refusals (nothing written) exit with code 1.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import tempfile
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageCms, ImageOps

# Library locations. Functions read these module attributes at call time, so tests can point
# them at a temporary tree; the CLI always uses the defaults below.
REPO_ROOT = Path(__file__).resolve().parents[1]
PHOTOGRAPHY_DIR = REPO_ROOT / "public/assets/photography"
ASSET_DIR = PHOTOGRAPHY_DIR / "works"
VARIANT_DIR = PHOTOGRAPHY_DIR / "variants"
CONTENT_DIR = REPO_ROOT / "src/content/photos"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
EXCLUDED_NAMES = {
    ".DS_Store",
    "contact_sheet_all_photos.jpg",
    "forphotographeronly_contest_candidates_2026-05-14.json",
}
# Matched against the lower-cased file name only (never the folder path).
EXCLUDED_MARKERS = (
    "contact_sheet",
    "bw_conversion_review",
    "forphotographeronly",
)
DEFAULT_CATEGORY = "street"
DEFAULT_CAMERA = "nikon-zf"
DEFAULT_LANGUAGE = "en"
LEGACY_CONDITIONS = {
    "sunny-day": ("clear", []),
    "rainy-night": ("rain", ["night"]),
}
MAX_LONG_EDGE = 2400
WEBP_QUALITY = 88
# Responsive width variants (pixels). The site's srcset reads the same widths from the report
# (settings.variant_widths); scripts/verify_photo_import.mjs checks the files against it. 960 serves
# phones at DPR 2 (a 390 px screen shows a photo about 350 px wide, 700 device px) without the 1200 file.
VARIANT_WIDTHS = (640, 960, 1200)
VARIANT_QUALITY = 82
# Same rule as the content schema (src/content.config.ts).
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VARIANT_NAME = re.compile(r"^(?P<stem>.+)-(?P<width>[0-9]+)\.webp$", re.IGNORECASE)
STAGING_PREFIX = ".photo-import-staging-"
# Frontmatter fields computed from the image file; every other field comes from the manifest.
IMAGE_DERIVED_FIELDS = {"image", "width", "height", "orientation"}


@dataclass
class SourcePhoto:
    path: Path
    slug: str


class StagedFiles:
    """New files written under a dot-directory at the repository root, moved into place together.

    Staging inside the repository keeps os.replace a rename on one filesystem. Nothing reaches
    its final path before commit(); the staging directory is removed on exit either way.
    """

    def __init__(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=REPO_ROOT))
        self._moves: list[tuple[Path, Path]] = []

    def __enter__(self) -> StagedFiles:
        return self

    def __exit__(self, *exc_info: object) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def path_for(self, final: Path) -> Path:
        """Staging path for `final` (a path inside the repository)."""
        staged = self.root / final.resolve().relative_to(REPO_ROOT.resolve())
        staged.parent.mkdir(parents=True, exist_ok=True)
        self._moves.append((staged, final))
        return staged

    def commit(self) -> None:
        """Move every staged file to its final path; images before the records that name them."""
        for staged, final in sorted(self._moves, key=lambda move: move[1].suffix == ".md"):
            final.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged, final)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import photos as WebP derivatives, width variants and Astro Markdown metadata.",
        epilog="See the module docstring (or docs/photography-metadata.md) for examples.",
    )
    parser.add_argument("--source", type=Path, help="batch mode: folder whose top-level images are imported")
    parser.add_argument(
        "--add",
        type=Path,
        nargs="+",
        metavar="IMAGE",
        help="add mode: import only these images; each needs a manifest entry whose source is its file name",
    )
    parser.add_argument(
        "--backfill-variants",
        type=Path,
        nargs="*",
        metavar="IMAGE",
        help=(
            "backfill mode: write missing (or wrongly sized) width variants of every "
            "public/assets/photography/works/*.webp, or of the given images in public/assets/photography/ "
            "or its works/ folder; originals are never rewritten"
        ),
    )
    parser.add_argument("--manifest", type=Path, help="metadata entries (required with --add and --replace)")
    parser.add_argument("--report", type=Path, help="import report to write (batch) or update (add, backfill)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, write nothing")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="batch mode: rewrite the library from --source and delete photos that are not in it",
    )
    parser.add_argument(
        "--overwrite-edits",
        action="store_true",
        help="with --replace: overwrite Markdown values that differ from the manifest",
    )
    parser.add_argument(
        "--verify-derivative-policy",
        action="store_true",
        help=(
            "before writing, encode the first photo to a temporary file and stop unless it is a WebP "
            "without EXIF whose long edge is at most --max-long-edge"
        ),
    )
    parser.add_argument(
        "--max-long-edge",
        type=int,
        default=MAX_LONG_EDGE,
        help=f"long edge of the WebP derivative in pixels; smaller images are not enlarged (default: {MAX_LONG_EDGE})",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=WEBP_QUALITY,
        help=f"WebP quality 0-100 of the derivative (default: {WEBP_QUALITY}); variants always use {VARIANT_QUALITY}",
    )
    args = parser.parse_args(argv)

    modes = [flag for flag, value in (("--add", args.add), ("--source", args.source)) if value]
    if args.backfill_variants is not None:
        modes.append("--backfill-variants")
    if len(modes) > 1:
        parser.error(f"use one of --source (batch), --add or --backfill-variants, not {' and '.join(modes)}")
    if not modes:
        parser.error(
            "give --add IMAGE [IMAGE ...], --source FOLDER (there is no default source folder) "
            "or --backfill-variants [IMAGE ...]"
        )
    if (args.add or args.backfill_variants is not None) and (args.replace or args.overwrite_edits):
        parser.error("--replace and --overwrite-edits belong to batch mode; the other modes never delete or overwrite")
    if (args.add or args.replace) and args.manifest is None:
        parser.error("--manifest is required with --add and --replace (it holds the photo metadata)")
    return args


def repo_path(path: Path) -> str:
    """Repository-relative POSIX path, or only the file name for a path outside the repository."""
    try:
        return path.resolve().relative_to(REPO_ROOT.resolve()).as_posix()
    except ValueError:
        return path.name


def slugify_source(path: Path) -> str:
    stem = path.stem.lower().lstrip("_").replace("_", "-")
    stem = re.sub(r"[^a-z0-9-]+", "-", stem)
    stem = re.sub(r"-+", "-", stem).strip("-")
    stem = re.sub(r"^dsc(\d+)$", r"dsc-\1", stem)
    return stem or "photo"


def source_slug(path: Path, manifest: dict[str, dict[str, Any]]) -> str:
    """Slug of a source image: its manifest `slug`, else derived from the file name; validated."""
    slug = str(manifest.get(path.name, {}).get("slug") or slugify_source(path))
    if not SLUG_PATTERN.fullmatch(slug):
        raise ValueError(
            f'{path.name}: slug "{slug}" must be lowercase letters and digits joined by single "-", e.g. "dsc-0046"'
        )
    return slug


def exclusion_reason(path: Path) -> str | None:
    """Why a source file is not imported, or None for an image candidate (rules use the name only)."""
    name = path.name
    if path.is_dir():
        return "directory ignored"
    if name.startswith(".") or name in EXCLUDED_NAMES:
        return "explicitly excluded"
    if any(marker in name.lower() for marker in EXCLUDED_MARKERS):
        return "excluded marker"
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        return "not an image candidate"
    return None


def inventory_source(
    source_dir: Path, manifest: dict[str, dict[str, Any]] | None = None
) -> tuple[list[SourcePhoto], list[str]]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")
    included: list[SourcePhoto] = []
    excluded: list[str] = []
    seen_slugs: dict[str, Path] = {}
    manifest = manifest or {}

    for path in sorted(source_dir.iterdir(), key=lambda item: item.name.lower()):
        reason = exclusion_reason(path)
        if reason:
            excluded.append(f"{repo_path(path)} [{reason}]")
            continue
        slug = source_slug(path, manifest)
        if slug in seen_slugs:
            raise ValueError(f"Slug collision for {path.name} and {seen_slugs[slug].name}: {slug}")
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


def web_image(image: Image.Image) -> tuple[Image.Image, bytes | None]:
    """`image` in RGB/RGBA plus the ICC profile to embed (only an RGB-space profile is kept).

    CMYK is converted through its embedded profile to sRGB when possible, else plainly; a CMYK or
    grey profile is never carried into the RGB output.
    """
    profile = image.info.get("icc_profile") or None
    if image.mode in ("RGB", "RGBA"):
        return image, profile
    if image.mode == "CMYK" and profile:
        try:
            converted = ImageCms.profileToProfile(
                image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile("sRGB"), outputMode="RGB"
            )
            if converted is not None:
                return converted, None
        except (ImageCms.PyCMSError, OSError, ValueError):
            pass
    rgb_profile = profile if profile and profile[16:20] == b"RGB " else None
    return image.convert("RGB"), rgb_profile


def prepare_derivative(source: Path, max_long_edge: int | None) -> tuple[Image.Image, bytes | None]:
    """Decoded image as published: EXIF rotation applied, long edge capped, RGB/RGBA; plus its ICC."""
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
    if max_long_edge:
        image.thumbnail((max_long_edge, max_long_edge), Image.Resampling.LANCZOS)
    return web_image(image)


def save_webp(image: Image.Image, target: Path, quality: int, icc_profile: bytes | None) -> None:
    """Lossy WebP, method 6, no EXIF and no XMP; ICC embedded when given."""
    target.parent.mkdir(parents=True, exist_ok=True)
    save_kwargs: dict[str, Any] = {"format": "WEBP", "quality": quality, "method": 6, "exif": b"", "xmp": b""}
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    image.save(target, **save_kwargs)


def variant_widths_for(width: int) -> list[int]:
    """Variant widths for an image `width` pixels wide: widths at or above it are skipped."""
    return [variant_width for variant_width in VARIANT_WIDTHS if variant_width < width]


def variant_size(width: int, height: int, variant_width: int) -> tuple[int, int]:
    """(variant_width, height * variant_width / width rounded half up)."""
    return variant_width, max(1, (2 * variant_width * height + width) // (2 * width))


def variant_path(stem: str, variant_width: int) -> Path:
    return VARIANT_DIR / f"{stem}-{variant_width}.webp"


def save_variants(
    image: Image.Image, stem: str, icc_profile: bytes | None, target_for: Callable[[Path], Path]
) -> list[Path]:
    """Write the width variants of `image`; returns their final paths. `target_for` maps a final path
    to the path actually written (a staging path)."""
    written: list[Path] = []
    for variant_width in variant_widths_for(image.width):
        final = variant_path(stem, variant_width)
        resized = image.resize(variant_size(image.width, image.height, variant_width), Image.Resampling.LANCZOS)
        save_webp(resized, target_for(final), VARIANT_QUALITY, icc_profile)
        written.append(final)
    return written


def photo_variant_files(stems: set[str]) -> list[Path]:
    """Files in the variant folder named `<stem>-<width>.webp` for a stem in `stems` (lower case)."""
    if not VARIANT_DIR.is_dir():
        return []
    files = []
    for path in VARIANT_DIR.iterdir():
        match = VARIANT_NAME.match(path.name)
        if path.is_file() and match and match["stem"].lower() in stems:
            files.append(path)
    return sorted(files)


def derivative_dimensions(source: Path, max_long_edge: int) -> tuple[int, int, str]:
    """Size the WebP derivative will have (after EXIF rotation and the long-edge limit)."""
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((max_long_edge, max_long_edge), Image.Resampling.LANCZOS)
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
        "condition": "",
        "conditions": [],
        "order": order,
        "note": "",
        "alt": "Photograph by Jiaxin Li.",
    }


def merged_entry(photo: SourcePhoto, manifest: dict[str, dict[str, Any]], order: int) -> dict[str, Any]:
    entry = default_entry(photo, order)
    entry.update(manifest.get(photo.path.name, {}))
    entry["source"] = photo.path.name
    entry["slug"] = photo.slug
    entry["title"] = entry.get("title") or "Untitled"
    entry["category"] = entry.get("category") or DEFAULT_CATEGORY
    entry["camera"] = entry.get("camera", DEFAULT_CAMERA)
    entry["order"] = int(entry.get("order", order))
    return entry


def yaml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return '""'
    return json.dumps(str(value), ensure_ascii=False)


def condition_fields(entry: dict[str, Any]) -> tuple[str, list[str]]:
    condition = str(entry.get("condition", "") or "")
    conditions = entry.get("conditions", [])
    if not isinstance(conditions, list):
        conditions = []
    normalized_conditions = [str(value) for value in conditions if value]

    legacy_weather = str(entry.get("weather", "") or "")
    if not condition and legacy_weather:
        condition, legacy_extra = LEGACY_CONDITIONS.get(legacy_weather, (legacy_weather, []))
        normalized_conditions.extend(legacy_extra)

    deduped_conditions = list(dict.fromkeys(value for value in normalized_conditions if value != condition))
    return condition, deduped_conditions


def frontmatter_fields(entry: dict[str, Any], width: int, height: int, orientation: str) -> list[tuple[str, Any]]:
    """Field values of a photo's Markdown record, in file order (see src/content.config.ts)."""
    slug = entry["slug"]
    condition, conditions = condition_fields(entry)
    return [
        ("title", entry.get("title", "Untitled")),
        ("slug", slug),
        ("category", entry.get("category", DEFAULT_CATEGORY)),
        ("categories", entry.get("categories", [])),
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
        ("condition", condition),
        ("conditions", conditions),
        ("order", entry.get("order", 0)),
        ("note", entry.get("note", "")),
        ("draftMetadata", entry.get("draftMetadata", True)),
        ("language", entry.get("language", DEFAULT_LANGUAGE)),
    ]


def metadata_frontmatter(entry: dict[str, Any], width: int, height: int, orientation: str) -> str:
    fields = frontmatter_fields(entry, width, height, orientation)
    lines = ["---", *(f"{key}: {yaml_value(value)}" for key, value in fields), "---", ""]
    return "\n".join(lines)


def read_frontmatter_values(path: Path) -> dict[str, Any]:
    """Values of an existing record: the importer's JSON-style scalars plus YAML `|` / `|-` blocks."""
    match = re.match(r"---\n(.*?)\n---(?:\n|$)", path.read_text(encoding="utf-8"), re.DOTALL)
    lines = match.group(1).split("\n") if match else []
    values: dict[str, Any] = {}
    index = 0
    while index < len(lines):
        field = re.match(r"([A-Za-z0-9_]+):\s?(.*)$", lines[index])
        index += 1
        if not field:
            continue
        key, raw = field.groups()
        if raw in ("|", "|-"):
            block: list[str] = []
            while index < len(lines) and (lines[index].startswith("  ") or lines[index] == ""):
                block.append(lines[index][2:])
                index += 1
            text = "\n".join(block).rstrip("\n")
            values[key] = text if raw == "|-" else f"{text}\n"
            continue
        try:
            values[key] = json.loads(raw)
        except ValueError:
            values[key] = raw.strip().strip("'\"")
    return values


def edited_values(metadata_path: Path, fields: list[tuple[str, Any]]) -> list[str]:
    """Fields whose value in the existing record differs from what the import would write."""
    if not metadata_path.exists():
        return []
    current = read_frontmatter_values(metadata_path)
    return [
        f"{key}: {current.get(key)!r} -> {value!r}"
        for key, value in fields
        if key not in IMAGE_DERIVED_FIELDS and current.get(key) != value
    ]


def verify_derivative_policy(photo: SourcePhoto, max_long_edge: int, quality: int) -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        target = Path(tmp_dir) / f"{photo.slug}.webp"
        image, icc_profile = prepare_derivative(photo.path, max_long_edge)
        save_webp(image, target, quality, icc_profile)
        with Image.open(target) as target_image:
            if target_image.getexif():
                raise RuntimeError(f"Derivative retained EXIF metadata: {photo.path.name}")
            if target.stat().st_size >= photo.path.stat().st_size:
                print(f"warning: derivative is not smaller than source for {photo.path.name}", file=sys.stderr)
            if target_image.format != "WEBP":
                raise RuntimeError(f"Derivative is not WebP: {photo.path.name}")
            if max(target_image.size) > max_long_edge:
                raise RuntimeError(f"Derivative exceeds max long edge: {photo.path.name}")


def variant_settings() -> dict[str, Any]:
    return {
        "variant_dir": repo_path(VARIANT_DIR),
        "variant_widths": list(VARIANT_WIDTHS),
        "variant_quality": VARIANT_QUALITY,
    }


def load_report(report_path: Path) -> dict[str, Any]:
    if not report_path.exists():
        return {"included": [], "excluded": []}
    return json.loads(report_path.read_text(encoding="utf-8"))


def write_report(report_path: Path | None, report: dict[str, Any]) -> None:
    if report_path is None:
        return
    report_path.parent.mkdir(parents=True, exist_ok=True)
    partial = report_path.with_name(f".{report_path.name}.partial")
    partial.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(partial, report_path)


def report_entry(photo: SourcePhoto, entry: dict[str, Any], width: int, height: int, orientation: str) -> dict[str, Any]:
    return {
        "source": repo_path(photo.path),
        "slug": entry["slug"],
        "category": entry.get("category", DEFAULT_CATEGORY),
        "asset": repo_path(ASSET_DIR / f"{entry['slug']}.webp"),
        "metadata": repo_path(CONTENT_DIR / f"{entry['slug']}.md"),
        "width": width,
        "height": height,
        "orientation": orientation,
    }


def stage_photo(
    photo: SourcePhoto, entry: dict[str, Any], args: argparse.Namespace, staging: StagedFiles
) -> tuple[int, int, str]:
    """Write a photo's WebP, its width variants and its Markdown record into `staging`."""
    slug = entry["slug"]
    image, icc_profile = prepare_derivative(photo.path, args.max_long_edge)
    save_webp(image, staging.path_for(ASSET_DIR / f"{slug}.webp"), args.quality, icc_profile)
    save_variants(image, slug, icc_profile, staging.path_for)
    width, height = image.size
    orientation = orientation_for(width, height)
    staging.path_for(CONTENT_DIR / f"{slug}.md").write_text(
        metadata_frontmatter(entry, width, height, orientation), encoding="utf-8"
    )
    return width, height, orientation


def run_add(args: argparse.Namespace, manifest: dict[str, dict[str, Any]]) -> int:
    """Import single photos; refuses anything that would overwrite or that lacks metadata."""
    problems: list[str] = []
    planned: list[tuple[SourcePhoto, dict[str, Any]]] = []
    for image in args.add:
        path = image.expanduser().resolve()
        entry = manifest.get(path.name)
        if not path.is_file():
            problems.append(f"{path}: file not found")
            continue
        reason = exclusion_reason(path)
        if reason == "not an image candidate":
            problems.append(f"{path}: not an image ({', '.join(sorted(IMAGE_EXTENSIONS))})")
            continue
        if reason:
            problems.append(f"{path.name}: excluded from import ({reason})")
            continue
        if entry is None:
            problems.append(f'{path.name}: no manifest entry with "source": "{path.name}" in {args.manifest}')
            continue
        missing = [key for key in ("slug", "category", "order", "alt") if entry.get(key) in (None, "")]
        if missing:
            problems.append(f"{path.name}: manifest entry must set {', '.join(missing)}")
            continue
        try:
            slug = source_slug(path, manifest)
        except ValueError as error:
            problems.append(str(error))
            continue
        for existing in (CONTENT_DIR / f"{slug}.md", ASSET_DIR / f"{slug}.webp"):
            if existing.exists():
                problems.append(f'{path.name}: slug "{slug}" already exists ({repo_path(existing)}); --add never overwrites')
        if slug in {planned_entry["slug"] for _, planned_entry in planned}:
            problems.append(f'{path.name}: slug "{slug}" is given twice')
        photo = SourcePhoto(path=path, slug=slug)
        planned.append((photo, merged_entry(photo, manifest, int(entry["order"]))))

    if problems:
        print("Nothing imported:", *(f"- {problem}" for problem in problems), sep="\n", file=sys.stderr)
        return 1

    if args.verify_derivative_policy:
        verify_derivative_policy(planned[0][0], args.max_long_edge, args.quality)

    added: list[dict[str, Any]] = []
    if args.dry_run:
        for photo, entry in planned:
            added.append(report_entry(photo, entry, *derivative_dimensions(photo.path, args.max_long_edge)))
    else:
        with StagedFiles() as staging:
            for photo, entry in planned:
                added.append(report_entry(photo, entry, *stage_photo(photo, entry, args, staging)))
            staging.commit()
    for (photo, _), item in zip(planned, added):
        widths = variant_widths_for(item["width"])
        print(
            f"{'would add' if args.dry_run else 'added'}: {item['slug']} ({item['width']}x{item['height']} "
            f"{item['orientation']}, variants {widths or 'none'}) from {photo.path}"
        )

    if args.report and not args.dry_run:
        report = load_report(args.report)
        added_slugs = {entry["slug"] for entry in added}
        report["included"] = [entry for entry in report.get("included", []) if entry.get("slug") not in added_slugs] + added
        report["included_count"] = len(report["included"])
        report.setdefault("settings", {}).update(variant_settings())
        write_report(args.report, report)
        print(f"report: {args.report}")

    print(
        "next: add the slug to photographySelectedWorkSlugs or a project in src/data/photography.ts if wanted, "
        "then run `node scripts/verify_photo_import.mjs` and `npm run build`."
    )
    return 0


def run_batch(args: argparse.Namespace, manifest: dict[str, dict[str, Any]]) -> int:
    source_dir = args.source.expanduser().resolve()
    included, excluded = inventory_source(source_dir, manifest)

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

    entries = [(photo, merged_entry(photo, manifest, index * 10)) for index, photo in enumerate(included, start=1)]
    slugs = {entry["slug"].lower() for _, entry in entries}
    # Compared case-insensitively: on a case-insensitive disk a differently cased name is the same file.
    stale = sorted(
        [path for path in ASSET_DIR.glob("*.webp") if path.stem.lower() not in slugs]
        + [path for path in CONTENT_DIR.glob("*.md") if path.stem.lower() not in slugs]
    )
    stale_stems = {path.stem.lower() for path in stale}

    # Values hand-edited in a Markdown record but not in the manifest would be lost by a rewrite.
    edits: dict[str, list[str]] = {}
    for photo, entry in entries:
        # Sizes are placeholders: image-derived fields are not compared.
        changed = edited_values(CONTENT_DIR / f"{entry['slug']}.md", frontmatter_fields(entry, 0, 0, ""))
        if changed:
            edits[entry["slug"]] = changed

    for slug, changed in edits.items():
        print(f"edited record {slug}: " + "; ".join(changed), file=sys.stderr)

    if not args.dry_run:
        if not args.replace:
            raise RuntimeError("Refusing to write import output without --replace (or use --add for single photos)")
        if edits and not args.overwrite_edits:
            print(
                f"Refusing --replace, nothing written: {len(edits)} Markdown record(s) differ from the manifest "
                "(listed above). Copy those values into the manifest, or pass --overwrite-edits to discard them.",
                file=sys.stderr,
            )
            return 1

    planned: list[dict[str, Any]] = []
    if args.dry_run:
        for photo, entry in entries:
            width, height, orientation = derivative_dimensions(photo.path, args.max_long_edge)
            planned.append(report_entry(photo, entry, width, height, orientation))
            print(
                f"would write: {entry['slug']} ({width}x{height} {orientation}, "
                f"variants {variant_widths_for(width) or 'none'}) from {photo.path.name}"
            )
    else:
        with StagedFiles() as staging:
            for photo, entry in entries:
                planned.append(report_entry(photo, entry, *stage_photo(photo, entry, args, staging)))
            staging.commit()

    # Variants of deleted photos, and variants of kept photos at widths no longer produced.
    expected_variants = {
        variant_path(item["slug"], variant_width).name.lower()
        for item in planned
        for variant_width in variant_widths_for(item["width"])
    }
    stale_variants = [
        path for path in photo_variant_files(stale_stems | slugs) if path.name.lower() not in expected_variants
    ]
    for path, why in [*((path, "not in source") for path in stale), *((path, "stale variant") for path in stale_variants)]:
        print(f"{'would delete' if args.dry_run else 'deleting'} ({why}): {repo_path(path)}")
        if not args.dry_run:
            path.unlink()

    report = {
        "source": repo_path(source_dir),
        "dry_run": bool(args.dry_run),
        "included_count": len(included),
        "excluded_count": len(excluded),
        "included": planned,
        "excluded": excluded,
        "settings": {
            "asset_dir": repo_path(ASSET_DIR),
            "content_dir": repo_path(CONTENT_DIR),
            "max_long_edge": args.max_long_edge,
            "quality": args.quality,
            "format": "WEBP",
            "exif": "not copied",
            "icc": "preserved when available",
            **variant_settings(),
        },
    }
    print(f"included: {len(included)}")
    print(f"excluded: {len(excluded)}")
    if args.report and not args.dry_run:
        write_report(args.report, report)
        print(f"report: {args.report}")
    return 0


def backfill_sources(paths: list[Path]) -> list[Path]:
    """Images whose variants the backfill writes: the given ones (validated), else every works WebP."""
    if not paths:
        return sorted(ASSET_DIR.glob("*.webp"))
    allowed_parents = {PHOTOGRAPHY_DIR.resolve(), ASSET_DIR.resolve()}
    sources: list[Path] = []
    for given in paths:
        path = given.expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"{given}: file not found")
        if path.parent not in allowed_parents:
            raise ValueError(f"{given}: only images in {repo_path(PHOTOGRAPHY_DIR)}/ or {repo_path(ASSET_DIR)}/ get variants")
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            raise ValueError(f"{given}: not an image ({', '.join(sorted(IMAGE_EXTENSIONS))})")
        sources.append(path)
    return sources


def variant_is_current(path: Path, size: tuple[int, int]) -> bool:
    """True when `path` is a readable WebP of exactly `size`."""
    if not path.is_file():
        return False
    try:
        with Image.open(path) as existing:
            return existing.format == "WEBP" and existing.size == size
    except OSError:
        return False


def run_backfill(args: argparse.Namespace) -> int:
    """Write missing or wrongly sized variants from existing images; never rewrites the images."""
    sources = backfill_sources(args.backfill_variants)
    stems: dict[str, Path] = {}
    for source in sources:
        if not SLUG_PATTERN.fullmatch(source.stem):
            raise ValueError(f'{source.name}: file stem must be lowercase letters and digits joined by "-"')
        if source.stem in stems and stems[source.stem] != source:
            raise ValueError(f"{source.name} and {stems[source.stem].name} would write the same variant names")
        stems[source.stem] = source

    written: list[Path] = []
    with nullcontext() if args.dry_run else StagedFiles() as staging:
        for stem, source in stems.items():
            image, icc_profile = prepare_derivative(source, None)
            todo = []
            for variant_width in variant_widths_for(image.width):
                final = variant_path(stem, variant_width)
                size = variant_size(image.width, image.height, variant_width)
                if variant_is_current(final, size):
                    continue
                todo.append((final, size))
            for final, size in todo:
                print(f"{'would write' if args.dry_run else 'writing'}: {repo_path(final)} ({size[0]}x{size[1]})")
                if staging is not None:
                    resized = image.resize(size, Image.Resampling.LANCZOS)
                    save_webp(resized, staging.path_for(final), VARIANT_QUALITY, icc_profile)
                written.append(final)
        if staging is not None:
            staging.commit()
    print(f"{'would write' if args.dry_run else 'wrote'} {len(written)} variant(s) for {len(stems)} image(s)")

    if args.report and not args.dry_run:
        report = load_report(args.report)
        report.setdefault("settings", {}).update(variant_settings())
        write_report(args.report, report)
        print(f"report: {args.report}")
    elif not args.dry_run:
        print("note: without --report, settings.variant_widths in the import report is not updated")
    return 0


def run(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.backfill_variants is not None:
        return run_backfill(args)
    manifest = load_manifest(args.manifest)
    return run_add(args, manifest) if args.add else run_batch(args, manifest)


def main(argv: list[str] | None = None) -> int:
    """CLI entry: expected errors (bad input, unreadable image, I/O) print one line and return 2."""
    try:
        return run(argv)
    except (ValueError, OSError, RuntimeError, Image.DecompressionBombError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
