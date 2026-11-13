#!/usr/bin/env python3
"""Optional real-Chromium production smoke check; requires installed Python Playwright.
Uses only the built-in original demo in a disposable browser context on localhost.
Never installs a browser, touches a real profile, or uploads files.
"""
import argparse
import functools
import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--chromium', required=True, help='Path to an already installed Chromium executable')
parser.add_argument('--dist', default='dist')
parser.add_argument('--artifacts', default='test-results/release')
args = parser.parse_args()
root = Path(args.dist).resolve()
assert (root / 'sw.js').is_file(), 'Run npm run build first'
artifacts = Path(args.artifacts)
artifacts.mkdir(parents=True, exist_ok=True)
version = 1

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/sw.js':
            # A byte-different worker release exercises the native waiting lifecycle.
            # Only this HTTP response changes; no repository/build file is modified.
            body = (root / 'sw.js').read_bytes() + f'\n// smoke release {version}\n'.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
passed = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True)
        context = browser.new_context(service_workers='allow', viewport={'width': 390, 'height': 844})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin)
        page.evaluate('navigator.serviceWorker.ready')
        page.reload()
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        passed.append('Production worker installed and controls page')
        page.get_by_role('button', name='My library', exact=True).click()
        page.get_by_role('button', name='Prepare a song', exact=True).click()
        page.get_by_label('Finger', exact=True).select_option('3')
        page.get_by_role('button', name='Save', exact=True).click()
        page.wait_for_function("JSON.parse(localStorage.getItem('piano-songs') || '[]').some(s => s.notes[0].finger === 3)")
        saved = page.evaluate("localStorage.getItem('piano-songs')")
        page.get_by_role('button', name='Practice room', exact=True).click()
        expect(page.get_by_role('heading', name='Let’s play a little.', exact=True)).to_be_visible()
        page.get_by_role('button', name='Mute', exact=True).click()
        page.get_by_role('button', name='Start practice', exact=False).click()
        page.get_by_role('button', name='Restart', exact=True).click()
        for width, height in [(390, 844), (844, 390), (360, 640), (640, 360)]:
            page.set_viewport_size({'width': width, 'height': height})
            for selector in ['.keyboard', '.transport', '.roll']:
                box = page.locator(selector).bounding_box()
                assert box and box['width'] > 0 and box['height'] > 0, (selector, box)
                assert box['x'] >= -1 and box['y'] >= -1, (selector, box)
                assert box['x'] + box['width'] <= width + 1, (selector, box)
                assert box['y'] + box['height'] <= height + 1, (selector, box)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            page.screenshot(path=str(artifacts / f'practice-{width}x{height}.png'))
        passed.append('Portrait/landscape keyboard, roll, transport fit four viewports')
        setup = page.get_by_role('button', name='Practice setup', exact=True)
        setup.focus()
        page.keyboard.press('Enter')
        dialog = page.get_by_role('dialog', name='Practice setup', exact=True)
        expect(dialog).to_be_visible()
        for _ in range(20):
            page.keyboard.press('Tab')
            assert page.evaluate("!!document.activeElement.closest('dialog[open]')")
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        expect(setup).to_be_focused()
        key = page.locator('.keyboard button[data-pitch="60"]')
        key.focus()
        page.keyboard.press('Enter')
        expect(key).to_have_class(re.compile(r'pressed'))
        passed.append('Native modal keyboard focus trap/return and keyboard piano activation')
        context.set_offline(True)
        page.reload()
        expect(page.get_by_role('heading', name='Let’s play a little.', exact=True)).to_be_visible()
        assert page.evaluate("localStorage.getItem('piano-songs')") == saved
        passed.append('Offline cached reload preserves saved demo/fingering bytes')
        context.set_offline(False)
        page.get_by_role('button', name='My library', exact=True).click()
        page.get_by_role('button', name='Prepare a song', exact=True).click()
        page.get_by_label('Finger', exact=True).select_option('4')
        version = 2
        page.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
        update = page.get_by_role('button', name='Reload update', exact=True)
        expect(update).to_be_visible(timeout=30000)
        expect(page.get_by_label('Finger', exact=True)).to_have_value('4')
        page.once('dialog', lambda dialog: dialog.dismiss())
        update.click()
        expect(update).to_be_visible()
        expect(page.get_by_label('Finger', exact=True)).to_have_value('4')
        assert page.evaluate("localStorage.getItem('piano-songs')") == saved
        # Some browsers also show beforeunload after the app's own confirmation.
        accept_reload = lambda dialog: dialog.accept()
        page.on('dialog', accept_reload)
        with page.expect_navigation():
            update.click()
        page.remove_listener('dialog', accept_reload)
        expect(update).not_to_be_visible()
        assert page.evaluate("localStorage.getItem('piano-songs')") == saved
        passed.append('Waiting update does not auto-reload; cancel retains draft; accept preserves saved library')
        assert not errors, errors
        passed.append('No uncaught page errors')
        browser.close()
        (artifacts / 'report.json').write_text(json.dumps({'browser': 'Chromium', 'passed': passed}, indent=2))
        print('\n'.join(passed))
except Exception as error:
    (artifacts / 'report.json').write_text(json.dumps({'passed': passed, 'failure': str(error), 'remaining': 'Not completed; do not claim browser acceptance'}, indent=2))
    raise
finally:
    server.shutdown()
    server.server_close()
