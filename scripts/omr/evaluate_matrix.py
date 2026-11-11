"""Bounded sequential evaluation of committed ORIGINAL synthetic images only.

Runs the supplied real engine, not gold/fake output. Does not download anything,
block networking, edit recognition, or claim camera-photo accuracy. Exit 1 means
at least one recognition/comparison failed the predeclared exact-fixture gate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import signal
import subprocess
import sys
import xml.etree.ElementTree as ET

from compare import compare

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'fixtures' / 'omr' / 'matrix'
CASES = json.loads((FIXTURES / 'cases.json').read_text())['cases']


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def accepted(comparison):
    return (comparison.get('comparable', False) and comparison.get('gold_events', 0) > 0
            and comparison['voice_partition_matches'] and comparison['written_type_dot_tie_matches']
            and comparison['gold_events'] == comparison['recognized_events']
            == comparison['exact_pitch_onset_duration_staff_measure_matches'])


def evaluate(engine, destination, cases, timeout):
    engine = Path(engine).resolve(strict=True)
    if not engine.is_file() or not os.access(engine, os.X_OK):
        raise ValueError('Provide your trusted installed Audiveris executable')
    if not 1 <= timeout <= 180 or not 1 <= len(cases) <= 3:
        raise ValueError('Use 1–3 cases and a per-case timeout of 1–180 seconds')
    destination = Path(destination).absolute()
    destination.mkdir(mode=0o700)  # Never reuse or overwrite a previous run.
    report = {'schema_version': 1, 'engine_executable_sha256': sha256(engine), 'platform': platform.platform(),
              'python': platform.python_version(), 'timeout_seconds_per_case': timeout,
              'gate': 'Exact written events including rests, pitch/onset/duration/staff/measure, voice partition, note types/dots and sound/visible ties. No correction or retries.',
              'network_isolation': 'not provided or verified', 'cases': []}
    for case in cases:
        folder = destination / case['id']
        folder.mkdir(mode=0o700)
        output = folder / 'recognized.musicxml'
        result = {'id': case['id'], 'input_sha256': sha256(FIXTURES / case['input']),
                  'gold_sha256': sha256(FIXTURES / case['gold'])}
        # A separate Python process makes child maximum RSS per invocation rather
        # than the maximum accumulated across previous cases. Adapter owns the
        # engine timeout, process group cleanup and resource limits.
        with (folder / 'adapter.stdout.log').open('xb') as stdout, (folder / 'adapter.stderr.log').open('xb') as stderr:
            def limits():
                resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024,) * 2)
            process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/omr/recognize.py'), '--audiveris', str(engine),
                                        '--input', str(FIXTURES / case['input']), '--output', str(output),
                                        '--log', str(folder / 'engine.log'), '--timeout', str(timeout)], stdout=stdout, stderr=stderr, preexec_fn=limits)
            try:
                process.wait()
            finally:
                if process.poll() is None:
                    # Ask the adapter to cancel and clean up its engine group.
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
        result.update(adapter_exit=process.returncode, output_created=output.exists(), accepted=False)
        (folder / 'adapter-exit.json').write_text(json.dumps({'exit': process.returncode}) + '\n')
        if process.returncode == 0 and output.exists():
            try:
                result['metrics'] = json.loads((folder / 'adapter.stdout.log').read_text())
                result['comparison'] = compare(FIXTURES / case['gold'], output)
                result['accepted'] = accepted(result['comparison'])
            except (ValueError, OSError, ET.ParseError) as exc:
                result['comparison_error'] = str(exc)
        result['artifact_sha256'] = {p.name: sha256(p) for p in sorted(folder.iterdir()) if p.is_file()}
        report['cases'].append(result)
        (folder / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        # Save failures incrementally too; never replace them with a gold export.
        (destination / 'evaluation.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'{case["id"]}: adapter exit {process.returncode}, exact gate {result["accepted"]}', flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audiveris', required=True)
    parser.add_argument('--output-dir', required=True, help='A new local directory; never reuse previous results')
    parser.add_argument('--timeout', type=int, default=180, help='Per-case wall/CPU timeout, at most 180 seconds')
    parser.add_argument('--case', choices=[c['id'] for c in CASES], help='Run just one case instead of all three')
    args = parser.parse_args()
    def terminate(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    cases = [c for c in CASES if args.case is None or c['id'] == args.case]
    report = evaluate(args.audiveris, args.output_dir, cases, args.timeout)
    return 0 if all(c['accepted'] for c in report['cases']) else 1


if __name__ == '__main__':
    sys.exit(main())
