"""Synthetic tests for attachment scoring; none of these XML files is engine output."""

import json
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from compare_fingerings import MAX_BYTES, MAX_EVENTS, compare
from render_fingering_fixture import ROOT as FIXTURES, original


def note(step, *, octave=4, staff=1, duration=1, mark='', chord=False, voice=None):
    written = f'<notations><technical>{mark}</technical></notations>' if mark else ''
    return (f'<note>{"<chord/>" if chord else ""}<pitch><step>{step}</step><octave>{octave}</octave></pitch>'
            f'<duration>{duration}</duration><voice>{voice or staff}</voice><type>quarter</type>'
            f'<staff>{staff}</staff>{written}</note>')


def digit(number):
    return f'<fingering>{number}</fingering>'


def score(notes, bass='', text='<direction><direction-type><words>3</words></direction-type></direction>'):
    return ('<score-partwise><part id="P1"><measure number="10">'
            '<attributes><divisions>1</divisions><staves>2</staves></attributes>'
            f'{text}{notes}{bass}</measure></part></score-partwise>')


PRIMARY = note('C', mark=digit(1))
CHORD = note('E', chord=True, mark=digit(3))
REPEAT = note('C', mark=digit(2))
UNMARKED = note('G')
BASS = '<backup><duration>3</duration></backup>' + note('C', staff=2, mark=digit(5))
GOLD = score(PRIMARY + CHORD + REPEAT + UNMARKED, BASS)


class FingeringComparison(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.gold = Path(folder.name) / 'gold.musicxml'
        self.actual = Path(folder.name) / 'actual.musicxml'
        self.gold.write_text(GOLD, encoding='utf-8')

    def result(self, actual):
        self.actual.write_text(actual, encoding='utf-8')
        return compare(self.gold, self.actual)

    def test_exact_and_unmarked_controls_ignore_direction_numerals(self):
        result = self.result(GOLD.replace('<words>3</words>', '<words>4</words>'))
        self.assertTrue(result['passes'])
        self.assertTrue(result['events_pass'])
        self.assertEqual(result['fingerings']['counts'], {
            'correct_marks': 4, 'missing_marks': 0, 'incorrect_marks': 0, 'extra_marks': 0,
            'correct_unmarked': 1, 'missing_notes': 0, 'unexpected_notes': 0, 'unassessable_notes': 0,
        })

    def test_rendered_fixture_gold_is_reproducible_without_renderers(self):
        fixture = FIXTURES / 'piano-fingerings.musicxml'
        self.assertEqual(fixture.read_text(encoding='utf-8'), original())
        result = compare(fixture, fixture)
        self.assertTrue(result['passes'])
        self.assertEqual(result['events']['gold_events'], 17)
        self.assertEqual(result['fingerings']['counts']['correct_marks'], 13)
        self.assertEqual(result['fingerings']['counts']['correct_unmarked'], 4)

    def test_actual_captured_failures_and_reviewed_public_hashes_remain_unchanged(self):
        provenance = json.loads((FIXTURES / 'provenance.json').read_text())
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(digest(FIXTURES / 'piano-fingerings.musicxml'), provenance['gold_sha256'])
        self.assertEqual(digest(FIXTURES / 'piano-fingerings.png'), provenance['image_sha256'])
        for capture in provenance['captured']:
            case = capture['case']
            path = FIXTURES / 'audiveris-5.11.0' / f'{case}.public.musicxml'
            self.assertEqual(digest(path), capture['public_export_sha256'])
            for private in ('/tmp/', '/workspace/', '<source>', '<encoding-date>', '<miscellaneous>'):
                self.assertNotIn(private, path.read_text())
            actual = json.loads(json.dumps(compare(FIXTURES / 'piano-fingerings.musicxml', path)))
            saved = json.loads(path.with_name(f'{case}.comparison.json').read_text())
            self.assertEqual(actual, saved)
            self.assertFalse(actual['passes'])
            self.assertEqual(actual['events']['exact_pitch_onset_duration_staff_measure_matches'], 9)
            counts = actual['fingerings']['counts']
            expected = (0, 13, 0, 0) if case == 'default' else (4, 7, 2, 1)
            self.assertEqual(tuple(counts[k] for k in ('correct_marks', 'missing_marks', 'incorrect_marks', 'extra_marks')), expected)
            self.assertEqual((counts['correct_unmarked'], counts['missing_notes'], counts['unexpected_notes']), (2, 7, 7))

    def test_absence_of_all_marks_does_not_pass_via_note_timing(self):
        result = self.result(score(note('C') + note('E', chord=True) + note('C') + UNMARKED,
                                   '<backup><duration>3</duration></backup>' + note('C', staff=2)))
        self.assertTrue(result['events_pass'])
        self.assertFalse(result['passes'])
        self.assertEqual(result['fingerings']['counts']['missing_marks'], 4)

    def test_missing_wrong_and_spurious_marks_are_distinct(self):
        actual = GOLD.replace(digit(1), '').replace(digit(3), digit(4)).replace(UNMARKED, note('G', mark=digit(2)))
        report = self.result(actual)['fingerings']
        self.assertTrue(report['comparable'])
        self.assertFalse(report['passes'])
        for category in ('missing_marks', 'incorrect_marks', 'extra_marks'):
            self.assertEqual(report['counts'][category], 1)
        [wrong] = report['details']['incorrect_marks']
        self.assertEqual((wrong['pitch']['step'], wrong['onset_quarters'], wrong['written_hand'],
                          wrong['expected_mark'], wrong['actual_mark']), ('E', '0', 'right', 3, 4))

    def test_identity_prevents_swaps_across_chord_heads_staves_and_repeated_onsets(self):
        for first, second in ((1, 3), (1, 5), (1, 2)):
            with self.subTest(first=first, second=second):
                swapped = GOLD.replace(digit(first), 'SWAP').replace(digit(second), digit(first)).replace('SWAP', digit(second))
                result = self.result(swapped)
                self.assertTrue(result['events_pass'])
                self.assertEqual(result['fingerings']['counts']['incorrect_marks'], 2)

    def test_chord_head_order_and_arbitrary_voice_ids_are_not_attachment_keys(self):
        actual = score(note('E', mark=digit(3), voice=7) + note('C', mark=digit(1), chord=True, voice=7)
                       + note('C', mark=digit(2), voice=7) + note('G', voice=7), BASS)
        self.assertTrue(self.result(actual)['passes'])

    def test_duration_difference_does_not_preclude_assessing_same_attachment(self):
        result = self.result(GOLD.replace(CHORD, note('E', chord=True, mark=digit(3), duration=2)))
        self.assertFalse(result['events_pass'])
        self.assertTrue(result['fingerings']['passes'])
        self.assertFalse(result['passes'])

    def test_pitch_octave_onset_mismatch_never_earns_attachment_credit(self):
        for wrong_note in (note('D', mark=digit(2)), note('C', octave=5, mark=digit(2)),
                           '<forward><duration>1</duration></forward>' + note('C', mark=digit(2))):
            with self.subTest(wrong_note=wrong_note):
                actual = GOLD.replace(REPEAT, wrong_note)
                if wrong_note.startswith('<forward>'):
                    actual = actual.replace(BASS, BASS.replace('<duration>3</duration>', '<duration>4</duration>'))
                result = self.result(actual)
                counts = result['fingerings']['counts']
                self.assertFalse(result['events_pass'])
                self.assertFalse(result['passes'])
                self.assertEqual(counts['missing_marks'], 1)
                self.assertEqual(counts['extra_marks'], 1)
                self.assertGreaterEqual(counts['missing_notes'], 1)
                self.assertGreaterEqual(counts['unexpected_notes'], 1)

    def test_ambiguous_duplicate_on_same_staff_cannot_match_by_list_order(self):
        result = self.result(GOLD.replace(CHORD, CHORD + note('E', chord=True, mark=digit(3))))
        self.assertFalse(result['passes'])
        report = result['fingerings']
        self.assertFalse(report['comparable'])
        [ambiguous] = report['details']['unassessable_notes']
        self.assertEqual(ambiguous['reason'], 'ambiguous_duplicate_note_key')
        self.assertEqual(ambiguous['expected_notes'], 1)
        self.assertEqual(ambiguous['actual_notes'], 2)

    def test_zero_is_incorrect_or_spurious_and_invalid_for_piano(self):
        result = self.result(GOLD.replace(digit(1), digit(0)).replace(UNMARKED, note('G', mark=digit(0))))
        report = result['fingerings']
        self.assertTrue(report['comparable'])
        self.assertFalse(report['passes'])
        for category in ('incorrect_marks', 'extra_marks'):
            [mark] = report['details'][category]
            self.assertEqual(mark['actual_mark'], 0)
            self.assertTrue(mark['invalid_for_piano'])

    def test_multiple_substitute_alternate_and_invalid_marks_are_unassessable(self):
        for mark in (digit(1) * 2, '<fingering alternate="yes">1</fingering>',
                     '<fingering substitution="yes">1</fingering>', digit('1–3'), digit('9')):
            with self.subTest(mark=mark):
                result = self.result(GOLD.replace(digit(1), mark))
                self.assertTrue(result['events_pass'])
                self.assertFalse(result['passes'])
                self.assertFalse(result['fingerings']['comparable'])
                [issue] = result['fingerings']['details']['unassessable_notes']
                self.assertEqual(issue['reason'], 'unsupported_fingering')
                self.assertEqual(issue['unsupported_output']['mark_count'], 2 if mark == digit(1) * 2 else 1)

    def test_invalid_documents_and_timing_fail_structurally(self):
        for actual in ('<score-partwise>', '<score-timewise/>', GOLD.replace('<divisions>1', '<divisions>0'),
                       '<!DOCTYPE score-partwise [<!ENTITY x "y">]>' + GOLD,
                       GOLD.replace(CHORD, '<backup><duration>2</duration></backup>' + CHORD),
                       GOLD.replace(CHORD, CHORD.replace('<voice>1</voice>', '<voice>2</voice>'))):
            with self.subTest(actual=actual[:100]):
                result = self.result(actual)
                self.assertFalse(result['passes'])
                self.assertFalse(result['fingerings']['comparable'])
                self.assertIn('error', result['fingerings'])

    def test_input_size_and_event_limits(self):
        for actual in (' ' * (MAX_BYTES + 1), score(note('C') * (MAX_EVENTS + 1))):
            result = self.result(actual)
            self.assertFalse(result['passes'])
            self.assertIsNone(result['events'])

    def test_duplicate_scalar_fields_cannot_pass_by_selecting_the_first_value(self):
        for old, new in (
            ('<duration>1</duration>', '<duration>1</duration><duration>0</duration>'),
            ('<divisions>1</divisions>', '<divisions>1</divisions><divisions>0</divisions>'),
            ('<chord/>', '<chord/><chord/>'),
            ('<voice>1</voice>', '<voice>1</voice><voice>2</voice>'),
            ('<staff>1</staff>', '<staff>1</staff><staff>2</staff>'),
            ('<backup><duration>3</duration>', '<backup><duration>3</duration><duration>0</duration>'),
        ):
            with self.subTest(field=old):
                result = self.result(GOLD.replace(old, new, 1))
                self.assertFalse(result['passes'])
                self.assertFalse(result['fingerings']['comparable'])
                self.assertIn('error', result['fingerings'])

    def test_nested_scalar_content_cannot_disagree_with_importer_text_content(self):
        for field, value in [('duration', '1'), ('divisions', '1'), ('staff', '1'), ('voice', '1'),
                             ('step', 'C'), ('octave', '4'), ('type', 'quarter')]:
            with self.subTest(field=field):
                old = f'<{field}>{value}</{field}>'
                new = f'<{field}>{value}<unexpected/>2</{field}>'
                result = self.result(GOLD.replace(old, new, 1))
                self.assertFalse(result['passes'])
                self.assertFalse(result['fingerings']['comparable'])
                self.assertIn('text only', result['fingerings']['error'])

    def test_cli_exit_tracks_joint_gate(self):
        script = Path(__file__).with_name('compare_fingerings.py')
        for actual, code in ((GOLD, 0), (GOLD.replace(digit(1), ''), 1), ('<broken>', 1)):
            self.actual.write_text(actual, encoding='utf-8')
            run = subprocess.run([sys.executable, str(script), str(self.gold), str(self.actual)],
                                 capture_output=True, text=True, check=False)
            self.assertEqual(run.returncode, code, run.stderr)
            self.assertEqual(json.loads(run.stdout)['passes'], not code)


if __name__ == '__main__':
    unittest.main()
