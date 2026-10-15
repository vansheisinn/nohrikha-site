"""Literary navigation and typography, including project subpath; no external requests."""
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def translate_path(self, path):
        if path.startswith('/nohrikha-site/'):
            path = path[len('/nohrikha-site'):]
        return super().translate_path(path)

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        count = 0
        for width in [1440, 375, 320]:
            page = browser.new_page(viewport={'width': width, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base + '/') else route.abort())
            for prefix in ['/', '/nohrikha-site/']:
                for locale in ['', 'en/']:
                    for file in ['index.html', 'stories.html', 'timeline.html', 'psovaya-ohota.html']:
                        response = page.goto(base + prefix + locale + file)
                        assert response.status == 200, (width, locale, file)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, locale, file)
                        count += 1
                    for source in ['my-story', 'second-story']:
                        page.goto(base + prefix + locale + 'stories.html#' + source)
                        page.locator('#' + source + ' a[href="psovaya-ohota.html"]').click()
                        assert page.url == base + prefix + locale + 'psovaya-ohota.html'
                        page.locator('.sidebar a[href="stories.html#' + source + '"]').click()
                        assert page.url == base + prefix + locale + 'stories.html#' + source
                    page.goto(base + prefix + locale + 'psovaya-ohota.html')
                    other = 'RU' if locale else 'EN'
                    page.get_by_role('link', name=other, exact=True).click()
                    expected_locale = '' if locale else 'en/'
                    assert page.url == base + prefix + expected_locale + 'psovaya-ohota.html'
            assert not errors, errors
            page.close()
        browser.close()
        print('PASS', count, 'editorial page layouts; both stories ↔ play, RU/EN switch, root/subpath, no JS errors')
        print('NOT TESTED: full play completeness; original text unavailable')
finally:
    server.shutdown()
    server.server_close()
