import pathlib
import runpy
import tempfile
import unittest

resolve_public = runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1] / 'tools' / 'serve.py'))['resolve_public']


class PreviewPaths(unittest.TestCase):
    def test_only_public_files_are_served(self):
        with tempfile.TemporaryDirectory() as temp:
            outside = pathlib.Path(temp).resolve()
            root = outside / 'game'
            for rel in ['index.html', 'assets/icon.svg', 'js/main.js', 'i18n/es.json', '.private/note.txt',
                        '.git/config', 'worker/isa-game.js', 'assets/.hidden.txt']:
                path = root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('dummy fixture')
            (outside / 'outside.txt').write_text('dummy fixture')
            (root / 'assets' / 'external.txt').symlink_to(outside / 'outside.txt')
            (root / 'assets' / 'private.txt').symlink_to(root / '.private' / 'note.txt')
            self.assertEqual(resolve_public(root, root), root / 'index.html')
            for rel in ['index.html', 'assets/icon.svg', 'js/main.js', 'i18n/es.json']:
                self.assertEqual(resolve_public(root, root / rel), root / rel)
            for rel in ['assets', '.private/note.txt', '.git/config', 'worker/isa-game.js', 'assets/.hidden.txt',
                        'assets/external.txt', 'assets/private.txt', 'js/missing.js']:
                with self.subTest(rel=rel):
                    self.assertIsNone(resolve_public(root, root / rel))
