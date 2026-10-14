"""Static checks adapted from PR #1 for main's four-page design."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PAGES = ['index.html', 'stories.html', 'timeline.html', 'contact.html']
LOCALES = {'': 'ru', 'en': 'en', 'de': 'de', 'kz': 'kk'}

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags = []
        self.text = []
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
    def handle_data(self, data):
        if data.strip():
            self.text.append(data.strip())

files = {f: Page(f.read_text()) for f in ROOT.rglob('*.html') if '.git' not in f.parts}
assert len(files) == 16
for file, page in files.items():
    folder = file.parent.relative_to(ROOT).as_posix()
    lang = LOCALES['' if folder == '.' else folder]
    assert any(t == 'html' and a.get('lang') == lang for t, a in page.tags), file
    robots = [a for t, a in page.tags if t == 'meta' and a.get('name') == 'robots']
    assert len(robots) == 1 and {'noindex', 'nofollow'} <= set(robots[0]['content'].split(', ')), file
    alternates = [a for t, a in page.tags if t == 'link' and a.get('rel') == 'alternate']
    assert {a['hreflang'] for a in alternates} == {'ru', 'en', 'de', 'kk', 'x-default'}, file
    ids = [a['id'] for _, a in page.tags if 'id' in a]
    assert len(ids) == len(set(ids)), file
    assert sum(t == 'h1' for t, _ in page.tags) == 1, file
    assert any(t == 'a' and a.get('aria-current') == 'page' for t, a in page.tags), file
    current_language = [a for t, a in page.tags if t == 'a' and a.get('aria-current') == 'true']
    assert len(current_language) == 1 and current_language[0]['hreflang'] == lang, file
    assert not any(t == 'form' for t, _ in page.tags), file
    for t, a in page.tags:
        for attr in ['href', 'src']:
            if attr not in a:
                continue
            u = urlsplit(a[attr])
            if u.scheme or u.netloc:
                continue
            target = (file.parent / unquote(u.path)).resolve() if u.path else file
            assert target.is_relative_to(ROOT) and target.is_file(), (file, a[attr])
            if u.fragment:
                assert any(b.get('id') == unquote(u.fragment) for _, b in files[target].tags), (file, a[attr])
        if t == 'link' and a.get('rel') == 'alternate':
            target = (file.parent / a['href']).resolve()
            target_lang = 'ru' if a['hreflang'] == 'x-default' else a['hreflang']
            assert target.name == file.name, (file, a)
            assert any(t2 == 'html' and b.get('lang') == target_lang for t2, b in files[target].tags)
    if lang in ['de', 'kk']:
        assert any(t == 'main' and a.get('lang') == 'en' for t, a in page.tags), file
    print('PASS', file.relative_to(ROOT))

# Every original RU/EN text node outside navigation is retained, in order.
for folder in ['', 'en']:
    for name in PAGES:
        path = '/'.join(filter(None, [folder, name]))
        before = subprocess.check_output(['git', 'show', '7ffaf769e2104292a5b95c6a45fcd6f723f98c2f:' + path], cwd=ROOT, text=True)
        original = Page(before)
        after = iter(files[ROOT / path].text)
        for text in original.text:
            assert any(candidate == text for candidate in after), ('Original text lost', path, text)
        original_images = [a['src'] for t, a in original.tags if t == 'img']
        current_images = [a['src'] for t, a in files[ROOT / path].tags if t == 'img']
        assert original_images == current_images, path
assert (ROOT / 'main.js').read_text() == subprocess.check_output(['git', 'show', '7ffaf769:main.js'], cwd=ROOT, text=True)
assert 'Sitemap:' not in (ROOT / 'robots.txt').read_text()
assert not (ROOT / 'CNAME').exists()
assert 'Disallow: /' not in (ROOT / 'robots.txt').read_text()
print('PASS original RU/EN text and images preserved, main.js unchanged, indexing and domain safeguards')
