"""Static checks adapted from PR #1 for main's four-page design."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PAGES = ['index.html', 'stories.html', 'timeline.html', 'contact.html', 'psovaya-ohota.html']
LOCALES = {'': 'ru', 'en': 'en'}

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
assert set(files) == {ROOT / folder / name for folder in LOCALES for name in PAGES}
assert not (ROOT / 'de').exists() and not (ROOT / 'kz').exists()
for file, page in files.items():
    folder = file.parent.relative_to(ROOT).as_posix()
    lang = LOCALES['' if folder == '.' else folder]
    assert any(t == 'html' and a.get('lang') == lang for t, a in page.tags), file
    robots = [a for t, a in page.tags if t == 'meta' and a.get('name') == 'robots']
    assert len(robots) == 1 and {'noindex', 'nofollow'} <= set(robots[0]['content'].split(', ')), file
    alternates = [a for t, a in page.tags if t == 'link' and a.get('rel') == 'alternate']
    expected_languages = {'ru', 'en', 'x-default'}
    assert {a['hreflang'] for a in alternates} == expected_languages, file
    ids = [a['id'] for _, a in page.tags if 'id' in a]
    assert len(ids) == len(set(ids)), file
    assert sum(t == 'h1' for t, _ in page.tags) == 1, file
    assert any(t == 'a' and a.get('aria-current') == 'page' for t, a in page.tags), file
    current_language = [a for t, a in page.tags if t == 'a' and a.get('aria-current') == 'true']
    assert len(current_language) == 1 and current_language[0]['hreflang'] == lang, file
    language_links = [a for t, a in page.tags if t == 'a' and 'hreflang' in a]
    assert len(language_links) == 2 and {a['hreflang'] for a in language_links} == {'ru', 'en'}, file
    forms = [a for t, a in page.tags if t == 'form']
    assert len(forms) == (1 if file.name == 'contact.html' else 0), file
    assert any(t == 'a' and a.get('href') == 'https://t.me/nohrikha' for t, a in page.tags), file
    if forms:
        assert forms[0].get('method') == 'post' and 'action' not in forms[0], file
        assert forms[0].get('onsubmit') == 'return false', file
        assert any(t == 'fieldset' and 'disabled' in a for t, a in page.tags), file
        inputs = {a.get('name'): a for t, a in page.tags if t in ['input', 'textarea']}
        assert 'required' in inputs['name'] and 'required' in inputs['email'], file
        assert 'required' in inputs['message'] and 'required' in inputs['consent'], file
        assert inputs['message']['maxlength'] == '10000', file
        assert inputs['_gotcha']['tabindex'] == '-1', file
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
            alternate_url = urlsplit(a['href'])
            assert alternate_url.scheme == 'https' and alternate_url.netloc == 'nohrikha.com', (file, a)
            target = (ROOT / unquote(alternate_url.path.lstrip('/'))).resolve()
            target_lang = 'ru' if a['hreflang'] == 'x-default' else a['hreflang']
            assert target.name == file.name, (file, a)
            assert any(t2 == 'html' and b.get('lang') == target_lang for t2, b in files[target].tags)
    print('PASS', file.relative_to(ROOT))

# Keep existing home illustrations unchanged. Approved editorial replacements
# and literary links are covered by check_editorial.py.
for folder in ['', 'en']:
    path = '/'.join(filter(None, [folder, 'index.html']))
    before = Page(subprocess.check_output(['git', 'show', 'f3f0179:' + path], cwd=ROOT, text=True))
    assert [a['src'] for t, a in before.tags if t == 'img'] == [a['src'] for t, a in files[ROOT / path].tags if t == 'img']
assert (ROOT / 'main.js').read_text() == subprocess.check_output(['git', 'show', '7ffaf769:main.js'], cwd=ROOT, text=True)
assert 'Sitemap:' not in (ROOT / 'robots.txt').read_text()
assert (ROOT / 'CNAME').read_text().strip() == 'nohrikha.com'
assert 'Disallow: /' not in (ROOT / 'robots.txt').read_text()
sitemap_urls = [e.text for e in ET.parse(ROOT / 'sitemap.xml').iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
canonical_urls = {a['href'] for page in files.values() for t, a in page.tags if t == 'link' and a.get('rel') == 'canonical'}
assert len(sitemap_urls) == len(files) and set(sitemap_urls) == canonical_urls
assert all(urlsplit(url).scheme == 'https' and urlsplit(url).netloc == 'nohrikha.com' for url in canonical_urls)
for page in files.values():
    canonical = next(a['href'] for t, a in page.tags if t == 'link' and a.get('rel') == 'canonical')
    assert any(t == 'meta' and a.get('property') == 'og:url' and a.get('content') == canonical for t, a in page.tags)
print('PASS original home images preserved, main.js unchanged, indexing and domain safeguards')
