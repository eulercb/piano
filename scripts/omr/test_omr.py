"""Adapter safeguards only. Fake engines below are NOT recognition evidence."""
import os
import json
import hashlib
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import sys
import signal
import unittest
from unittest.mock import patch
import zipfile
import xml.etree.ElementTree as ET

from recognize import check_png, read_export, run, publish, java_path_option
from compare import compare
from evaluate_matrix import CASES, accepted, evaluate, sha256
from render_matrix import originals

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'fixtures/omr/piano-quarter-notes.png'


class Boundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def engine(self, body):
        path = self.root / 'test-engine'
        path.write_text('#!/usr/bin/env python3\n' + body)
        path.chmod(0o700)
        return path

    def test_input_checks(self):
        check_png(FIXTURE)
        bad = self.root / 'bad.png'
        bad.write_bytes(b'not a png')
        with self.assertRaises(ValueError):
            check_png(bad)
        bad.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\0\0\0\rIHDR' + struct.pack('>II', 10000, 10000))
        with self.assertRaises(ValueError):
            check_png(bad)
        bad.unlink()
        bad.symlink_to(FIXTURE)
        with self.assertRaises(ValueError):
            check_png(bad)

    def test_no_overwrite(self):
        target = self.root / 'existing.musicxml'
        target.write_text('keep')
        with self.assertRaises(ValueError):
            run('/usr/bin/true', FIXTURE, target)
        self.assertEqual(target.read_text(), 'keep')

    def test_failed_engine_and_no_export(self):
        target = self.root / 'new.musicxml'
        with self.assertRaises(RuntimeError):
            run('/usr/bin/false', FIXTURE, target)
        with self.assertRaises(ValueError):
            run('/usr/bin/true', FIXTURE, target)
        self.assertFalse(target.exists())

    def test_raw_failure_log_retained_and_exclusive(self):
        engine = self.engine('import sys\nsys.stdout.buffer.write(b"WARN original warning\\n")\nsys.stderr.buffer.write(b"ERROR raw failure\\xff\\n")\nsys.exit(7)\n')
        target, log = self.root / 'new.musicxml', self.root / 'engine.log'
        with self.assertRaisesRegex(RuntimeError, 'exit 7'):
            run(engine, FIXTURE, target, log_destination=log)
        self.assertEqual(set(log.read_bytes().splitlines()), {b'WARN original warning', b'ERROR raw failure\xff'})
        self.assertEqual(log.stat().st_mode & 0o077, 0)
        self.assertFalse(target.exists())
        with self.assertRaises(FileExistsError):
            run(engine, FIXTURE, target, log_destination=log)
        link = self.root / 'link.log'
        link.symlink_to(log)
        with self.assertRaises(FileExistsError):
            run(engine, FIXTURE, target, log_destination=link)

    def test_java_path_options_reject_double_quotes_before_launch(self):
        with self.assertRaisesRegex(ValueError, 'double quotes'):
            java_path_option('java.io.tmpdir', Path('/tmp/"ambiguous'))
        temporary_parent = self.root / 'temp"parent'
        temporary_parent.mkdir()
        with patch('tempfile.tempdir', str(temporary_parent)), patch('recognize.subprocess.Popen') as launch:
            with self.assertRaisesRegex(ValueError, 'double quotes'):
                run('/usr/bin/true', FIXTURE, self.root / 'no.musicxml')
        launch.assert_not_called()
        self.assertEqual(list(temporary_parent.iterdir()), [])

    def test_job_local_temporary_state_cleaned_on_success_and_failure(self):
        # A cooperative native engine uses tempfile; Java is configured separately.
        # This fake executable does not establish Audiveris or sandbox acceptance.
        gold = ROOT / 'fixtures/omr/piano-quarter-notes.musicxml'
        temporary_parent = self.root / "temp parent with spaces and apostrophe's"
        temporary_parent.mkdir()
        for succeeds in (True, False):
            with self.subTest(succeeds=succeeds):
                marker = self.root / 'temporary-state.json'
                engine = self.engine(
                    'import json, os, pathlib, sys, tempfile, zipfile\n'
                    'temporary = pathlib.Path(tempfile.mkdtemp())\n'
                    '(temporary / "score-intermediate").write_text("synthetic score")\n'
                    'state = {key: os.environ.get(key) for key in '
                    '("TMPDIR", "TMP", "TEMP", "JAVA_TOOL_OPTIONS", "HOME", "OMR_TEST_SECRET")}\n'
                    'state.update(temporary=str(temporary), work=os.getcwd())\n'
                    f'pathlib.Path({str(marker)!r}).write_text(json.dumps(state))\n'
                    + ('' if succeeds else 'sys.exit(7)\n') +
                    'output = pathlib.Path(sys.argv[sys.argv.index("-output") + 1])\n'
                    'with zipfile.ZipFile(output / "score.mxl", "w") as z:\n'
                    f'    z.writestr("score.xml", pathlib.Path({str(gold)!r}).read_bytes())\n')
                target = self.root / f'{succeeds}.musicxml'
                with patch('tempfile.tempdir', str(temporary_parent)), patch.dict(os.environ, {'TMPDIR': str(self.root), 'TMP': str(self.root),
                                             'TEMP': str(self.root), 'OMR_TEST_SECRET': 'not inherited'}):
                    if succeeds:
                        run(engine, FIXTURE, target)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'exit 7'):
                            run(engine, FIXTURE, target)
                state = json.loads(marker.read_text())
                expected = str(Path(state['work']) / 'tmp')
                for key in ('TMPDIR', 'TMP', 'TEMP'):
                    self.assertEqual(state[key], expected)
                self.assertEqual(Path(state['temporary']).parent, Path(expected))
                self.assertIn(f'"-Djava.io.tmpdir={expected}"', state['JAVA_TOOL_OPTIONS'])
                self.assertIn(f'"-Duser.home={state["HOME"]}"', state['JAVA_TOOL_OPTIONS'])
                self.assertIsNone(state['OMR_TEST_SECRET'])
                self.assertFalse(Path(state['work']).exists())
                self.assertFalse(Path(state['temporary']).exists())
                self.assertEqual(target.exists(), succeeds)

    def test_timeout_log_retained(self):
        engine = self.engine('import tempfile,time\nprint("WARN before timeout", flush=True)\nprint(tempfile.mkdtemp(), flush=True)\ntime.sleep(20)\n')
        target, log = self.root / 'new.musicxml', self.root / 'engine.log'
        with self.assertRaises(subprocess.TimeoutExpired):
            run(engine, FIXTURE, target, 1, log)
        lines = log.read_text().splitlines()
        self.assertEqual(lines[0], 'WARN before timeout')
        self.assertEqual(Path(lines[1]).parent.name, 'tmp')
        self.assertFalse(Path(lines[1]).exists())
        self.assertFalse(Path(lines[1]).parent.parent.exists())
        self.assertFalse(target.exists())

    def test_matrix_keeps_failures_without_substituting_gold(self):
        folder = self.root / 'matrix'
        result = evaluate('/usr/bin/false', folder, CASES[:2], 1)
        self.assertEqual(len(result['cases']), 2)
        for case in result['cases']:
            self.assertEqual(case['adapter_exit'], 1)
            self.assertFalse(case['output_created'])
            self.assertFalse(case['accepted'])
            self.assertNotIn('comparison', case)
            self.assertTrue((folder / case['id'] / 'engine.log').exists())
        with self.assertRaises(FileExistsError):
            evaluate('/usr/bin/false', folder, CASES[:1], 1)
        for cases, timeout in [(CASES * 2, 1), ([], 1), (CASES, 181)]:
            with self.assertRaises(ValueError):
                evaluate('/usr/bin/false', self.root / 'unused', cases, timeout)

    def test_timeout(self):
        engine = self.engine('import time\ntime.sleep(20)\n')
        target = self.root / 'new.musicxml'
        with self.assertRaises(subprocess.TimeoutExpired):
            run(engine, FIXTURE, target, 1)
        self.assertFalse(target.exists())

    def test_sigterm_kills_job(self):
        pidfile = self.root / 'pid'
        temporary_marker = self.root / 'temporary-path'
        engine = self.engine(f'import os,tempfile,time\nopen({str(temporary_marker)!r}, "w").write(tempfile.mkdtemp())\nopen({str(pidfile)!r}, "w").write(str(os.getpid()))\ntime.sleep(20)\n')
        target = self.root / 'new.musicxml'
        process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/omr/recognize.py'), '--audiveris', str(engine), '--input', str(FIXTURE), '--output', str(target)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if pidfile.exists():
                    break
                time.sleep(0.02)
            self.assertTrue(pidfile.exists())
            pid = int(pidfile.read_text())
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=5)
            self.assertEqual(process.returncode, 130)
            temporary = Path(temporary_marker.read_text())
            self.assertEqual(temporary.parent.name, 'tmp')
            self.assertFalse(temporary.exists())
            self.assertFalse(temporary.parent.parent.exists())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            self.assertFalse(target.exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_atomic_publication(self):
        target = self.root / 'new.musicxml'
        with patch('recognize.os.fsync', side_effect=OSError('simulated disk failure')):
            with self.assertRaises(OSError):
                publish(b'complete', target)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob('.piano-omr-*')), [])
        with patch('recognize.os.fsync', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                publish(b'complete', target)
        self.assertFalse(target.exists())
        publish(b'complete', target)
        with self.assertRaises(FileExistsError):
            publish(b'replacement', target)
        self.assertEqual(target.read_bytes(), b'complete')
        self.assertEqual(list(self.root.glob('.piano-omr-*')), [])

    def test_output_validation(self):
        archive = self.root / 'out.mxl'
        for data in ['<!DOCTYPE x [<!ENTITY foo "bar">]><score-partwise/>'.encode('utf-16-le'), b'<wrong/>', b'<!DOCTYPE x [<!ENTITY foo "bar">]><score-partwise/>']:
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('score.xml', data)
            with self.assertRaises(ValueError):
                read_export(archive)
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('../score.xml', b'<score-partwise><part><measure><attributes><divisions>1</divisions></attributes><note><duration>1</duration></note></measure></part></score-partwise>')
        self.assertIn(b'score-partwise', read_export(archive))
        self.assertFalse((self.root.parent / 'score.xml').exists())

    def test_invalid_engine_timing_rejected_without_correction(self):
        # Derived public copy of an actual failure: source metadata removed, divisions=0 retained.
        captured = ROOT / 'fixtures/omr/matrix/audiveris-5.11.0/chords-ties/recognized.public.musicxml'
        archive = self.root / 'invalid.mxl'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('score.xml', captured.read_bytes())
        with self.assertRaisesRegex(ValueError, 'divisions in part 1, measure 1'):
            read_export(archive)
        result = compare(ROOT / 'fixtures/omr/matrix/chords-ties.musicxml', captured)
        self.assertFalse(result['comparable'])
        self.assertIn('divisions in part 1, measure 1', result['error'])
        self.assertNotIn('precision', result)
        self.assertFalse(accepted(result))

    def test_invalid_captured_timing_is_not_published(self):
        # Fake transport of the derived public failure tests the adapter boundary,
        # not a second recognition attempt or an accuracy measurement.
        captured = ROOT / 'fixtures/omr/matrix/audiveris-5.11.0/chords-ties/recognized.public.musicxml'
        engine = self.engine('import sys, pathlib, zipfile\n'
                             'output = pathlib.Path(sys.argv[sys.argv.index("-output") + 1])\n'
                             'with zipfile.ZipFile(output / "bad.mxl", "w") as z:\n'
                             f'    z.writestr("score.xml", pathlib.Path({str(captured)!r}).read_bytes())\n'
                             'print("WARN synthetic test transport of captured invalid output")\n')
        output, log = self.root / 'no.musicxml', self.root / 'raw.log'
        with self.assertRaisesRegex(ValueError, 'divisions in part 1, measure 1'):
            run(engine, FIXTURE, output, log_destination=log)
        self.assertFalse(output.exists())
        self.assertIn('WARN synthetic test', log.read_text())

    def test_timing_validation(self):
        archive = self.root / 'invalid.mxl'
        for divisions, duration in [('0', '1'), ('-1', '1'), ('NaN', '1'), ('1e-999999', '1'), ('1', '0'), ('1', '')]:
            with self.subTest(divisions=divisions, duration=duration):
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr('score.xml', f'<score-partwise><part><measure><attributes><divisions>{divisions}</divisions></attributes><note><duration>{duration}</duration></note></measure></part></score-partwise>')
                with self.assertRaises(ValueError):
                    read_export(archive)

    def test_positive_decimal_divisions_are_supported(self):
        gold = ROOT / 'fixtures/omr/piano-quarter-notes.musicxml'
        changed = self.root / 'decimal.xml'
        changed.write_text(gold.read_text().replace('<divisions>1</divisions>', '<divisions>0.5</divisions>')
                           .replace('<duration>1</duration>', '<duration>0.5</duration>')
                           .replace('<duration>4</duration>', '<duration>2</duration>'))
        self.assertTrue(accepted(compare(gold, changed)))

    def test_voice_split_detected(self):
        gold = ROOT / 'fixtures/omr/piano-quarter-notes.musicxml'
        changed = self.root / 'changed.xml'
        changed.write_text(gold.read_text().replace('<voice>1</voice>', '<voice>3</voice>', 1))
        result = compare(gold, changed)
        self.assertEqual(result['precision'], 1)
        self.assertFalse(result['voice_partition_matches'])

    def test_comparison_detects_wrong_notes(self):
        gold = ROOT / 'fixtures/omr/piano-quarter-notes.musicxml'
        changed = self.root / 'changed.xml'
        changed.write_text(gold.read_text().replace('<step>C</step>', '<step>B</step>', 1))
        result = compare(gold, changed)
        self.assertEqual(result['exact_pitch_onset_duration_staff_measure_matches'], 15)

    def test_empty_or_unsupported_xml_cannot_pass_exact_gate(self):
        changed = self.root / 'unsupported.xml'
        for xml in ['<wrong/>', '<score-partwise/>', '<score-partwise><part><measure/></part></score-partwise>',
                    '<score-partwise xmlns="urn:musicxml"><part><measure><note/></measure></part></score-partwise>',
                    '<score-partwise><part xmlns="urn:musicxml"><measure><note/></measure></part></score-partwise>']:
            with self.subTest(xml=xml):
                changed.write_text(xml)
                result = compare(changed, changed)
                self.assertFalse(result['comparable'])
                self.assertFalse(accepted(result))
                self.assertNotIn('precision', result)
        self.assertFalse(accepted({'comparable': True, 'gold_events': 0,
                                   'recognized_events': 0, 'exact_pitch_onset_duration_staff_measure_matches': 0,
                                   'voice_partition_matches': True, 'written_type_dot_tie_matches': True}))

    def test_missing_unsupported_or_mixed_note_categories_cannot_pass(self):
        gold = ROOT / 'fixtures/omr/matrix/rhythm-accidentals.musicxml'
        changed = self.root / 'invalid-category.xml'
        pitch = '<pitch><step>C</step><octave>4</octave></pitch>'
        replacements = [
            ('<rest/>', ''), ('<rest/>', '<unpitched/>'),
            ('<rest/>', '<rest/><rest/>'), ('<rest/>', '<rest/><unpitched/>'),
            ('<rest/>', '<rest/>' + pitch), (pitch, pitch + '<rest/>'),
            (pitch, pitch + pitch), (pitch, '<pitch/>'),
            (pitch, '<pitch><step>H</step><octave>4</octave></pitch>'),
            (pitch, '<pitch><step>C</step><octave>NaN</octave></pitch>'),
            (pitch, '<pitch><step>C</step><alter>0.5</alter><octave>4</octave></pitch>'),
            (pitch, '<pitch><step>C</step><step>D</step><octave>4</octave></pitch>'),
        ]
        for old, new in replacements:
            with self.subTest(new=new):
                changed.write_text(gold.read_text().replace(old, new, 1))
                for expected in [gold, changed]:
                    result = compare(expected, changed)
                    self.assertFalse(result['comparable'])
                    self.assertFalse(accepted(result))
                    self.assertNotIn('precision', result)

    def test_comparison_detects_missing_tie_and_dot(self):
        for name, old, new in [('chords-ties', '<tie type="start"/>', ''),
                               ('chords-ties', '<tied type="start"/>', ''),
                               ('rhythm-accidentals', '<dot/>', '')]:
            with self.subTest(old=old):
                gold = ROOT / 'fixtures/omr/matrix' / f'{name}.musicxml'
                changed = self.root / 'changed.xml'
                changed.write_text(gold.read_text().replace(old, new, 1))
                result = compare(gold, changed)
                self.assertEqual(result['precision'], 1)
                self.assertEqual(result['recall'], 1)
                self.assertTrue(result['voice_partition_matches'])
                self.assertFalse(result['written_type_dot_tie_matches'])
                self.assertFalse(accepted(result))
                self.assertEqual(len(result['missing_written_events']), 1)

    def test_original_matrix_gold_is_reproducible_without_renderers(self):
        for name, generated in originals().items():
            gold = ROOT / 'fixtures/omr/matrix' / f'{name}.musicxml'
            self.assertEqual(gold.read_text(), generated)
            self.assertTrue(accepted(compare(gold, gold)))

    def test_public_matrix_reports_and_hashes(self):
        fixtures = ROOT / 'fixtures/omr/matrix'
        captures = fixtures / 'audiveris-5.11.0'
        results = json.loads((captures / 'evaluation.json').read_text())['cases']
        self.assertEqual([r['accepted'] for r in results], [True, False, True])
        for case, result in zip(CASES, results, strict=True):
            self.assertEqual(result['id'], case['id'])
            self.assertEqual(result['input_sha256'], sha256(fixtures / case['input']))
            self.assertEqual(result['gold_sha256'], sha256(fixtures / case['gold']))
            for name, digest in result['artifact_sha256'].items():
                self.assertEqual(digest, sha256(captures / case['id'] / name))
            public = captures / case['id'] / 'recognized.public.musicxml'
            xml = ET.fromstring(public.read_bytes())
            content = {'tag': xml.tag, 'attributes': xml.attrib,
                       'elements': [ET.tostring(n, encoding='unicode') for n in xml if n.tag != 'identification']}
            digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            self.assertEqual(digest, result['musical_content_sha256'])
            self.assertRegex(result['private_original_export_sha256'], r'^[a-f0-9]{64}$')
            comparison = compare(fixtures / case['gold'], captures / case['id'] / 'recognized.public.musicxml')
            self.assertEqual(comparison, result['comparison'])
            self.assertEqual(accepted(comparison), result['accepted'])

    def test_public_artifacts_exclude_raw_logs_and_local_metadata(self):
        fixtures = ROOT / 'fixtures/omr/matrix'
        self.assertEqual(list(fixtures.rglob('*.log')), [])
        self.assertEqual(list(fixtures.rglob('recognized.musicxml')), [])
        for path in fixtures.rglob('*.public.musicxml'):
            xml = ET.fromstring(path.read_bytes())
            for tag in ['source', 'miscellaneous-field', 'encoding-date']:
                self.assertEqual(xml.findall(f'.//{tag}'), [])
            self.assertIn('Derived public fixture', path.read_text())
        for path in fixtures.rglob('*'):
            if path.suffix in ('.json', '.musicxml'):
                for private_marker in ['/tmp/', '/workspace/', '/home/', 'JAVA_TOOL_OPTIONS', 'glibc']:
                    self.assertNotIn(private_marker, path.read_text())
                self.assertNotRegex(path.read_text(), r'Linux-[0-9]')
        for path in fixtures.glob('*.png'):
            data = path.read_bytes()
            offset = 8
            while offset < len(data):
                length = int.from_bytes(data[offset:offset + 4], 'big')
                kind = data[offset + 4:offset + 8]
                self.assertIn(kind, [b'IHDR', b'bKGD', b'IDAT', b'IEND'])
                offset += 12 + length
            self.assertEqual(offset, len(data))


if __name__ == '__main__':
    unittest.main()
