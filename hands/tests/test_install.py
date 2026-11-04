import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hands_install", ROOT / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def test_build_copy_check_link_and_explicit_update_preserve_layout_keys_and_other_mods(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder) / "app"
            (app / "layouts").mkdir(parents=True)
            (app / "layouts/personal.json").write_text('{"personal":true}')
            (app / "keys.json").write_text('{"global":{"cmd-p":"custom"}}')
            other = app / "mods/independent/main.js"
            other.parent.mkdir(parents=True)
            other.write_text("// personal")
            link_dir = Path(folder) / "bin"
            calls = []

            def run(args, **kwargs):
                calls.append(args)
                if args[0] == "go":
                    Path(args[3]).write_text("built helper")

            with patch.object(installer.shutil, "which", return_value="available"), patch.object(installer.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()) as out:
                installer.install(app, link_dir=link_dir)
                target = app / "mods/hands"
                self.assertEqual((target / "bin/hands").read_text(), "built helper")
                self.assertTrue((target / "main.js").exists())
                self.assertEqual(calls[-1][0:2], ["herdr-app", "check"])
                self.assertEqual((link_dir / "hands").resolve(), (target / "bin/hands").resolve())
                with self.assertRaises(RuntimeError):
                    installer.install(app, link_dir=link_dir)
                installer.install(app, update=True, link_dir=link_dir)
            self.assertRegex(out.getvalue(), r"Installed .* \d+\.\d+\.\d+ \(was \d+\.\d+\.\d+\)")
            self.assertEqual((app / "layouts/personal.json").read_text(), '{"personal":true}')
            self.assertEqual(json.loads((app / "keys.json").read_text())["global"]["cmd-p"], "custom")
            self.assertEqual(other.read_text(), "// personal")

    def test_a_real_file_at_the_link_path_is_left_alone(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder) / "app"
            link_dir = Path(folder) / "bin"
            link_dir.mkdir()
            (link_dir / "hands").write_text("someone else's hands")

            def run(args, **kwargs):
                if args[0] == "go":
                    Path(args[3]).write_text("built helper")

            with patch.object(installer.shutil, "which", return_value="available"), patch.object(installer.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()) as out:
                installer.install(app, link_dir=link_dir)
            self.assertEqual((link_dir / "hands").read_text(), "someone else's hands")
            self.assertIn("Not linking", out.getvalue())

    def test_update_keeps_edited_settings_and_reports_stale_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder) / "app"
            target = app / "mods/hands"
            target.mkdir(parents=True)
            shipped = json.loads((ROOT / "mods/hands/mod.json").read_text())
            first = next(iter(shipped.get("settings", {"x": 1})))
            edited = dict(shipped, version="0.0.1", settings={first: "edited", "gone": True})
            (target / "mod.json").write_text(json.dumps(edited))

            def run(args, **kwargs):
                if args[0] == "go":
                    Path(args[3]).write_text("built helper")

            with patch.object(installer.shutil, "which", return_value="available"), patch.object(installer.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()) as out:
                installer.install(app, update=True, link_dir=Path(folder) / 'bin')
            manifest = json.loads((target / "mod.json").read_text())
            self.assertEqual(manifest["version"], shipped["version"])
            self.assertEqual(manifest["settings"][first], "edited")
            self.assertNotIn("gone", manifest["settings"])
            self.assertIn("dropped: gone", out.getvalue())

    def test_unrelated_names_and_symlinks_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            target = app / "mods/hands"
            target.mkdir(parents=True)
            (target / "mod.json").write_text('{"title":"Personal"}')
            with self.assertRaises(RuntimeError):
                installer.install(app, update=True)
            (target / "mod.json").unlink()
            target.rmdir()
            target.symlink_to(app, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                installer.install(app, update=True)

    def test_missing_build_tools_fail_before_copying(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(installer.shutil, "which", return_value=None):
            with self.assertRaises(RuntimeError):
                installer.install(folder)
            self.assertFalse((Path(folder) / "mods/hands").exists())


if __name__ == "__main__":
    unittest.main()
