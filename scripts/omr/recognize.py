"""Opt-in Linux desktop Audiveris adapter. No engine download or network isolation.
Only invoke trusted, separately installed Audiveris. See docs/local-omr-evaluation.md.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import struct
import sys
import subprocess
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from timing import check_timing

MAX_INPUT = 20 * 1024 * 1024
MAX_OUTPUT = 20 * 1024 * 1024


def check_png(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_INPUT:
        raise ValueError('Input must be a regular PNG no larger than 20 MiB')
    with path.open('rb') as f:
        header = f.read(24)
    if len(header) != 24 or header[:8] != b'\x89PNG\r\n\x1a\n' or header[12:16] != b'IHDR':
        raise ValueError('Only PNG images are supported')
    width, height = struct.unpack('>II', header[16:24])
    if not width or not height or width * height > 20_000_000:
        raise ValueError('PNG must have at most 20 million pixels')


def read_export(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_OUTPUT:
        raise ValueError('Invalid or oversized MXL output')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 20 or sum(e.file_size for e in entries) > MAX_OUTPUT:
            raise ValueError('Oversized MXL contents')
        # Read in memory, never extract paths supplied by the archive.
        candidates = [e for e in entries if e.filename.lower().endswith(('.xml', '.musicxml')) and not e.filename.startswith('META-INF/')]
        if len(candidates) != 1:
            raise ValueError('Expected one MusicXML score')
        data = archive.read(candidates[0])
    # Audiveris emits a standard external MusicXML DOCTYPE. ElementTree does not
    # retrieve it. Reject entity declarations and internal subsets explicitly.
    text = data.decode('utf-8', errors='strict')
    if '\0' in text:
        raise ValueError('Only UTF-8 MusicXML is supported')
    if '<!ENTITY' in text.upper() or '[' in text.split('<!DOCTYPE', 1)[-1].split('>', 1)[0]:
        raise ValueError('XML entities/internal subsets are unsupported')
    root = ET.fromstring(data)
    if root.tag != 'score-partwise' or not root.findall('./part/measure/note'):
        raise ValueError('No recognized score-partwise notes')
    check_timing(root)
    return data


def publish(data, destination):
    """Publish a complete file atomically without replacing any destination."""
    fd, name = tempfile.mkstemp(prefix='.piano-omr-', dir=destination.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.link(staged, destination)  # Atomic, exclusive; same filesystem.
    finally:
        staged.unlink(missing_ok=True)


def java_path_option(name, path):
    """Quote one JVM option, not a shell argument; refuse ambiguous quotes."""
    value = str(path)
    # JAVA_TOOL_OPTIONS uses JVM whitespace/quote parsing, not shell escaping.
    # Fail before launching rather than split a path into unintended JVM options.
    if '"' in value:
        raise ValueError('Temporary directory path must not contain double quotes')
    return f'"-D{name}={value}"'


def run(engine, source, destination, timeout=180, log_destination=None):
    if os.name != 'posix':
        raise ValueError('This experimental adapter currently requires Linux/POSIX')
    engine = Path(engine).resolve(strict=True)
    source = Path(source).absolute()
    destination = Path(destination).absolute()
    check_png(source)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Output already exists; choose a new MusicXML filename')
    if destination.suffix.lower() != '.musicxml' or not destination.parent.is_dir():
        raise ValueError('Output must be a .musicxml file in an existing directory')
    if not engine.is_file() or not os.access(engine, os.X_OK):
        raise ValueError('Provide the executable of your trusted Audiveris installation')
    if not 1 <= timeout <= 600:
        raise ValueError('Timeout must be between 1 and 600 seconds')
    if log_destination is not None:
        log_destination = Path(log_destination).absolute()
        if log_destination.suffix.lower() != '.log' or not log_destination.parent.is_dir():
            raise ValueError('Engine log must be a new .log file in an existing directory')
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='piano-omr-') as folder:
        work = Path(folder)
        image = work / 'input.png'
        shutil.copyfile(source, image)
        check_png(image)
        home = work / 'home'
        home.mkdir()
        temporary = work / 'tmp'
        temporary.mkdir(mode=0o700)
        output = work / 'output'
        output.mkdir()
        # Fresh per-job state, rather than personal config or inherited Java args.
        env = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'TESSDATA_PREFIX')}
        env.update(TMPDIR=str(temporary), TMP=str(temporary), TEMP=str(temporary),
                   HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'), XDG_DATA_HOME=str(home / 'data'), XDG_CACHE_HOME=str(home / 'cache'),
                   JAVA_TOOL_OPTIONS=' '.join(('-Xmx1536m', '-XX:ActiveProcessorCount=2', '-Djava.awt.headless=true',
                                              java_path_option('user.home', home), java_path_option('java.io.tmpdir', temporary))))
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024,) * 2)
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout + 1))
        process = None
        # A requested log remains byte-for-byte intact even on engine failure or
        # timeout. Exclusive creation refuses existing files and symlinks.
        log_path = log_destination if log_destination is not None else work / 'engine.log'
        with os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as log:
            try:
                process = subprocess.Popen([str(engine), '-batch', '-transcribe', '-export', '-output', str(output), '--', str(image)],
                                           cwd=work, env=env, stdout=log, stderr=log, start_new_session=True, preexec_fn=limits)
                code = process.wait(timeout=timeout)
                if code != 0:
                    raise RuntimeError(f'Audiveris failed (exit {code}); no output accepted')
            finally:
                # Kill any remaining job descendants on success, timeout or Ctrl-C.
                if process is not None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
        exports = list(output.rglob('*.mxl'))
        if len(exports) != 1:
            raise ValueError('Audiveris did not export exactly one MXL score')
        data = read_export(exports[0])
        log_text = log_path.read_text(errors='replace')
        # Exclusive creation prevents overwriting a file created during recognition.
        publish(data, destination)
        return {'elapsed_seconds': round(time.monotonic() - started, 3), 'output_bytes': len(data),
                'child_max_rss_kib_linux': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
                'engine_warning_lines': sum('WARN ' in line or 'ERROR ' in line for line in log_text.splitlines()),
                'review_required': True, 'network_isolation': 'not provided or verified',
                'limits': '1536 MiB Java heap, 2 JVM processors, CPU/wall timeout, 64 MiB per file; not total RSS/disk quotas'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audiveris', required=True, help='Trusted, separately installed Audiveris executable')
    parser.add_argument('--input', required=True, help='Chosen PNG; use synthetic inputs until offline acceptance')
    parser.add_argument('--output', required=True, help='New .musicxml file; never overwrites')
    parser.add_argument('--timeout', type=int, default=180)
    parser.add_argument('--log', help='Optional new .log file retaining raw engine stdout/stderr, including failures and local paths')
    args = parser.parse_args()
    def terminate(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    print('Experimental desktop recognition: outbound network is NOT blocked or verified. Use synthetic inputs until offline acceptance. Every result needs review.', file=sys.stderr)
    try:
        print(json.dumps(run(args.audiveris, args.input, args.output, args.timeout, args.log), indent=2))
    except (ValueError, OSError, RuntimeError, subprocess.TimeoutExpired, ET.ParseError, zipfile.BadZipFile) as exc:
        parser.exit(1, f'Recognition failed: {exc}\n')
    except KeyboardInterrupt:
        parser.exit(130, 'Recognition cancelled. If publication just completed, a complete output may exist; inspect it before use.\n')


if __name__ == '__main__':
    main()
