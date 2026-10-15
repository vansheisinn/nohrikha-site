"""Approved RU/EN paragraph integrity, attribution, literary links and privacy."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
# Digests of normalized heading + all paragraphs from the approved package.
APPROVED = {('ru', 'my-story'): '3872df86d367dd670a222e68bc4fe58ce6d12c30c108a1b74483cff808b17b84', ('ru', 'second-story'): '535f4b55b0b8ac46f517a8ebe023e4b6921b98387c6486956ae4f9a852fbc710', ('en', 'my-story'): 'd71973e743ec50fdde46170021238f67b92f36106cdacec9faf05da8c4ba2e38', ('en', 'second-story'): '81511d27ff60c132a8c5c52f6589c9858a1717b879191714bd2dd69c8970ac93'}

class Blocks(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.blocks = []
        self.collect = False
        self.value = []
        self.links = []
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ['p', 'h2']:
            self.collect = attrs.get('class') != 'tag'
            self.value = []
        if tag == 'a':
            self.links.append(attrs['href'])
    def handle_data(self, text):
        if self.collect:
            self.value.append(text)
    def handle_endtag(self, tag):
        if tag in ['p', 'h2'] and self.collect:
            self.blocks.append(' '.join(''.join(self.value).split()))
            self.collect = False

for lang, prefix in [('ru', ''), ('en', 'en/')]:
    text = (ROOT / (prefix + 'stories.html')).read_text()
    for identifier in ['my-story', 'second-story']:
        section = re.search(r'<section class="article-block" id="' + identifier + r'">(.*?)</section>', text, re.S)[1]
        page = Blocks(section)
        digest = sha256('\n\n'.join(page.blocks).encode()).hexdigest()
        assert digest == APPROVED[(lang, identifier)], ('Approved text changed', lang, identifier, digest)
        assert 'psovaya-ohota.html' in page.links, (lang, identifier)
    expected = ['Жанны Дроздовской', 'Куртукова', 'Павла Чернова', 'Ирине Петровне Островной'] if lang == 'ru' else ['Zhanna Drozdovskaya', 'Kurtukova', 'Pavel Chernov', 'Irina Petrovna Ostrovnaya']
    assert all(name in text for name in expected), lang
    page = (ROOT / (prefix + 'psovaya-ohota.html')).read_text()
    assert '116072602762' in page
    for target in ['stories.html#my-story', 'stories.html#second-story', 'https://stihi.ru/2016/07/26/2762']:
        assert 'href="' + target + '"' in page
    for metadata in ['rel="canonical"', 'property="og:title"', 'property="og:description"', 'property="og:url"']:
        assert metadata in page
    # Full play is unavailable: don't mislabel this introduction as its full text.
    assert not any(marker in page for marker in ['Полный текст произведения', 'The published website must', 'Сюда в готовой версии'])
    if lang == 'en':
        assert 'Original text in Russian' in page
    print('PASS', lang, 'approved story paragraphs, names, contextual play links and introductory page metadata')

for file in ROOT.rglob('*.html'):
    text = file.read_text()
    assert not re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', text), ('Private email in HTML', file)
    assert 'mailto:' not in text and 'tel:' not in text, file
sitemap = ET.parse(ROOT / 'sitemap.xml')
urls = [e.text for e in sitemap.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
assert len(urls) == len(set(urls))
for suffix in ['/psovaya-ohota.html', '/en/psovaya-ohota.html']:
    assert any(url.endswith(suffix) for url in urls)
assert 'Контакт деда с Нохрихой не доказан' in (ROOT / 'timeline.html').read_text()
assert 'does not imply that my grandfather met Nohrikha personally' in (ROOT / 'en/timeline.html').read_text()
print('PASS sitemap, no published email/phone links, chronological uncertainty preserved')
print('NOT VERIFIED: complete play text; source fetch returned HTTP 403, full text absent from editorial package')
