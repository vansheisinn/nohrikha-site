/* Own counter: date-only local storage, coarse sources, aggregate statistics. */
(function () {
  'use strict';
  var config = window.NOHRIKHA_COUNTER;
  if (!config || !config.endpoint || location.origin !== 'https://nohrikha.com') return;
  var endpoint;
  try {
    var url = new URL(config.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return;
    endpoint = url.origin;
  } catch (_) { return; }

  var key = 'nohrikha.counter.lastDay';
  var sources = ['direct', 'google', 'yandex', 'bing', 'telegram', 'whatsapp', 'social', 'other'];
  var english = document.documentElement.lang === 'en';
  var showStats = location.pathname === '/contact.html' || location.pathname === '/en/contact.html';
  var labels = english ? {
    loading: 'Loading statistics…', unavailable: 'Statistics are temporarily unavailable.',
    today: 'Visitors today', total: 'Total page views', days: 'Last 7 days',
    sources: 'Sources · last 30 days', date: 'Date', visitors: 'Visitors', views: 'Views',
    note: 'Approximate figures since the counter was enabled.',
    capped: 'Today’s collection limit has been reached; figures are incomplete.',
    empty: 'No data yet', direct: 'Direct / unknown', google: 'Google', yandex: 'Yandex',
    bing: 'Bing', telegram: 'Telegram', whatsapp: 'WhatsApp', social: 'Social networks', other: 'Other websites'
  } : {
    loading: 'Загрузка статистики…', unavailable: 'Статистика временно недоступна.',
    today: 'Посетителей сегодня', total: 'Всего просмотров', days: 'Последние 7 дней',
    sources: 'Источники · последние 30 дней', date: 'Дата', visitors: 'Посетители', views: 'Просмотры',
    note: 'Приблизительные данные с момента подключения счётчика.',
    capped: 'Достигнут предел подсчёта за сегодня; данные неполные.',
    empty: 'Пока нет данных', direct: 'Прямые / неизвестно', google: 'Google', yandex: 'Яндекс',
    bing: 'Bing', telegram: 'Telegram', whatsapp: 'WhatsApp', social: 'Социальные сети', other: 'Другие сайты'
  };
  var counted = false;
  var widget;
  var statsGeneration = 0;

  function source() {
    // Classify locally; never transmit referrer URLs, query strings or arbitrary labels.
    try {
      var tagged = new URL(location.href).searchParams.get('utm_source');
      if (tagged) {
        tagged = tagged.toLowerCase();
        return sources.indexOf(tagged) !== -1 && tagged !== 'direct' ? tagged : 'other';
      }
      if (!document.referrer) return 'direct';
      var host = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'nohrikha.com' || host === 'nohrikha.org') return 'direct';
      if (/^google\.(com|ru|de|co\.uk|fr|lv|kz)$/.test(host)) return 'google';
      if (/^(?:[^.]+\.)?yandex\.(ru|com|kz|by|uz)$/.test(host) || host === 'ya.ru') return 'yandex';
      if (host === 'bing.com') return 'bing';
      if (host === 't.me' || host === 'telegram.org' || host === 'web.telegram.org') return 'telegram';
      if (host === 'wa.me' || host === 'whatsapp.com' || host === 'web.whatsapp.com') return 'whatsapp';
      if (/^(?:[^.]+\.)?(facebook\.com|instagram\.com|vk\.com|ok\.ru|x\.com|twitter\.com)$/.test(host)) return 'social';
    } catch (_) { return 'direct'; }
    return 'other';
  }

  async function request(path, body) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    try {
      var response = await fetch(endpoint + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'text/plain;charset=UTF-8' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit', referrerPolicy: 'no-referrer',
        keepalive: Boolean(body), signal: controller.signal
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) { return null; }
    finally { clearTimeout(timeout); }
  }

  function number(value) { return Number.isSafeInteger(value) && value >= 0; }
  function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
  function count(value) { return value.toLocaleString(english ? 'en-GB' : 'ru-RU'); }
  function element(tag, text, parent) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  function renderStatus(message, busy) {
    // Keep the last valid figures during a refresh; never replace them with zero.
    if (widget && widget.querySelector('.visitor-counter-panel')) return;
    var footer = document.querySelector('.footerin');
    if (!footer) return;
    if (!widget) {
      widget = element('details', undefined, footer);
      widget.className = 'visitor-counter';
      element('summary', message, widget);
    } else { widget.querySelector('summary').textContent = message; }
    widget.setAttribute('aria-busy', String(busy));
  }

  function render(data) {
    if (!data || !date(data.day) || !data.today || !number(data.today.browsers) ||
      !number(data.totalViews) || !Array.isArray(data.days) || data.days.length !== 7 ||
      !data.days.every(function (row) { return row && date(row.date) && number(row.views) && number(row.browsers); }) ||
      !data.sources || !sources.every(function (name) { return number(data.sources[name]); })) return false;
    var footer = document.querySelector('.footerin');
    if (!footer) return false;
    var wasOpen = Boolean(widget && widget.open);
    if (widget) widget.remove();
    widget = element('details', undefined, footer);
    widget.className = 'visitor-counter';
    widget.open = wasOpen;
    widget.setAttribute('aria-busy', 'false');
    element('summary', labels.today + ': ≈ ' + count(data.today.browsers) + ' · ' +
      labels.total + ': ' + count(data.totalViews), widget);
    var panel = element('div', undefined, widget);
    panel.className = 'visitor-counter-panel';
    var dates = element('div', undefined, panel);
    element('h2', labels.days, dates);
    var table = element('table', undefined, dates);
    var heading = element('tr', undefined, element('thead', undefined, table));
    [labels.date, labels.visitors, labels.views].forEach(function (label) {
      element('th', label, heading).scope = 'col';
    });
    var tbody = element('tbody', undefined, table);
    data.days.slice().reverse().forEach(function (row) {
      var tr = element('tr', undefined, tbody);
      var shown = new Date(row.date + 'T12:00:00Z').toLocaleDateString(english ? 'en-GB' : 'ru-RU', {
        day: 'numeric', month: 'short', timeZone: 'UTC'
      });
      element('th', shown, tr).scope = 'row';
      element('td', count(row.browsers), tr);
      element('td', count(row.views), tr);
    });
    var referrers = element('div', undefined, panel);
    element('h2', labels.sources, referrers);
    var list = element('ul', undefined, referrers);
    sources.slice().sort(function (a, b) { return data.sources[b] - data.sources[a]; })
      .forEach(function (name) {
        if (data.sources[name]) element('li', labels[name] + ': ' + count(data.sources[name]), list);
      });
    if (!list.children.length) element('li', labels.empty, list);
    element('p', labels.note, widget).className = 'visitor-counter-note';
    if (data.capped) element('p', labels.capped, widget).className = 'visitor-counter-note';
    return true;
  }

  async function loadStats() {
    var generation = ++statsGeneration;
    renderStatus(labels.loading, true);
    var data = await request('/stats');
    if (generation !== statsGeneration) return;
    if (!render(data)) renderStatus(labels.unavailable, false);
  }

  async function record() {
    if (counted || document.visibilityState !== 'visible') return;
    counted = true;
    // Read-only statistics must not wait for a slow or failed write request.
    if (showStats) void loadStats();
    var visitorSource = source();
    var challenge = await request('/challenge');
    if (challenge && date(challenge.day) && typeof challenge.token === 'string' && challenge.token.length < 300) {
      async function submit() {
        var first = false;
        try {
          first = localStorage.getItem(key) !== challenge.day;
          if (first) localStorage.setItem(key, challenge.day);
        } catch (_) { first = false; }
        // Claim the day before sending. Do not retry an uncertain commit:
        // a failed request may undercount, but must not create a retry loop.
        await request('/collect', { token: challenge.token, first: first, source: visitorSource });
      }
      if (navigator.locks && navigator.locks.request) {
        try { await navigator.locks.request(key, submit); } catch (_) { /* fail closed */ }
      } else { await submit(); }
    }
  }

  document.addEventListener('visibilitychange', function () { void record(); });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) { counted = false; void record(); }
  });
  void record();
})();
