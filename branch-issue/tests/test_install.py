import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("linear_issue_install", ROOT / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def test_build_copy_check_and_explicit_update_preserve_layout_keys_and_other_mods(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            (app / "layouts").mkdir()
            (app / "layouts/personal.json").write_text('{"personal":true}')
            (app / "keys.json").write_text('{"global":{"cmd-p":"custom"}}')
            other = app / "mods/independent/main.js"
            other.parent.mkdir(parents=True)
            other.write_text("// personal")
            calls = []

            def run(args, **kwargs):
                calls.append(args)
                if args[0] == "go":
                    Path(args[3]).write_text("built helper")

            with patch.object(installer.shutil, "which", return_value="available"), patch.object(installer.subprocess, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()):
                installer.install(app)
                target = app / "mods/branch-issue"
                self.assertEqual((target / "bin/herdr-linear").read_text(), "built helper")
                self.assertTrue((target / "main.js").exists())
                self.assertEqual(calls[-1][0:2], ["herdr-app", "check"])
                with self.assertRaises(RuntimeError):
                    installer.install(app)
                installer.install(app, update=True)
            self.assertEqual((app / "layouts/personal.json").read_text(), '{"personal":true}')
            self.assertEqual(json.loads((app / "keys.json").read_text())["global"]["cmd-p"], "custom")
            self.assertEqual(other.read_text(), "// personal")

    def test_unrelated_names_and_symlinks_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            target = app / "mods/branch-issue"
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
            self.assertFalse((Path(folder) / "mods/branch-issue").exists())


if __name__ == "__main__":
    unittest.main()
