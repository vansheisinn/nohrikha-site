"""Timeline tooltips, anchor navigation and fading highlights; all requests stay local."""
import threading
import subprocess
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ['1942', '1954', '1942', '1954', '1939', '1941', '1946-1950']


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def translate_path(self, path):
        if path.startswith('/nohrikha-site/'):
            path = path[len('/nohrikha-site'):]
        return super().translate_path(path)


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
errors = []


def new_page(browser, **options):
    page = browser.new_page(**options)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base + '/') else route.abort())
    return page


def expect_destination(page, event_id):
    target = page.locator(f'#event-{event_id}')
    expect(page).to_have_url(f'{page.url.split("#")[0]}#event-{event_id}')
    expect(target).to_be_focused()
    expect(target).to_have_class('event blue event-highlight' if 'blue' in target.get_attribute('class') else 'event event-highlight')
    page.wait_for_function('''id => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
    }''', arg=f'event-{event_id}')
    expect(page.get_by_role('tooltip')).to_be_hidden()
    return target


def expect_clean_hit_areas(page):
    for hit in page.locator('.timeline-hit').all():
        expect(hit).to_have_css('fill', 'none')
        expect(hit).to_have_css('stroke', 'none')
        expect(hit).to_have_css('pointer-events', 'all')
        size = hit.evaluate('(e) => ({tag: e.tagName, width: e.getBBox().width, height: e.getBBox().height})')
        assert size['height'] <= 32, size
        assert size['width'] <= (82 if size['tag'] == 'rect' else 32), size
    for ring in page.locator('.timeline-ring').all():
        expect(ring).to_have_css('fill', 'none')
    assert page.locator('.chart-scroll svg title').count() == 0, 'The chart title must not cover the event tooltip'


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        count = 0
        for width in [1440, 375, 320]:
            page = new_page(browser, viewport={'width': width, 'height': 900})
            for prefix in ['/', '/nohrikha-site/']:
                for locale in ['', 'en/']:
                    print('CHECK timeline', width, prefix + locale, flush=True)
                    response = page.goto(f'{base}{prefix}{locale}timeline.html')
                    assert response.status == 200
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, prefix, locale)
                    expect_clean_hit_areas(page)
                    assert '?v=' in page.locator('link[rel="stylesheet"]').get_attribute('href')
                    chart_name = 'Family timeline, 1930–1970' if locale else 'Семейная хронология с 1930 по 1970 год'
                    expect(page.get_by_role('group', name=chart_name, exact=True)).to_have_count(1)
                    points = page.locator('.timeline-point')
                    expect(points).to_have_count(len(TARGETS))
                    for index, event_id in enumerate(TARGETS):
                        point = points.nth(index)
                        expect(point).to_have_attribute('href', f'#event-{event_id}')
                        assert page.get_by_role('link', name=point.get_attribute('aria-label'), exact=True).count() == 1
                        point.hover()
                        tooltip = page.get_by_role('tooltip')
                        target = page.locator(f'#event-{event_id}')
                        expect(tooltip).to_have_text(f'{target.locator("time").inner_text()} — {target.locator("p").inner_text()}')
                        expect(tooltip).to_be_visible()
                        rect = tooltip.bounding_box()
                        assert rect['x'] >= 15 and rect['x'] + rect['width'] <= width - 15, rect
                        point.click()
                        expect_destination(page, event_id)
                        count += 1
                    page.locator('.timeline-point').first.focus()
                    expect(page.get_by_role('tooltip')).to_be_visible()
                    page.keyboard.press('Tab')
                    expect(points.nth(1)).to_be_focused()
                    expect(page.get_by_role('tooltip')).to_be_visible()
                    page.keyboard.press('Escape')
                    expect(page.get_by_role('tooltip')).to_be_hidden()
                    page.keyboard.press('Enter')
                    expect_destination(page, '1954')
            page.close()
        print('PASS', count, 'mouse navigations: all dates, RU/EN, root/subpath, 1440/375/320px; tooltips, keyboard and Escape')

        for locale in ['', 'en/']:
            page = new_page(browser, viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
            page.goto(f'{base}/{locale}timeline.html')
            for index, event_id in enumerate(TARGETS):
                page.locator('.timeline-point').nth(index).tap()
                expect_destination(page, event_id)
            page.close()
        print('PASS 14 touch navigations, including the adjacent 1939/1941 points')

        page = new_page(browser, viewport={'width': 1440, 'height': 900})
        page.goto(f'{base}/timeline.html')
        point = page.locator('.timeline-point[href="#event-1939"]')
        point.hover()
        tooltip = page.get_by_role('tooltip')
        tooltip.hover()
        page.wait_for_timeout(180)
        expect(tooltip).to_be_visible()
        page.keyboard.press('Escape')
        expect(tooltip).to_be_hidden()
        point.click()
        target = expect_destination(page, '1939')
        page.wait_for_function('''() => getComputedStyle(document.getElementById('event-1939')).backgroundColor !== 'rgb(255, 253, 250)' ''')
        point.click()
        expect_destination(page, '1939')
        assert target.evaluate('(e) => e.getAnimations()[0].currentTime < 1000')
        expect(target).not_to_have_class('event event-highlight', timeout=4000)
        assert target.evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgb(255, 253, 250)'
        page.emulate_media(reduced_motion='reduce')
        point.click()
        target = expect_destination(page, '1939')
        assert target.evaluate('(e) => e.getAnimations().length') == 0
        assert target.evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgb(234, 227, 206)'
        expect(target).not_to_have_class('event event-highlight', timeout=4000)
        assert target.evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgb(255, 253, 250)'
        page.close()
        print('PASS hoverable tooltip, repeated clicks restart the highlight, fade returns to original colour, reduced motion')

        for locale in ['', 'en/']:
            page = new_page(browser, java_script_enabled=False, viewport={'width': 375, 'height': 812})
            page.goto(f'{base}/nohrikha-site/{locale}timeline.html')
            page.locator('.timeline-point[href="#event-1941"]').click()
            expect(page).to_have_url(f'{base}/nohrikha-site/{locale}timeline.html#event-1941')
            expect(page.locator('#event-1941')).to_be_in_viewport()
            page.close()

        stale_css = subprocess.check_output(['git', 'show', '39d1935:styles.css'], cwd=ROOT, text=True)
        for mode in ['stale', 'unavailable']:
            for locale in ['', 'en/']:
                page = new_page(browser, viewport={'width': 1440, 'height': 900})
                page.route('**/styles.css*', lambda route, mode=mode: route.fulfill(
                    status=200, content_type='text/css', body=stale_css
                ) if mode == 'stale' else route.abort())
                page.goto(f'{base}/{locale}timeline.html')
                expect_clean_hit_areas(page)
                for ring in page.locator('.timeline-ring').all():
                    expect(ring).to_have_css('opacity', '0')
                page.close()
        print('PASS no black hit areas with stale or unavailable CSS, RU/EN; compact geometry and accessible chart name')
        browser.close()
        assert not errors, errors
        print('PASS RU/EN anchor fallback without JavaScript; no browser errors or external requests')
finally:
    server.shutdown()
    server.server_close()
