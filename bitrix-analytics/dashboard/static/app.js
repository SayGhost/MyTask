/* Дашборд: интерфейс и графики (чистый SVG, без внешних библиотек и обращений в интернет). */
(function () {
  'use strict';
  const M = window.Metrics;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (sel) => document.querySelector(sel);

  // ---------- вспомогательное ----------
  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }
  function s(tag, attrs, ...children) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }
  const nfInt = new Intl.NumberFormat('ru-RU');
  const fmtInt = (n) => nfInt.format(n);
  const fmtPct = (r) => (r == null ? '—' : (r * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%');
  const dfDay = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const dfShort = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
  const dfMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const dfMonthShort = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short', year: '2-digit' });
  const D = (str) => new Date(str + 'T00:00:00Z');

  function bucketTitle(start, gran) {
    if (gran === 'day') return dfDay.format(D(start));
    if (gran === 'month') return dfMonth.format(D(start));
    return 'Неделя ' + dfShort.format(D(start)) + ' – ' + dfShort.format(D(M.addDays(start, 6)));
  }
  function bucketLabel(start, gran) {
    return gran === 'month' ? dfMonthShort.format(D(start)) : dfShort.format(D(start));
  }

  function niceStep(rough) {
    const p = Math.pow(10, Math.floor(Math.log10(rough)));
    const m = rough / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  /** Деления оси: 0..max с «круглым» шагом. */
  function axis(max, want) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    const step = niceStep(max / want);
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { max: top, ticks };
  }

  // ---------- подсказка ----------
  const tip = $('#tip');
  function showTip(title, rows, x, y) {
    tip.replaceChildren(h('div', { class: 't', text: title }));
    for (const r of rows) {
      const row = h('div', { class: 'r' });
      if (r.key) {
        const k = h('span', { class: 'key ' + r.key });
        row.append(k);
      }
      const label = h('span', { class: 'l', text: r.label });
      if (r.sub) label.append(h('span', { class: 's', text: r.sub }));
      row.append(label, h('span', { class: 'v', text: r.value }));
      tip.append(row);
    }
    tip.style.display = 'block';
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + hgt > window.innerHeight - 8) top = y - hgt - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }
  /** Подсказка для клавиатуры: у элемента, а не у курсора. */
  function tipAtElement(el, title, rows) {
    const r = el.getBoundingClientRect();
    showTip(title, rows, r.left + r.width / 2, r.top);
  }

  // ---------- состояние ----------
  const state = {
    all: [], meta: null, from: null, to: null, preset: 'all',
    sources: null, // null = все; иначе Set
    onlyNew: true, gran: 'auto', sort: { key: 'deals', dir: -1 }, tableView: { count: false, rates: false, qualmc: false },
    sourceCounts: [],
  };
  let current = null; // результат последнего расчёта для перерисовки при resize

  // ---------- расчёт ----------
  function compute() {
    const deals = M.filterDeals(state.all, { from: state.from, to: state.to, sources: state.sources, onlyNew: state.onlyNew });
    const totals = M.summarize(deals);
    const gran = state.gran === 'auto' ? M.autoGranularity(state.from, state.to) : state.gran;
    current = {
      deals, totals, rates: M.rates(totals), gran,
      series: M.series(deals, gran, state.from, state.to),
      sources: M.bySource(deals),
    };
    return current;
  }

  // ---------- KPI ----------
  function renderKpis(c) {
    const t = c.totals, r = c.rates;
    // note: текст до, выделенное жирным и текст после
    const tiles = [
      { cls: 'hero', label: state.onlyNew ? 'Новые сделки' : 'Сделки', value: fmtInt(t.deals), note: ['', '', 'созданы в выбранном периоде'] },
      { label: 'Посмотрели вебинар', value: fmtInt(t.webinar), note: ['доходимость ', fmtPct(r.webinarRate), ''] },
      { label: 'Дозвонились', value: fmtInt(t.reached), note: ['', fmtPct(r.reachedRate), ' от сделок'] },
      { label: 'Квалы', value: fmtInt(t.qual), note: ['', fmtPct(r.qualRate), ' от сделок'] },
      { label: 'МС назначено', value: fmtInt(t.mc), note: ['', fmtPct(r.mcRate), ' от сделок'] },
      { label: 'Квал → МС', value: fmtPct(r.qualToMc), note: ['', fmtInt(t.qualMc), ' из ' + fmtInt(t.qual) + ' квалов'] },
    ];
    $('#kpis').replaceChildren(...tiles.map((x) => {
      const [pre, strong, post] = x.note;
      const note = h('div', { class: 'note' });
      if (pre) note.append(pre);
      if (strong) note.append(h('strong', { text: strong }));
      if (post) note.append(post);
      return h('div', { class: 'tile ' + (x.cls || '') }, h('div', { class: 'label', text: x.label }), h('div', { class: 'value', text: x.value }), note);
    }));
  }

  // ---------- воронка (горизонтальные столбцы) ----------
  function barPathRight(x, y, w, hgt, r) {
    r = Math.min(r, w, hgt / 2);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
  }
  function renderFunnel(c) {
    const box = $('#funnel');
    if (!c.totals.deals) return empty(box);
    const t = c.totals;
    const rows = [
      { name: state.onlyNew ? 'Новые сделки' : 'Сделки', n: t.deals, share: 1 },
      { name: 'Посмотрели вебинар', n: t.webinar, share: c.rates.webinarRate },
      { name: 'Дозвонились', n: t.reached, share: c.rates.reachedRate },
      { name: 'Квалы', n: t.qual, share: c.rates.qualRate },
      { name: 'МС назначено', n: t.mc, share: c.rates.mcRate },
    ];
    const W = Math.max(box.clientWidth, 240), narrow = W < 460;
    const rowH = narrow ? 62 : 44, barH = 24, labelW = narrow ? 0 : Math.min(170, W * 0.38), valueW = 120;
    const area = Math.max(W - labelW - valueW, 40);
    const svg = s('svg', { viewBox: `0 0 ${W} ${rows.length * rowH}`, role: 'img', 'aria-label': 'Этапы: ' + rows.map((r) => `${r.name} ${fmtInt(r.n)}`).join(', ') });
    rows.forEach((r, i) => {
      const y = i * rowH + (narrow ? 24 : (rowH - barH) / 2);
      const w = r.n > 0 ? Math.max((r.n / t.deals) * area, 2) : 0;
      const g = s('g');
      g.append(s('text', { x: 0, y: narrow ? y - 8 : y + barH / 2 + 4, class: 'name', text: r.name }));
      if (w) g.append(s('path', { d: barPathRight(labelW, y, w, barH, 4), class: 'bar' }));
      g.append(s('text', { x: labelW + w + 8, y: y + barH / 2 + 4, class: 'strong', text: `${fmtInt(r.n)} · ${fmtPct(r.share)}` }));
      const hit = s('rect', { x: 0, y: i * rowH, width: W, height: rowH, class: 'hit', tabindex: 0, 'aria-label': `${r.name}: ${fmtInt(r.n)}, ${fmtPct(r.share)} от сделок` });
      const rowsTip = [{ label: 'Сделок', value: fmtInt(r.n) }, { label: 'Доля от сделок', value: fmtPct(r.share) }];
      if (r.name === 'МС назначено') rowsTip.push({ label: 'Из квалов в МС', value: fmtPct(c.rates.qualToMc), sub: `${fmtInt(t.qualMc)} из ${fmtInt(t.qual)}` });
      hit.addEventListener('pointermove', (e) => { g.classList.add('on'); showTip(r.name, rowsTip, e.clientX, e.clientY); });
      hit.addEventListener('pointerleave', () => { g.classList.remove('on'); hideTip(); });
      hit.addEventListener('focus', () => { g.classList.add('on'); tipAtElement(hit, r.name, rowsTip); });
      hit.addEventListener('blur', () => { g.classList.remove('on'); hideTip(); });
      g.append(hit);
      svg.append(g);
    });
    box.replaceChildren(svg);
  }

  // ---------- общая сетка осей ----------
  function plotFrame(W, H, ax, fmtTick) {
    const m = { l: 44, r: 12, t: 8, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const y = (v) => m.t + ph - (v / ax.max) * ph;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
    for (const tck of ax.ticks) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(tck), y2: y(tck), class: tck === 0 ? 'axisline' : 'gridline' }));
      svg.append(s('text', { x: m.l - 8, y: y(tck) + 4, 'text-anchor': 'end', text: fmtTick(tck) }));
    }
    return { svg, m, pw, ph, y };
  }
  function xLabels(svg, frame, buckets, gran) {
    const band = frame.pw / buckets.length;
    const every = Math.max(1, Math.ceil(46 / band));
    buckets.forEach((b, i) => {
      if (i % every) return;
      svg.append(s('text', { x: frame.m.l + band * (i + 0.5), y: frame.m.t + frame.ph + 18, 'text-anchor': 'middle', text: bucketLabel(b.start, gran) }));
    });
  }

  // ---------- динамика: количество сделок ----------
  function barTop(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  function renderTrendCount(c) {
    const box = $('#trend-count');
    if (!c.totals.deals) return empty(box);
    if (state.tableView.count) return renderTrendTable(box, c, ['deals', 'webinar', 'reached', 'qual', 'mc'], ['Сделок', 'Вебинар', 'Дозвон', 'Квалы', 'МС']);
    const W = Math.max(box.clientWidth, 280), H = 260;
    const ax = axis(Math.max(...c.series.map((b) => b.deals)), 4);
    const f = plotFrame(W, H, ax, fmtInt);
    xLabels(f.svg, f, c.series, c.gran);
    const band = f.pw / c.series.length, bw = Math.min(24, Math.max(band - 2, 2));
    c.series.forEach((b, i) => {
      const cx = f.m.l + band * (i + 0.5), top = f.y(b.deals), hgt = f.m.t + f.ph - top;
      const g = s('g');
      const title = bucketTitle(b.start, c.gran);
      const rows = [
        { label: 'Сделок', value: fmtInt(b.deals) },
        { label: 'Посмотрели вебинар', value: fmtInt(b.webinar), sub: fmtPct(b.webinarRate) },
        { label: 'Дозвонились', value: fmtInt(b.reached), sub: fmtPct(b.reachedRate) },
        { label: 'Квалы', value: fmtInt(b.qual), sub: fmtPct(b.qualRate) },
        { label: 'МС назначено', value: fmtInt(b.mc), sub: fmtPct(b.mcRate) },
      ];
      const hit = s('rect', { x: cx - band / 2, y: f.m.t, width: band, height: f.ph, class: 'hit', tabindex: 0, 'aria-label': `${title}: ${fmtInt(b.deals)} сделок` });
      hit.addEventListener('pointermove', (e) => { g.classList.add('on'); showTip(title, rows, e.clientX, e.clientY); });
      hit.addEventListener('pointerleave', () => { g.classList.remove('on'); hideTip(); });
      hit.addEventListener('focus', () => { g.classList.add('on'); tipAtElement(hit, title, rows); });
      hit.addEventListener('blur', () => { g.classList.remove('on'); hideTip(); });
      g.append(hit);
      if (b.deals > 0) g.append(s('path', { d: barTop(cx - bw / 2, top, bw, hgt, 4), class: 'bar' }));
      f.svg.append(g);
    });
    f.svg.setAttribute('role', 'img');
    f.svg.setAttribute('aria-label', 'Количество сделок по периодам, подробности в таблице');
    box.replaceChildren(f.svg);
  }

  // ---------- динамика: конверсии (линии) ----------
  const RATES = [
    { key: 'webinarRate', label: 'Доходимость', cls: '1', num: 'webinar', den: 'deals', denText: 'сделок' },
    { key: 'qualRate', label: 'Квалы от сделок', cls: '2', num: 'qual', den: 'deals', denText: 'сделок' },
    { key: 'mcRate', label: 'МС от сделок', cls: '3', num: 'mc', den: 'deals', denText: 'сделок' },
  ];
  const QUAL_MC = [{ key: 'qualToMc', label: 'Квал → МС', cls: '1', num: 'qualMc', den: 'qual', denText: 'квалов', minDen: 10 }];

  function renderRatesLegend() {
    $('#rates-legend').replaceChildren(...RATES.map((r) => h('span', {}, h('i', { class: 'k' + r.cls }), r.label)));
  }
  /** Линейный график долей. Точка скрыта, если знаменатель меньше minDen (или нуля). */
  function renderLines(box, defs, c, ariaLabel) {
    const value = (b, r) => (b[r.den] >= (r.minDen || 1) ? b[r.key] : null);
    if (!c.series.some((b) => defs.some((r) => value(b, r) != null))) {
      const need = Math.max(...defs.map((r) => r.minDen || 1));
      return box.replaceChildren(h('div', { class: 'empty', text: `В каждом периоде меньше ${need} квалов. Выберите более крупный шаг (по неделям или по месяцам) или шире период.` }));
    }
    const W = Math.max(box.clientWidth, 280), H = 280;
    const peak = Math.max(0.05, ...c.series.flatMap((b) => defs.map((r) => value(b, r) || 0)));
    const ax = axis(Math.min(peak, 1) * 100, 4);
    const f = plotFrame(W, H, ax, (v) => v + '%');
    xLabels(f.svg, f, c.series, c.gran);
    const band = f.pw / c.series.length;
    const cx = (i) => f.m.l + band * (i + 0.5);
    const yv = (r) => f.y(r * 100);

    const ends = [];
    for (const r of defs) {
      let d = '', pen = false, last = -1, drawn = 0;
      c.series.forEach((b, i) => {
        const v = value(b, r);
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${yv(v).toFixed(1)}`;
        pen = true; last = i; drawn++;
      });
      if (d) f.svg.append(s('path', { d, class: 'line s' + r.cls }));
      if (last >= 0) {
        f.svg.append(s('circle', { cx: cx(last), cy: yv(value(c.series[last], r)), r: 4, class: 'dot f' + r.cls }));
        ends.push({ r, y: yv(value(c.series[last], r)) });
      }
    }
    // Подписи концов линий, только если не наезжают друг на друга (иначе работает легенда и подсказка)
    ends.sort((a, b) => a.y - b.y);
    if (defs.length > 1 && ends.length === defs.length && ends.every((e, i) => i === 0 || e.y - ends[i - 1].y >= 16) && W > 420) {
      for (const e of ends) f.svg.append(s('text', { x: W - f.m.r - 2, y: e.y - 8, 'text-anchor': 'end', class: 'name', text: e.r.label }));
    }

    const cross = s('line', { y1: f.m.t, y2: f.m.t + f.ph, class: 'crosshair', visibility: 'hidden' });
    const dots = defs.map((r) => s('circle', { r: 4, class: 'dot f' + r.cls, visibility: 'hidden' }));
    f.svg.append(cross, ...dots);

    const hit = s('rect', { x: f.m.l, y: f.m.t, width: f.pw, height: f.ph, class: 'hit', tabindex: 0, 'aria-label': ariaLabel + ', подробности в таблице' });
    let focusIdx = c.series.length - 1;
    const at = (i, px, py, byKeyboard) => {
      const b = c.series[i];
      cross.setAttribute('x1', cx(i)); cross.setAttribute('x2', cx(i)); cross.setAttribute('visibility', 'visible');
      defs.forEach((r, k) => {
        const v = value(b, r);
        if (v == null) return dots[k].setAttribute('visibility', 'hidden');
        dots[k].setAttribute('cx', cx(i)); dots[k].setAttribute('cy', yv(v)); dots[k].setAttribute('visibility', 'visible');
      });
      const rows = defs.map((r) => {
        const v = value(b, r);
        const sub = v != null ? `${fmtInt(b[r.num])} из ${fmtInt(b[r.den])} ${r.denText}` : b[r.den] ? `мало данных: ${fmtInt(b[r.den])} ${r.denText}` : 'нет данных';
        return { key: 'k' + r.cls, label: r.label, value: fmtPct(v), sub };
      });
      if (byKeyboard) tipAtElement(hit, bucketTitle(b.start, c.gran), rows);
      else showTip(bucketTitle(b.start, c.gran), rows, px, py);
    };
    const off = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); };
    hit.addEventListener('pointermove', (e) => {
      const rect = hit.getBoundingClientRect();
      const i = Math.min(c.series.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * c.series.length)));
      at(i, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', off);
    hit.addEventListener('focus', () => at(focusIdx, 0, 0, true));
    hit.addEventListener('blur', off);
    hit.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      focusIdx = Math.min(c.series.length - 1, Math.max(0, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
      at(focusIdx, 0, 0, true);
    });
    f.svg.append(hit);
    f.svg.setAttribute('role', 'img');
    f.svg.setAttribute('aria-label', ariaLabel);
    box.replaceChildren(f.svg);
  }
  function renderTrendRates(c) {
    const box = $('#trend-rates');
    if (!c.totals.deals) return empty(box);
    if (state.tableView.rates) return renderTrendTable(box, c, RATES.map((r) => r.key), RATES.map((r) => r.label), true);
    renderLines(box, RATES, c, 'Конверсии от сделок по периодам: доходимость, квалы, МС');
  }
  function renderTrendQualMc(c) {
    const box = $('#trend-qualmc');
    if (!c.totals.qual) return empty(box);
    if (state.tableView.qualmc) {
      const rows = c.series.map((b) => ({ ...b, qualToMcShown: b.qual >= QUAL_MC[0].minDen ? b.qualToMc : null }));
      return renderTrendTable(box, { ...c, series: rows }, ['qual', 'qualMc', 'qualToMcShown'], ['Квалы', 'Квал и МС', 'Квал → МС']);
    }
    renderLines(box, QUAL_MC, c, 'Квал → МС по периодам');
  }

  // ---------- таблица вместо графика (доступность) ----------
  function renderTrendTable(box, c, keys, titles, percent) {
    const isPct = (k) => percent || /Rate$|^qualToMc/.test(k);
    const thead = h('thead', {}, h('tr', {}, h('th', { text: 'Период' }), ...titles.map((t) => h('th', { text: t }))));
    const tbody = h('tbody', {}, ...c.series.map((b) => h('tr', {}, h('td', { text: bucketTitle(b.start, c.gran) }), ...keys.map((k) => h('td', { text: isPct(k) ? fmtPct(b[k]) : fmtInt(b[k]) })))));
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {}, thead, tbody)));
  }

  function empty(box) {
    box.replaceChildren(h('div', { class: 'empty', text: 'Нет сделок за выбранный период и фильтры' }));
  }

  // ---------- таблица источников ----------
  const SRC_COLS = [
    { key: 'source', title: 'Источник', fmt: (r) => r.source },
    { key: 'deals', title: 'Сделок', fmt: (r) => fmtInt(r.deals) },
    { key: 'webinar', title: 'Вебинар', fmt: (r) => fmtInt(r.webinar) },
    { key: 'webinarRate', title: 'Доходимость', fmt: (r) => fmtPct(r.webinarRate) },
    { key: 'reached', title: 'Дозвонились', fmt: (r) => fmtInt(r.reached) },
    { key: 'qual', title: 'Квалы', fmt: (r) => fmtInt(r.qual) },
    { key: 'mc', title: 'МС', fmt: (r) => fmtInt(r.mc) },
    { key: 'qualToMc', title: 'Квал → МС', fmt: (r) => fmtPct(r.qualToMc) },
  ];
  function renderSourceTable(c) {
    const box = $('#source-table');
    if (!c.sources.length) return empty(box);
    const { key, dir } = state.sort;
    const rows = [...c.sources].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // «нет данных» всегда в конце
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv, 'ru') : av - bv;
      return cmp * dir || b.deals - a.deals;
    });
    const total = { source: 'Итого', ...c.totals, ...c.rates };
    const head = h('tr', {}, ...SRC_COLS.map((col) => {
      const th = h('th', { scope: 'col', 'aria-sort': key === col.key ? (dir > 0 ? 'ascending' : 'descending') : 'none' });
      const btn = h('button', { type: 'button', text: col.title });
      btn.addEventListener('click', () => {
        state.sort = { key: col.key, dir: state.sort.key === col.key ? -state.sort.dir : (col.key === 'source' ? 1 : -1) };
        renderSourceTable(current);
      });
      th.append(btn);
      return th;
    }));
    const body = h('tbody', {}, ...rows.map((r) => h('tr', {}, ...SRC_COLS.map((col) => h('td', { text: col.fmt(r) })))));
    const foot = h('tfoot', {}, h('tr', {}, ...SRC_COLS.map((col) => h('td', { text: col.fmt(total) }))));
    box.replaceChildren(h('table', {}, h('thead', {}, head), body, foot));
  }

  // ---------- фильтры ----------
  function setRange(from, to, preset) {
    state.from = from; state.to = to; state.preset = preset;
    $('#from').value = from; $('#to').value = to;
    for (const b of document.querySelectorAll('#presets button')) b.setAttribute('aria-pressed', String(b.dataset.preset === preset));
    render();
  }
  function applyPreset(p) {
    const end = state.meta.dateMax, start = state.meta.dateMin;
    if (p === 'all') return setRange(start, end, p);
    if (p === 'month') return setRange(end.slice(0, 7) + '-01', end, p);
    const days = Number(p);
    const from = M.addDays(end, -(days - 1));
    return setRange(from < start ? start : from, end, p);
  }
  function renderSourceFilter() {
    const list = $('#sources-list');
    list.replaceChildren(...state.sourceCounts.map(([name, n]) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !state.sources || state.sources.has(name);
      cb.addEventListener('change', () => {
        const next = new Set(state.sources || state.sourceCounts.map((x) => x[0]));
        cb.checked ? next.add(name) : next.delete(name);
        state.sources = next.size === state.sourceCounts.length ? null : next;
        updateSourceSummary(); render();
      });
      return h('label', {}, cb, h('span', { text: name }), h('span', { class: 'n', text: fmtInt(n) }));
    }));
    updateSourceSummary();
  }
  function updateSourceSummary() {
    const total = state.sourceCounts.length;
    $('#sources-summary').textContent = !state.sources ? `Источники: все (${total})` : `Источники: ${state.sources.size} из ${total}`;
  }
  function setAllSources(on) {
    state.sources = on ? null : new Set();
    for (const cb of document.querySelectorAll('#sources-list input')) cb.checked = on;
    updateSourceSummary(); render();
  }

  // ---------- отрисовка ----------
  function render() {
    const c = compute();
    renderKpis(c);
    renderFunnel(c);
    renderTrendCount(c);
    renderTrendRates(c);
    renderTrendQualMc(c);
    renderSourceTable(c);
    $('#count-hint').textContent = 'Сколько сделок создано в каждом периоде (' + ({ day: 'по дням', week: 'по неделям', month: 'по месяцам' })[c.gran] + ')';
    for (const b of document.querySelectorAll('[data-table-toggle]')) b.textContent = state.tableView[b.dataset.tableToggle] ? 'График' : 'Таблица';
  }

  // ---------- загрузка ----------
  function showError(text) {
    $('#app').hidden = true;
    const box = $('#error');
    box.hidden = false;
    box.replaceChildren(h('h2', { text: 'Не удалось загрузить данные' }), h('p', { text: text }), h('p', { text: 'Положите CSV-выгрузку сделок в папку data рядом с программой и нажмите «Обновить данные».' }));
  }
  async function load(first) {
    let payload;
    try {
      const res = await fetch('/api/deals', { cache: 'no-store' });
      payload = await res.json();
    } catch (e) {
      return showError('Сервер не отвечает. Запущена ли программа?');
    }
    if (payload.error) return showError(payload.error);
    $('#error').hidden = true;
    $('#app').hidden = false;
    state.all = M.decode(payload);
    state.meta = payload.meta;
    const counts = new Map();
    for (const d of state.all) counts.set(d.source, (counts.get(d.source) || 0) + 1);
    state.sourceCounts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
    state.sources = null;
    renderSourceFilter();
    $('#subtitle').textContent = `Атрибуция по дате создания сделки · данные по ${dfDay.format(D(state.meta.dateMax))}`;
    const m = state.meta;
    $('#file-meta').textContent = `Файл: ${m.file}. Загружено сделок: ${fmtInt(m.rowsUsed)} из ${fmtInt(m.rowsTotal)}` +
      (m.rowsSkipped ? `, пропущено без даты создания: ${fmtInt(m.rowsSkipped)}` : '') + (m.warnings.length ? '. ' + m.warnings.join(' ') : '');
    if (first || state.preset !== 'custom') applyPreset(state.preset);
    else setRange(state.from < m.dateMin ? m.dateMin : state.from, state.to > m.dateMax ? m.dateMax : state.to, 'custom');
  }

  // ---------- события ----------
  for (const b of document.querySelectorAll('#presets button')) b.addEventListener('click', () => applyPreset(b.dataset.preset));
  for (const id of ['from', 'to']) {
    $('#' + id).addEventListener('change', () => {
      const from = $('#from').value || state.meta.dateMin, to = $('#to').value || state.meta.dateMax;
      setRange(from <= to ? from : to, from <= to ? to : from, 'custom');
    });
  }
  $('#only-new').addEventListener('change', (e) => { state.onlyNew = e.target.checked; render(); });
  $('#gran').addEventListener('change', (e) => { state.gran = e.target.value; render(); });
  $('#src-all').addEventListener('click', () => setAllSources(true));
  $('#src-none').addEventListener('click', () => setAllSources(false));
  $('#reload').addEventListener('click', () => load(false));
  for (const b of document.querySelectorAll('[data-table-toggle]')) {
    b.addEventListener('click', () => { state.tableView[b.dataset.tableToggle] = !state.tableView[b.dataset.tableToggle]; render(); });
  }
  document.addEventListener('click', (e) => { const dd = $('#sources-dd'); if (dd.open && !dd.contains(e.target)) dd.open = false; });
  $('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* без сохранения */ }
  });
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ок */ }

  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (current) { renderFunnel(current); renderTrendCount(current); renderTrendRates(current); renderTrendQualMc(current); } });
  });

  renderRatesLegend();
  load(true);
})();
