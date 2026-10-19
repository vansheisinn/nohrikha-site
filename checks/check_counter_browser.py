"""Exercise counter behavior in real browsers, with no external submissions."""
import asyncio
import json
from pathlib import Path
from urllib.parse import urlsplit, unquote

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://nohrikha.com'
ENDPOINT = 'https://nohrikha-counter.test'
KEY = 'nohrikha.counter.lastDay'
SOURCES = ['direct', 'google', 'yandex', 'bing', 'telegram', 'whatsapp', 'social', 'other']


class Mock:
    def __init__(self, enabled=True, mode='ok'):
        self.enabled = enabled
        self.mode = mode
        self.day = '2026-10-19'
        self.calls = []
        self.posts = []
        self.daily = {}

    def stats(self):
        from datetime import date, timedelta
        today = date.fromisoformat(self.day)
        days = []
        for ago in range(6, -1, -1):
            day = str(today - timedelta(days=ago))
            value = self.daily.get(day, {})
            days.append({'date': day, 'views': value.get('views', 0), 'browsers': value.get('browsers', 0)})
        sources = {source: 0 for source in SOURCES}
        for value in self.daily.values():
            for source in SOURCES:
                sources[source] += value['sources'][source]
        return {'day': self.day, 'today': days[-1], 'days': days, 'sources': sources,
                'totalViews': sum(d['views'] for d in self.daily.values()), 'capped': False}

    async def route(self, route):
        request = route.request
        url = urlsplit(request.url)
        if url.netloc in ['nohrikha.com', 'vansheisinn.github.io']:
            local_path = url.path.removeprefix('/nohrikha-site/') if url.netloc == 'vansheisinn.github.io' else url.path
            path = ROOT / unquote(local_path.lstrip('/') or 'index.html')
            if path.is_dir():
                path = path / 'index.html'
            assert path.is_relative_to(ROOT)
            if path.name == 'counter-config.js' and self.enabled is not None:
                endpoint = ENDPOINT if self.enabled else ''
                await route.fulfill(content_type='text/javascript', body='window.NOHRIKHA_COUNTER={endpoint:' + json.dumps(endpoint) + '};')
            else:
                await route.fulfill(path=str(path))
            return
        if url.netloc not in ['nohrikha-counter.test', 'nohrikha-counter.vansheisinn.workers.dev']:
            await route.abort()
            return
        self.calls.append(request)
        assert not url.query and 'referer' not in request.headers
        assert request.headers.get('cookie') is None
        headers = {'Access-Control-Allow-Origin': SITE, 'Content-Type': 'application/json'}
        if self.mode == 'down':
            await route.fulfill(status=503, headers=headers, body='{}')
            return
        if self.mode == 'timeout':
            await asyncio.sleep(2.2)
            try:
                await route.fulfill(status=503, headers=headers, body='{}')
            except Exception:
                pass  # Fetch timeout already aborted the intercepted request.
            return
        if self.mode == 'malformed':
            await route.fulfill(headers=headers, body='{"days":"<script>throw 1</script>"}')
            return
        if url.path == '/challenge':
            data = {'day': self.day, 'token': 'local-test-token-' + str(len(self.calls))}
        elif url.path == '/collect':
            body = request.post_data_json
            assert set(body) == {'token', 'first', 'source'} and body['source'] in SOURCES
            assert isinstance(body['first'], bool)
            assert request.headers['content-type'].startswith('text/plain')
            self.posts.append(body)
            # Keep both tabs in flight long enough to exercise Web Locks.
            await asyncio.sleep(0.03)
            value = self.daily.setdefault(self.day, {'views': 0, 'browsers': 0, 'sources': dict.fromkeys(SOURCES, 0)})
            value['views'] += 1
            if body['first']:
                value['browsers'] += 1
                value['sources'][body['source']] += 1
            data = {'accepted': True}
        elif url.path == '/stats':
            data = self.stats()
        else:
            raise AssertionError(request.url)
        await route.fulfill(headers=headers, body=json.dumps(data))


async def settle(page, mock, views):
    shows_stats = urlsplit(page.url).path in ['/contact.html', '/en/contact.html']
    for _ in range(100):
        if sum(d['views'] for d in mock.daily.values()) >= views and await page.locator('.visitor-counter').count() == int(shows_stats):
            return
        await page.wait_for_timeout(25)
    raise AssertionError(('counter did not settle', views, mock.posts))


async def context_for(browser, mock, width=390, script=None):
    context = await browser.new_context(viewport={'width': width, 'height': 900}, timezone_id='Pacific/Honolulu')
    await context.route('**/*', mock.route)
    if script:
        await context.add_init_script(script)
    return context


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        mock = Mock(enabled=False)
        context = await context_for(browser, mock)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        for prefix in ['', '/en']:
            for file in ['index.html', 'stories.html', 'timeline.html', 'contact.html', 'psovaya-ohota.html']:
                await page.goto(SITE + prefix + '/' + file)
                assert not await page.locator('.visitor-counter').count()
        assert not mock.calls and not errors
        await context.close()
        print('PASS disabled configuration: all 10 pages, no server requests or widget')

        # Load the actual committed config, intercepting every production request.
        # This catches missing/stale page assets and an accidentally empty endpoint.
        mock = Mock(enabled=None)
        context = await context_for(browser, mock)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        views = 0
        for prefix in ['', '/en']:
            for file in ['index.html', 'stories.html', 'timeline.html', 'contact.html', 'psovaya-ohota.html']:
                await page.goto(SITE + prefix + '/' + file)
                views += 1
                await settle(page, mock, views)
                assert await page.locator('.visitor-counter').count() == int(file == 'contact.html')
        assert len(mock.posts) == 10 and sum(body['first'] for body in mock.posts) == 1
        assert sum(urlsplit(request.url).path == '/stats' for request in mock.calls) == 2
        assert {urlsplit(request.url).netloc for request in mock.calls} == {'nohrikha-counter.vansheisinn.workers.dev'}
        assert not errors
        await context.close()
        print('PASS all 10 pages count views, one daily browser; only RU/EN contacts render and fetch statistics')

        for width in [320, 375, 430, 1440]:
            for prefix in ['', '/en']:
                mock = Mock()
                context = await context_for(browser, mock, width)
                page = await context.new_page()
                await page.goto(SITE + prefix + '/contact.html?utm_source=telegram&private=not-sent')
                await settle(page, mock, 1)
                assert mock.posts[0]['first'] and mock.posts[0]['source'] == 'telegram'
                assert await page.evaluate('localStorage.length') == 1
                assert await page.evaluate('localStorage.getItem(' + json.dumps(KEY) + ')') == mock.day
                await page.locator('.visitor-counter summary').click()
                assert await page.locator('.visitor-counter tbody tr').count() == 7
                assert await page.evaluate('''() => {
                    const widget = document.querySelector('.visitor-counter');
                    const background = getComputedStyle(widget.closest('.footer')).backgroundColor;
                    const texts = widget.querySelectorAll('summary,h2,th,td,li,p');
                    return [...texts].every(node => getComputedStyle(node).color === background)
                        && getComputedStyle(widget).borderTopWidth === '0px'
                        && [...widget.querySelectorAll('th,td')].every(node => getComputedStyle(node).borderBottomWidth === '0px')
                        && getComputedStyle(widget.querySelector('summary')).listStyleType === 'none';
                }'''), (width, prefix, 'counter must blend into footer')
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, prefix)
                assert await page.locator('#feedback-form button[type=submit]').is_enabled()
                if width == 375 and not prefix:
                    await page.locator('.visitor-counter').screenshot(path='/tmp/nohrikha-counter-mobile.png')
                assert await page.evaluate('''() => {
                    const widget = document.querySelector('.visitor-counter');
                    const range = document.createRange();
                    range.selectNodeContents(widget);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    const style = getComputedStyle(widget.querySelector('summary'), '::selection');
                    return selection.toString().includes('1') && style.color !== style.backgroundColor
                        && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
                }'''), (width, prefix, 'selected statistics must remain readable')
                if width == 375 and not prefix:
                    await page.locator('.visitor-counter').screenshot(path='/tmp/nohrikha-counter-selected.png')
                await context.close()
        print('PASS 8 RU/EN layouts, 320–1440px: text matches footer, selection readable, no borders/marker or overflow, form enabled')

        mock = Mock()
        context = await context_for(browser, mock)
        page = await context.new_page()
        await page.goto(SITE + '/?utm_source=whatsapp')
        await settle(page, mock, 1)
        await page.goto(SITE + '/en/contact.html')
        await settle(page, mock, 2)
        assert not mock.posts[-1]['first']
        await page.evaluate('location.hash="my-story"')
        await page.wait_for_timeout(100)
        assert len(mock.posts) == 2
        await page.locator('.visitor-counter summary').click()
        await page.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))')
        await settle(page, mock, 3)
        assert not mock.posts[-1]['first']
        mock.day = '2026-10-20'
        await page.goto(SITE + '/index.html')
        await settle(page, mock, 4)
        assert mock.posts[-1]['first']
        assert mock.daily['2026-10-19']['browsers'] == 1 and mock.daily['2026-10-20']['browsers'] == 1
        assert mock.daily['2026-10-19']['sources']['whatsapp'] == 1
        await context.close()
        print('PASS shared RU/EN day, reload/history/hash behavior, server date overrides local timezone')

        mock = Mock()
        context = await context_for(browser, mock)
        pages = [await context.new_page(), await context.new_page()]
        await asyncio.gather(*(page.goto(SITE + '/?utm_source=telegram') for page in pages))
        assert await pages[0].evaluate('Boolean(navigator.locks)')
        await asyncio.gather(*(settle(page, mock, 2) for page in pages))
        assert sum(body['first'] for body in mock.posts) == 1
        await context.close()
        print('PASS simultaneous tabs: one browser per day with Web Locks')

        for referrer, expected in [('https://www.google.com/search?q=private', 'google'), ('https://yandex.ru/search/?text=private', 'yandex'), ('https://private.example.test/private', 'other')]:
            mock = Mock()
            context = await context_for(browser, mock)
            page = await context.new_page()
            await page.goto(SITE + '/', referer=referrer)
            await settle(page, mock, 1)
            assert mock.posts[0]['source'] == expected
            await context.close()
        print('PASS coarse source classification, private URL/query/referrer not transmitted')

        mock = Mock()
        context = await context_for(browser, mock, script='Storage.prototype.getItem=Storage.prototype.setItem=function(){throw Error("denied")}')
        page = await context.new_page()
        await page.goto(SITE + '/')
        await settle(page, mock, 1)
        assert not mock.posts[0]['first']
        await context.close()
        print('PASS unavailable storage counts views without inventing unique visitors')

        mock = Mock()
        context = await context_for(browser, mock, script='Object.defineProperty(navigator,"locks",{value:undefined})')
        page = await context.new_page()
        await page.goto(SITE + '/')
        await settle(page, mock, 1)
        await page.reload()
        await settle(page, mock, 2)
        assert sum(body['first'] for body in mock.posts) == 1
        await context.close()
        print('PASS older browsers without Web Locks retain best-effort daily counting')

        mock = Mock()
        context = await context_for(browser, mock, script='''
            window.counterVisibility="hidden";
            Object.defineProperty(document,"visibilityState",{get:()=>window.counterVisibility});
        ''')
        page = await context.new_page()
        await page.goto(SITE + '/')
        await page.wait_for_timeout(100)
        assert not mock.calls
        await page.evaluate('window.counterVisibility="visible";document.dispatchEvent(new Event("visibilitychange"))')
        await settle(page, mock, 1)
        await page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
        await page.wait_for_timeout(100)
        assert len(mock.posts) == 1
        await context.close()
        mock = Mock()
        context = await context_for(browser, mock)
        page = await context.new_page()
        await page.goto('https://vansheisinn.github.io/nohrikha-site/index.html')
        await page.wait_for_timeout(100)
        assert not mock.calls and await page.evaluate('localStorage.length') == 0
        await context.close()
        print('PASS hidden preload waits for visibility, technical GitHub Pages host never writes production data')

        for mode in ['down', 'timeout', 'malformed']:
            mock = Mock(mode=mode)
            context = await context_for(browser, mock)
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(SITE + '/contact.html')
            await page.wait_for_timeout(4500 if mode == 'timeout' else 250)
            assert not await page.locator('.visitor-counter').count()
            assert await page.locator('#feedback-form button[type=submit]').is_enabled()
            assert not errors and len(mock.calls) <= 2
            assert await page.evaluate('localStorage.length') == 0
            await context.close()
        print('PASS outages, real fetch timeouts, malformed data: form/navigation survive, no retries or page errors')
        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
