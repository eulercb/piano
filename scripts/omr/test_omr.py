"""Adapter safeguards only. Fake engines below are NOT recognition evidence."""
import os
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

from recognize import check_png, read_export, run, publish
from compare import compare

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

    def test_timeout(self):
        engine = self.engine('import time\ntime.sleep(20)\n')
        target = self.root / 'new.musicxml'
        with self.assertRaises(subprocess.TimeoutExpired):
            run(engine, FIXTURE, target, 1)
        self.assertFalse(target.exists())

    def test_sigterm_kills_job(self):
        pidfile = self.root / 'pid'
        engine = self.engine(f'import os,time\nopen({str(pidfile)!r}, "w").write(str(os.getpid()))\ntime.sleep(20)\n')
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
            z.writestr('../score.xml', b'<score-partwise><part><measure><note/></measure></part></score-partwise>')
        self.assertIn(b'score-partwise', read_export(archive))
        self.assertFalse((self.root.parent / 'score.xml').exists())

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


if __name__ == '__main__':
    unittest.main()
