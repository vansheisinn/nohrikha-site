from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
root = Path(__file__).resolve().parents[1]
class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.tags=[]
    def handle_starttag(self, tag, attrs): self.tags.append((tag, dict(attrs)))
for file, lang in [(root/('index.html' if lang=='ru' else f'{"kz" if lang=="kk" else lang}/index.html'),lang) for lang in ['ru','en','de','kk']]:
    p=Page(); p.feed(file.read_text())
    assert ('html',{'lang':lang}) in p.tags
    assert any(t=='meta' and a.get('name')=='robots' and 'noindex' in a['content'] for t,a in p.tags)
    assert {a.get('hreflang') for t,a in p.tags if t=='link' and a.get('rel')=='alternate'} == {'ru','en','de','kk'}
    assert sum(t=='a' and a.get('aria-current')=='page' for t,a in p.tags)==1
    ids=[a['id'] for _,a in p.tags if 'id' in a]
    assert len(ids)==len(set(ids))
    for t,a in p.tags:
        for attr in ['href','src']:
            if attr not in a: continue
            u=urlsplit(a[attr]); assert not u.scheme and not u.netloc, a[attr]
            target=(file.parent/u.path).resolve() if u.path else file
            assert target.is_file(), target
            if u.fragment: assert u.fragment in ids
    assert sum(t=='h1' for t,_ in p.tags)==1
    assert not any(t=='form' and ('action' in a or 'method' in a) for t,a in p.tags)
    assert not any(t=='input' and 'name' in a for t,a in p.tags)
    print(f'PASS {file.relative_to(root)}: language, robots, links, anchors, no form endpoint')
css=(root/'assets/style.css').read_text()
assert css.count('{')==css.count('}')
assert '@media(max-width:640px)' in css and 'prefers-reduced-motion' in css
print('PASS responsive styles and CSS brace balance')
