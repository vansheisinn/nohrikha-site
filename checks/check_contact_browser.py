"""Browser checks; all third-party requests are blocked or mocked, never delivered.
Run: python3 checks/check_contact_browser.py (requires Playwright + Chromium).
"""
import json
from pathlib import Path
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
endpoint = 'https://formspree.io/f/localtest'
config = dict(enabled=True, provider='formspree', endpoint=endpoint, spamProtectionVerified=True)

def setup(page, settings=None, result_status=200):
    posts = []
    def route(request):
        url = request.request.url
        if url == endpoint:
            posts.append(request.request)
            request.fulfill(status=result_status, content_type='text/html', body='<h1>Mock processor result</h1>')
        elif url.endswith('/contact-config.js') and settings is not None:
            request.fulfill(content_type='application/javascript', body='window.NOHRIKHA_CONTACT=' + json.dumps(settings))
        elif urlsplit(url).netloc == urlsplit(base).netloc:
            request.continue_()
        else:
            request.abort()  # No real provider/Telegram/fonts network access in tests.
    page.route('**/*', route)
    return posts

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for width in [1440, 375, 320]:
            page = browser.new_page(viewport={'width': width, 'height': 900})
            posts = setup(page, dict(config, enabled=False))
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            for locale in ['', 'en/', 'de/', 'kz/']:
                for file in ['index.html', 'stories.html', 'timeline.html', 'contact.html']:
                    assert page.goto(base + '/' + locale + file).status == 200
                    assert page.locator('a[href="https://t.me/nohrikha"]').count() >= 1
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, locale, file)
                    if file == 'contact.html':
                        assert page.locator('#feedback-form button').is_disabled()
                        assert page.locator('#feedback-form').get_attribute('action') is None
            assert not posts and not errors, (posts, errors)
            if width == 375:
                page.screenshot(path='/tmp/nohrikha-contact-form.png', full_page=True)
            page.close()
        print('PASS 48 layouts, Telegram everywhere, no JS errors; unconfigured form cannot send')

        for settings in [dict(config, enabled=False), dict(config, spamProtectionVerified=False),
                         dict(config, endpoint='https://example.com/collect'),
                         dict(config, endpoint=endpoint + '?redirect=elsewhere'),
                         dict(config, endpoint='http://formspree.io/f/localtest')]:
            page = browser.new_page()
            posts = setup(page, settings)
            page.goto(base + '/contact.html')
            assert page.locator('#feedback-form button').is_disabled()
            assert not posts
            page.close()
        print('PASS configuration guard: disabled, unverified spam settings and invalid endpoints')

        for locale in ['', 'en/', 'de/', 'kz/']:
            page = browser.new_page()
            posts = setup(page, config)
            page.goto(base + '/' + locale + 'contact.html')
            message = page.locator('#feedback-message')
            send = page.locator('#feedback-form button')
            consent = page.locator('#feedback-consent')
            send.click()  # Required fields.
            assert not posts
            message.fill(' ' * 22)
            consent.check()
            send.click()
            assert not posts
            assert message.evaluate('(e)=>e.validationMessage')
            message.fill('This is a local browser test, never delivered.')
            page.locator('#feedback-email').fill('invalid-email')
            send.click()
            assert not posts
            page.locator('#feedback-email').fill('')
            consent.uncheck()
            send.click()
            assert not posts
            consent.check()
            page.locator('#feedback-website').evaluate('(e)=>e.value="spam"')
            send.click()
            assert not posts and page.locator('#feedback-status').inner_text()
            page.locator('#feedback-website').evaluate('(e)=>e.value=""')
            message.evaluate('(e)=>{e.value="x".repeat(10001);e.dispatchEvent(new Event("input"));}')
            page.evaluate('document.querySelector("#feedback-form").requestSubmit()')
            assert not posts
            message.fill('  This is a local browser test, never delivered.  ')
            with page.expect_navigation():
                send.click()
            assert len(posts) == 1 and posts[0].method == 'POST'
            body = parse_qs(posts[0].post_data)
            assert body['message'] == ['This is a local browser test, never delivered.']
            assert 'email' not in body and 'name' not in body
            assert body['consent'] == ['yes']
            assert body['language'] == [{'': 'ru', 'en/': 'en', 'de/': 'de', 'kz/': 'kk'}[locale]]
            page.close()
        print('PASS validation, consent, optional identity, honeypot, bounds and native POST in four languages (mock processor)')

        page = browser.new_page()
        posts = setup(page, config, result_status=500)
        page.goto(base + '/contact.html')
        page.locator('#feedback-message').fill('Local test of an unsuccessful processor response.')
        page.locator('#feedback-consent').check()
        # Calling the handler does not send; second call must be blocked.
        assert page.evaluate('document.querySelector("#feedback-form").onsubmit()') is True
        assert page.evaluate('document.querySelector("#feedback-form").onsubmit()') is False
        assert not posts
        assert page.locator('#feedback-form button').is_disabled()
        page.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow"))')
        assert page.locator('#feedback-form button').is_enabled()
        assert page.locator('#feedback-message').input_value()
        with page.expect_navigation():
            page.locator('#feedback-form button').click()
        assert len(posts) == 1 and page.locator('h1').inner_text() == 'Mock processor result'
        page.go_back()
        assert page.locator('#feedback-message').input_value()
        assert page.locator('#feedback-form button').is_enabled()
        page.close()
        print('PASS repeat-submission guard, processor error navigation and retained draft after Back')

        # Real public configuration loads, but no real submission is attempted.
        for locale in ['', 'en/', 'de/', 'kz/']:
            page = browser.new_page()
            posts = setup(page)
            page.goto(base + '/' + locale + 'contact.html')
            assert page.locator('#feedback-form button').is_enabled()
            assert page.locator('#feedback-form').get_attribute('action') == 'https://formspree.io/f/xaeqlnpj'
            assert 'Formspree' in page.locator('#feedback-availability').inner_text()
            assert page.locator('#feedback-privacy a').get_attribute('href') == 'https://formspree.io/legal/privacy-policy/'
            assert not posts
            page.close()
        print('PASS real public configuration in four languages; no real requests sent')

        page = browser.new_page(java_script_enabled=False)
        posts = setup(page, config)
        page.goto(base + '/contact.html')
        assert page.locator('#feedback-form button').is_disabled()
        assert not posts
        page.close()
        browser.close()
        print('PASS without JavaScript: no accidental submission')
finally:
    server.shutdown()
    server.server_close()
