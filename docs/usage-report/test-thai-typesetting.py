"""Regression checks for the manual's dictionary-based line wrapping."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('thai_typesetting', ROOT / 'prepare-thai-typesetting.py')
thai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(thai)


class ThaiWrappingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.segment = staticmethod(thai.word_breaker(thai.load_breaker()))

    def test_reported_words_remain_whole(self):
        for word in ['อัตโนมัติ', 'ปรากฏ', 'ข้อมูล', 'อาจารย์', 'สังเคราะห์']:
            with self.subTest(word=word):
                self.assertEqual(self.segment(word), word)

    def test_reported_sentences_break_between_words(self):
        for source, words in [
            ('จัดอัตโนมัติ', ['จัด', 'อัตโนมัติ']),
            ('ไม่จำเป็นต้องปรากฏครบทุกป้าย', ['ไม่', 'จำเป็น', 'ต้อง', 'ปรากฏ', 'ครบ', 'ทุก', 'ป้าย']),
        ]:
            self.assertEqual(self.segment(source), thai.BREAK.join(words))

    def test_manuscript_text_is_preserved(self):
        paths = [ROOT.parent / 'usage-report.tex', ROOT / 'style.tex', *sorted((ROOT / 'chapters').glob('*.tex'))]
        for path in paths:
            with self.subTest(path=path.name):
                source = path.read_text()
                self.assertEqual(self.segment(source).replace(thai.BREAK, ''), source.replace(thai.BREAK, ''))

    def test_character_breaking_stays_disabled(self):
        for path in [ROOT / 'style.tex', ROOT.parent / 'report.tex']:
            with self.subTest(path=path.name):
                style = path.read_text()
                self.assertIn(r'\directlua{Babel.sea_enabled = false}', style)
                self.assertIn(r'\hyphenpenalty=10000', style)
                self.assertIn(r'\justifying', style)
                breaks = next(line for line in style.splitlines() if line.startswith(r'\newcommand{\codebreaks}'))
                self.assertNotRegex(breaks, r'\\do\\[a-zA-Z0-9]')


if __name__ == '__main__':
    unittest.main()
