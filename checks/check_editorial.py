"""Approved RU/EN paragraph integrity, attribution, literary links and privacy."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
# Digests of normalized heading + all paragraphs from the approved package,
# including subsequent wording changes explicitly approved by the owner.
APPROVED = {('ru', 'my-story'): 'c5bf43d72a5ee46ead3fdfa2579736272b16337ac265859a95b6f7923406c3b8', ('ru', 'second-story'): 'f61dc26025b5a5bd71bfa0a4e9a28eb202de93642ec11313a9cf9998729a78c1', ('en', 'my-story'): 'd2ed337394a42a103129113ab8ea16f281d731a1c7cb8302b59dfc1abecfd545', ('en', 'second-story'): '2bd93c2a16010188e1dd10aefa923c8a625e8339b4c58dd7d7bad420d5ec9fab'}

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


class PlaySource(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.depth = 0
        self.parts = []
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        if dict(attrs).get('id') == 'play-text':
            self.depth = 1
        elif self.depth:
            self.depth += 1
    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)

source = (ROOT / 'content/psovaya-ohota.ru.txt').read_text(encoding='utf-8')
# Integrity baseline for the exact source supplied by the owner, including spaces.
assert sha256(source.encode()).hexdigest() == '3c73f236ee4f65b4b702fdc20d85ff3285cbf2f22c5bc73bc304dcc173358b70'
assert re.findall(r'^Действие (?:первое|второе|третье)$', source, re.M) == ['Действие первое', 'Действие второе', 'Действие третье']
assert len(re.findall(r'^Явление (?:первое|второе|третье)\.?$', source, re.M)) == 8
assert source.endswith('Звонит в колокольчик.\n\nЗанавес.\n')

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
    assert not any(marker in page for marker in ['The published website must', 'Сюда в готовой версии'])
    assert 'lang="ru"' in page
    assert ''.join(PlaySource(page).parts) == source, ('Play differs from authorized source', lang)
    assert page.count('class="play-act"') == 3 and page.count('class="play-scene"') == 8
    for act in range(1, 4):
        assert f'href="#play-act-{act}"' in page
    assert 'Original text in Russian' in page if lang == 'en' else 'Полный текст произведения' in page
    if lang == 'en':
        assert 'Original text in Russian' in page
    print('PASS', lang, 'approved story paragraphs, names, contextual play links, complete verbatim play and page metadata')

for file in ROOT.rglob('*.html'):
    if {'.git', 'node_modules', '.wrangler'} & set(file.parts):
        continue
    text = file.read_text()
    assert not re.search(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', text), ('Private email in HTML', file)
    assert 'mailto:' not in text and 'tel:' not in text, file
sitemap = ET.parse(ROOT / 'sitemap.xml')
urls = [e.text for e in sitemap.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
assert len(urls) == len(set(urls))
for suffix in ['/psovaya-ohota.html', '/en/psovaya-ohota.html']:
    assert any(url.endswith(suffix) for url in urls)
assert 'Контакт деда с Нохрихой не доказан' in (ROOT / 'timeline.html').read_text()
assert 'A direct meeting is unconfirmed' in (ROOT / 'en/timeline.html').read_text()
print('PASS sitemap, no published email/phone links, chronological uncertainty preserved')
print('PASS exact play source: 3 acts, 8 scenes, all line breaks and spacing preserved in RU/EN HTML')
