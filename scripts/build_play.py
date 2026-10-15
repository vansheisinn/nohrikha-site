"""Embed the authorized Russian source verbatim in both static literary pages.

Edit content/psovaya-ohota.ru.txt only with editorial approval, then run this
script. --check verifies the committed pages are up to date, without writing.
No runtime fetch, JavaScript, dependency installation or site build is required.
"""
import argparse
from html import escape
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
START = '<!-- BEGIN AUTHORIZED PLAY -->'
END = '<!-- END AUTHORIZED PLAY -->'
SOURCE = ROOT / 'content/psovaya-ohota.ru.txt'
SPEAKERS = {
    'Бабушка', 'Старший внук', 'Средний внук', 'Старшая внучка', 'Младшая внучка',
    'Емельян Михайлович', 'Наталья', 'Харитина', 'Анастасия', 'Иван',
    'Павел', 'Анатолий Белоцерковский', 'Голос', 'Антонина', 'Вениамин', 'Екатерина',
}
ACTS = ['Действие первое', 'Действие второе', 'Действие третье']


def render(source):
    result = []
    act, scene = 0, 0
    for line in source.splitlines(keepends=True):
        value = line.removesuffix('\n')
        # Encode trailing whitespace so exact source spacing survives without
        # introducing trailing whitespace into generated HTML source files.
        suffix = re.search(r'[ \t]+$', value)
        if suffix:
            encoded = escape(value[:suffix.start()], quote=False)
            encoded += ''.join('&#32;' if char == ' ' else '&#9;' for char in suffix[0])
        else:
            encoded = escape(value, quote=False)
        if value in ACTS:
            act = ACTS.index(value) + 1
            scene = 0
            encoded = f'<span class="play-act" id="play-act-{act}">{encoded}</span>'
        elif re.fullmatch(r'Явление (первое|второе|третье)\.?', value):
            scene += 1
            encoded = f'<span class="play-scene" id="play-act-{act}-scene-{scene}">{encoded}</span>'
        elif value == 'Лица':
            encoded = f'<span class="play-cast">{encoded}</span>'
        elif value in SPEAKERS or any(value.startswith(name + ' (') for name in SPEAKERS):
            encoded = f'<span class="play-speaker">{encoded}</span>'
        result.append(encoded + ('\n' if line.endswith('\n') else ''))
    return '<div class="play-text" id="play-text" lang="ru">' + ''.join(result) + '</div>'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source = SOURCE.read_text(encoding='utf-8')
    rendered = render(source)
    for prefix, heading in [('', 'Полный текст произведения'), ('en/', 'Original text in Russian')]:
        page = ROOT / (prefix + 'psovaya-ohota.html')
        before = page.read_text(encoding='utf-8')
        section = START + '<section class="play-original" aria-labelledby="play-heading"><h2 id="play-heading">' + heading + '</h2>' + rendered + '</section>' + END
        after, count = re.subn(re.escape(START) + r'.*?' + re.escape(END), lambda _: section, before, flags=re.S)
        if count != 1:
            raise SystemExit(f'{page}: expected one authorized-play marker pair, found {count}')
        if args.check:
            if before != after:
                raise SystemExit(f'{page.relative_to(ROOT)} is stale; run python3 scripts/build_play.py')
        else:
            page.write_text(after, encoding='utf-8')
        print(('CHECK' if args.check else 'GENERATED'), page.relative_to(ROOT))


if __name__ == '__main__':
    main()
