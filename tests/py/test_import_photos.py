"""Tests of scripts/import_photos.py on a temporary library (never the real one).

Run from the site root: python -m unittest discover -s tests/py
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import ExifTags, Image

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "import_photos.py"


def load_importer():
    sys.dont_write_bytecode = True  # keep scripts/ free of __pycache__
    spec = importlib.util.spec_from_file_location("import_photos", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["import_photos"] = module
    spec.loader.exec_module(module)
    return module


importer = load_importer()


def webp_flags(path: Path) -> int:
    """VP8X flags byte (0 for a simple VP8/VP8L file): 0x20 ICC, 0x08 EXIF, 0x04 XMP."""
    data = path.read_bytes()
    return data[20] if data[12:16] == b"VP8X" else 0


class LibraryTestCase(unittest.TestCase):
    """A temporary repository tree with the importer's directories pointed at it."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.photography = self.root / "public/assets/photography"
        self.works = self.photography / "works"
        self.variants = self.photography / "variants"
        self.photos = self.root / "src/content/photos"
        self.source = self.root / "source_photos/average"
        for folder in (self.works, self.variants, self.photos, self.source):
            folder.mkdir(parents=True)
        patcher = mock.patch.multiple(
            importer,
            REPO_ROOT=self.root,
            PHOTOGRAPHY_DIR=self.photography,
            ASSET_DIR=self.works,
            VARIANT_DIR=self.variants,
            CONTENT_DIR=self.photos,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.manifest = self.root / "scripts/manifest.json"
        self.manifest.parent.mkdir()
        self.report = self.root / "docs/report.json"
        self.stderr = ""

    def make_image(self, name: str, size=(1400, 1000), color=(120, 80, 40), folder: Path | None = None, **save) -> Path:
        path = (folder or self.source) / name
        Image.new("RGB", size, color).save(path, **save)
        return path

    @staticmethod
    def entry(source: str, slug: str, order: int = 10, **extra) -> dict:
        return {"source": source, "slug": slug, "category": "street", "order": order, "alt": f"Alt {slug}.", **extra}

    def write_manifest(self, *entries: dict) -> None:
        self.manifest.write_text(json.dumps(list(entries)), encoding="utf-8")

    def cli(self, *argv) -> int:
        stderr = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            code = importer.main([str(arg) for arg in argv])
        self.stderr = stderr.getvalue()
        return code

    def batch(self, *extra) -> int:
        return self.cli("--source", self.source, "--replace", "--manifest", self.manifest, "--report", self.report, *extra)

    def snapshot(self) -> dict[str, str]:
        """Every path under the root, with a content hash for files ("dir" for folders)."""
        return {
            path.relative_to(self.root).as_posix(): (
                hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "dir"
            )
            for path in sorted(self.root.rglob("*"))
        }

    def assert_no_staging_left(self) -> None:
        leftovers = [path.name for path in self.root.iterdir() if path.name.startswith(importer.STAGING_PREFIX)]
        self.assertEqual(leftovers, [])


class SlugTests(LibraryTestCase):
    def test_underscore_prefix_and_dsc_number(self) -> None:
        self.assertEqual(importer.slugify_source(Path("_DSC0152.jpg")), "dsc-0152")

    def test_underscore_and_dash_names_collide(self) -> None:
        (self.source / "DSC_0152.jpg").write_bytes(b"")
        (self.source / "DSC-0152.jpg").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "collision"):
            importer.inventory_source(self.source)

    def test_manifest_slug_must_match_pattern(self) -> None:
        self.make_image("a.jpg")
        for bad_slug in ("../x", "Foo Bar"):
            with self.subTest(slug=bad_slug):
                self.write_manifest(self.entry("a.jpg", bad_slug))
                with self.assertRaisesRegex(ValueError, "slug"):
                    importer.inventory_source(self.source, importer.load_manifest(self.manifest))
                before = self.snapshot()
                self.assertEqual(self.batch(), 2)
                self.assertIn("slug", self.stderr)
                self.assertEqual(self.cli("--add", self.source / "a.jpg", "--manifest", self.manifest), 1)
                self.assertEqual(self.snapshot(), before)

    def test_exclusion_uses_file_name_not_folder(self) -> None:
        folder = self.root / "docs/export"
        folder.mkdir(parents=True)
        self.make_image("keep.jpg", folder=folder)
        self.make_image("contact_sheet_1.jpg", folder=folder)
        included, excluded = importer.inventory_source(folder)
        self.assertEqual([photo.slug for photo in included], ["keep"])
        self.assertEqual(excluded, ["docs/export/contact_sheet_1.jpg [excluded marker]"])

    def test_add_applies_exclusion_rules(self) -> None:
        path = self.make_image("contact_sheet_1.jpg")
        self.write_manifest(self.entry("contact_sheet_1.jpg", "sheet"))
        self.assertEqual(self.cli("--add", path, "--manifest", self.manifest), 1)
        self.assertIn("excluded", self.stderr)
        self.assertFalse((self.works / "sheet.webp").exists())


class AddModeTests(LibraryTestCase):
    def test_refuses_existing_slug_and_keeps_its_files(self) -> None:
        (self.works / "taken.webp").write_bytes(b"old webp")
        (self.photos / "taken.md").write_text("---\nslug: \"taken\"\n---\n", encoding="utf-8")
        (self.variants / "taken-640.webp").write_bytes(b"old variant")
        path = self.make_image("new.jpg")
        self.write_manifest(self.entry("new.jpg", "taken"))
        before = self.snapshot()
        self.assertEqual(self.cli("--add", path, "--manifest", self.manifest, "--report", self.report), 1)
        self.assertIn("already exists", self.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_strips_exif_and_gps(self) -> None:
        exif = Image.Exif()
        exif[ExifTags.Base.Make] = "Nikon"
        gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
        gps[ExifTags.GPS.GPSLatitudeRef] = "N"
        gps[ExifTags.GPS.GPSLatitude] = (47.0, 22.0, 30.0)
        path = self.make_image("gps.jpg", exif=exif)
        with Image.open(path) as source:
            self.assertTrue(source.getexif().get_ifd(ExifTags.IFD.GPSInfo))
        self.write_manifest(self.entry("gps.jpg", "gps"))
        self.assertEqual(self.cli("--add", path, "--manifest", self.manifest), 0)
        for output in (self.works / "gps.webp", self.variants / "gps-640.webp", self.variants / "gps-1200.webp"):
            with self.subTest(output=output.name), Image.open(output) as image:
                self.assertEqual(len(image.getexif()), 0)
                self.assertNotIn("exif", image.info)
                self.assertNotIn("xmp", image.info)
                self.assertEqual(webp_flags(output) & 0x0C, 0)

    def test_writes_variants_report_paths_and_draft_flag(self) -> None:
        wide = self.make_image("wide.jpg", size=(2000, 1500))
        narrow = self.make_image("narrow.jpg", size=(1000, 800))
        self.write_manifest(self.entry("wide.jpg", "wide", draftMetadata=False), self.entry("narrow.jpg", "narrow", 20))
        self.assertEqual(self.cli("--add", wide, narrow, "--manifest", self.manifest, "--report", self.report), 0)
        sizes = {}
        for path in sorted(self.variants.iterdir()):
            with Image.open(path) as image:
                sizes[path.name] = (image.format, image.size)
        self.assertEqual(
            sizes,
            {
                "narrow-640.webp": ("WEBP", (640, 512)),
                "wide-1200.webp": ("WEBP", (1200, 900)),
                "wide-640.webp": ("WEBP", (640, 480)),
            },
        )
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["settings"]["variant_widths"], [640, 1200])
        self.assertEqual(report["settings"]["variant_dir"], "public/assets/photography/variants")
        wide_entry = next(item for item in report["included"] if item["slug"] == "wide")
        self.assertEqual(wide_entry["source"], "source_photos/average/wide.jpg")
        self.assertEqual(wide_entry["asset"], "public/assets/photography/works/wide.webp")
        self.assertEqual(wide_entry["metadata"], "src/content/photos/wide.md")
        self.assertIn("draftMetadata: false", (self.photos / "wide.md").read_text(encoding="utf-8"))
        self.assertIn("draftMetadata: true", (self.photos / "narrow.md").read_text(encoding="utf-8"))
        self.assert_no_staging_left()

    def test_source_outside_repo_is_reported_by_name(self) -> None:
        with tempfile.TemporaryDirectory() as outside:
            path = self.make_image("far.jpg", folder=Path(outside))
            self.write_manifest(self.entry("far.jpg", "far"))
            self.assertEqual(self.cli("--add", path, "--manifest", self.manifest, "--report", self.report), 0)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["included"][0]["source"], "far.jpg")

    def test_cmyk_profile_is_not_carried(self) -> None:
        fake_cmyk_profile = bytes(16) + b"CMYK" + bytes(108)
        path = self.source / "cmyk.jpg"
        Image.new("CMYK", (800, 600), (0, 128, 255, 0)).save(path, icc_profile=fake_cmyk_profile)
        self.write_manifest(self.entry("cmyk.jpg", "cmyk"))
        self.assertEqual(self.cli("--add", path, "--manifest", self.manifest), 0)
        with Image.open(self.works / "cmyk.webp") as image:
            self.assertEqual(image.mode, "RGB")
            self.assertIsNone(image.info.get("icc_profile"))

    def test_variant_height_rounds_half_up(self) -> None:
        self.assertEqual(importer.variant_size(2400, 1937, 1200), (1200, 969))
        self.assertEqual(importer.variant_widths_for(1156), [640])
        self.assertEqual(importer.variant_widths_for(640), [])


class DryRunTests(LibraryTestCase):
    def test_dry_run_writes_nothing(self) -> None:
        self.make_image("a.jpg")
        self.write_manifest(self.entry("a.jpg", "a"))
        self.assertEqual(self.batch(), 0)
        (self.variants / "a-640.webp").unlink()
        self.make_image("b.jpg")
        self.write_manifest(self.entry("a.jpg", "a"), self.entry("b.jpg", "b", 20))
        before = self.snapshot()
        runs = {
            "batch": ("--source", self.source, "--replace", "--manifest", self.manifest, "--report", self.report),
            "add": ("--add", self.source / "b.jpg", "--manifest", self.manifest, "--report", self.report),
            "backfill": ("--backfill-variants", "--report", self.report),
        }
        for mode, argv in runs.items():
            with self.subTest(mode=mode):
                self.assertEqual(self.cli(*argv, "--dry-run"), 0)
                self.assertEqual(self.snapshot(), before)


class BatchModeTests(LibraryTestCase):
    def test_failure_on_photo_two_of_three_keeps_old_library(self) -> None:
        for index, name in enumerate(("p1.jpg", "p2.jpg", "p3.jpg"), start=1):
            self.make_image(name, color=(40 * index, 30, 20))
        entries = [self.entry(f"p{index}.jpg", f"p{index}", index * 10) for index in (1, 2, 3)]
        self.write_manifest(*entries)
        self.assertEqual(self.batch(), 0)
        before = self.snapshot()

        self.make_image("p1.jpg", color=(250, 250, 250))  # would rewrite p1
        (self.source / "p2.jpg").write_bytes(b"not an image")  # fails while writing photo 2
        (self.source / "p3.jpg").unlink()  # p3 would be deleted
        self.make_image("p4.jpg")  # p4 would be added
        self.write_manifest(entries[0], entries[1], self.entry("p4.jpg", "p4", 40))
        self.assertEqual(self.batch(), 2)
        self.assertIn("error:", self.stderr)
        library = ("public/", "src/", "docs/")  # the inputs (source folder, manifest) changed on purpose
        self.assertEqual(
            {key: value for key, value in self.snapshot().items() if key.startswith(library)},
            {key: value for key, value in before.items() if key.startswith(library)},
        )
        self.assert_no_staging_left()

    def test_replace_deletes_removed_photo_with_its_variants(self) -> None:
        self.make_image("p1.jpg")
        self.make_image("p2.jpg", size=(1300, 900))
        self.write_manifest(self.entry("p1.jpg", "p1"), self.entry("p2.jpg", "p2", 20))
        self.assertEqual(self.batch(), 0)
        self.assertTrue((self.variants / "p2-1200.webp").exists())
        hero = self.make_image("hero.jpg", folder=self.photography)
        self.assertEqual(self.cli("--backfill-variants", hero), 0)

        (self.source / "p2.jpg").unlink()
        self.write_manifest(self.entry("p1.jpg", "p1"))
        self.assertEqual(self.batch(), 0)
        self.assertEqual(sorted(path.name for path in self.works.iterdir()), ["p1.webp"])
        self.assertEqual(sorted(path.name for path in self.photos.iterdir()), ["p1.md"])
        self.assertEqual(
            sorted(path.name for path in self.variants.iterdir()),
            ["hero-1200.webp", "hero-640.webp", "p1-1200.webp", "p1-640.webp"],
        )
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["source"], "source_photos/average")
        self.assertEqual(report["included_count"], 1)

    def test_replace_refuses_hand_edit(self) -> None:
        self.make_image("p1.jpg")
        self.write_manifest(self.entry("p1.jpg", "p1"))
        self.assertEqual(self.batch(), 0)
        record = self.photos / "p1.md"
        record.write_text(record.read_text(encoding="utf-8").replace('"Alt p1."', '"Edited."'), encoding="utf-8")
        before = self.snapshot()
        self.assertEqual(self.batch(), 1)
        self.assertEqual(self.snapshot(), before)


class BackfillTests(LibraryTestCase):
    def test_backfill_writes_missing_variants_only(self) -> None:
        Image.new("RGB", (1000, 700), (10, 20, 30)).save(self.works / "a.webp", quality=88)
        hero = self.make_image("hero.jpg", size=(1300, 800), folder=self.photography)
        self.report.parent.mkdir()
        self.report.write_text(json.dumps({"included": [{"slug": "a"}], "included_count": 1, "settings": {"quality": 88}}))
        originals = {path.name: path.read_bytes() for path in (self.works / "a.webp", hero)}

        self.assertEqual(self.cli("--backfill-variants", "--report", self.report), 0)
        self.assertEqual(sorted(path.name for path in self.variants.iterdir()), ["a-640.webp"])
        self.assertEqual(self.cli("--backfill-variants", hero, "--report", self.report), 0)
        sizes = {}
        for path in sorted(self.variants.iterdir()):
            with Image.open(path) as image:
                sizes[path.name] = image.size
        self.assertEqual(sizes, {"a-640.webp": (640, 448), "hero-1200.webp": (1200, 738), "hero-640.webp": (640, 394)})
        self.assertEqual(originals, {path.name: path.read_bytes() for path in (self.works / "a.webp", hero)})

        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["included"], [{"slug": "a"}])
        self.assertEqual(report["settings"]["quality"], 88)
        self.assertEqual(report["settings"]["variant_widths"], [640, 1200])
        self.assertEqual(report["settings"]["variant_quality"], 82)

        before = self.snapshot()
        self.assertEqual(self.cli("--backfill-variants"), 0)
        self.assertEqual(self.snapshot(), before)
        self.assert_no_staging_left()

    def test_backfill_rejects_images_outside_photography(self) -> None:
        stray = self.make_image("stray.jpg")
        self.assertEqual(self.cli("--backfill-variants", stray), 2)
        self.assertEqual(list(self.variants.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
