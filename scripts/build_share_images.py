"""Render the existing home illustration and headings as static sharing cards.

Optional maintainer tool: Python Playwright and Chromium are needed only to
regenerate these JPEGs. GitHub Pages serves the committed files without a build.
No external requests, new artwork or changes to the home pages are involved.
"""
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'share'


class Illustration(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'img' and attrs.get('src', '').startswith('data:image/'):
            self.src = attrs['src']


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1200, 'height': 630},
                                device_scale_factor=1)
        page.route('**/*', lambda route: route.abort())
        for locale, source in [('ru', 'index.html'), ('en', 'en/index.html')]:
            html = (ROOT / source).read_text(encoding='utf-8')
            illustration = Illustration()
            illustration.feed(html)
            brand = re.search(r'<a[^>]*class="brand"[^>]*>(.*?)</a>', html, re.S)[1]
            heading = re.search(r'<h1>(.*?)</h1>', html, re.S)[1]
            page.set_content('''<!doctype html><html lang="''' + locale + '''">
<meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f9f6ef;color:#372f2a;
font-family:Georgia,'Times New Roman',serif}
.card{position:relative;width:1200px;height:630px;overflow:hidden}
.illustration{position:absolute;right:0;top:0;width:438px;height:630px;
object-fit:cover;mix-blend-mode:multiply}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#f9f6ef 57%,transparent 78%)}
.text{position:relative;padding:66px 0 0 66px;width:780px}
.brand{display:flex;align-items:center;gap:16px;font-size:32px;letter-spacing:.16em}
.brand svg{width:35px;height:44px;color:#7d8061}
.rule{width:60px;height:2px;background:#7d8061;margin:52px 0 30px}
h1{font-size:80px;line-height:1.16;font-weight:400;letter-spacing:-.035em;margin:0}
.domain{position:absolute;left:66px;bottom:51px;font:20px Arial,sans-serif;
letter-spacing:.06em;color:#7d786f}
</style><div class="card"><img class="illustration" src="''' + illustration.src + '''">
<div class="fade"></div><div class="text"><div class="brand">''' + brand + '''</div>
<div class="rule"></div><h1>''' + heading + '''</h1></div>
<div class="domain">nohrikha.com</div></div></html>''')
            page.locator('.illustration').evaluate('(image) => image.decode()')
            page.evaluate('document.fonts.ready')
            assert page.locator('h1').evaluate('(e) => e.scrollWidth <= e.clientWidth')
            destination = OUTPUT / f'nohrikha-{locale}-v1.jpg'
            page.screenshot(path=str(destination), type='jpeg', quality=90)
            print('GENERATED', destination.relative_to(ROOT))
        browser.close()


if __name__ == '__main__':
    main()
