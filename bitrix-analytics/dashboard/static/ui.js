/* Общие элементы интерфейса: DOM-помощники, форматирование, подсказка и графики на чистом SVG.
   Все подписи вставляются через textContent (названия приходят из файла и недоверенные). */
window.UI = (function () {
  'use strict';
  const M = window.Metrics;
  const NS = 'http://www.w3.org/2000/svg';

  // ---------- DOM ----------
  function build(create, tag, attrs, children) {
    const e = create(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }
  const h = (tag, attrs, ...children) => build((t) => document.createElement(t), tag, attrs, children);
  const s = (tag, attrs, ...children) => build((t) => document.createElementNS(NS, t), tag, attrs, children);

  // ---------- форматирование ----------
  const nfInt = new Intl.NumberFormat('ru-RU');
  const fmtInt = (n) => nfInt.format(n);
  const fmtPct = (r) => (r == null ? '—' : (r * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%');
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
  const fmtSignedInt = (n) => sign(n) + fmtInt(Math.abs(n));
  const fmtRel = (r) => (r == null ? 'нет базы' : sign(r) + Math.abs(r * 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + '%');
  const fmtPP = (pp) => sign(Math.round(pp * 10) / 10) + Math.abs(pp).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' п.п.';

  const dfDay = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const dfShort = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
  const dfMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const dfMonthShort = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short', year: '2-digit' });
  const D = (str) => new Date(str + 'T00:00:00Z');
  const fmtDay = (str) => dfDay.format(D(str));
  const fmtRange = (r) => (r.from === r.to ? fmtDay(r.from) : dfShort.format(D(r.from)) + ' – ' + dfShort.format(D(r.to)) + ' ' + r.to.slice(0, 4));

  function bucketTitle(b, gran) {
    if (gran === 'day') return fmtDay(b.start);
    if (gran === 'month') return dfMonth.format(D(b.start));
    return 'Неделя ' + dfShort.format(D(b.start)) + ' – ' + dfShort.format(D(b.end));
  }
  const bucketLabel = (b, gran) => (gran === 'month' ? dfMonthShort.format(D(b.start)) : dfShort.format(D(b.start)));
  const GRAN_TEXT = { day: 'по дням', week: 'по неделям', month: 'по месяцам' };

  // ---------- подсказка ----------
  const tip = document.getElementById('tip');
  function showTip(title, rows, x, y) {
    tip.replaceChildren(h('div', { class: 't', text: title }));
    for (const r of rows) {
      const row = h('div', { class: 'r' });
      if (r.color) row.append(h('span', { class: 'key', style: 'background:' + r.color }));
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
  const hideTip = () => { tip.style.display = 'none'; };
  function tipAtElement(el, title, rows) {
    const r = el.getBoundingClientRect();
    showTip(title, rows, r.left + r.width / 2, r.top);
  }
  /** Навешивает подсказку на элемент: мышь, касание, клавиатура. onOn/onOff подсвечивают метку. */
  function bindTip(hit, getContent, onOn, onOff) {
    const on = () => onOn && onOn();
    const off = () => { onOff && onOff(); hideTip(); };
    hit.addEventListener('pointermove', (e) => { on(); const c = getContent(); showTip(c.title, c.rows, e.clientX, e.clientY); });
    hit.addEventListener('pointerleave', off);
    hit.addEventListener('focus', () => { on(); const c = getContent(); tipAtElement(hit, c.title, c.rows); });
    hit.addEventListener('blur', off);
  }

  // ---------- оси ----------
  function niceStep(rough) {
    const p = Math.pow(10, Math.floor(Math.log10(rough)));
    const m = rough / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  function axis(max, want) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    const step = Math.max(niceStep(max / want), 1e-9);
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { max: top, ticks };
  }
  function plotFrame(W, H, ax, fmtTick) {
    const m = { l: 44, r: 12, t: 8, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const y = (v) => m.t + ph - (v / ax.max) * ph;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
    for (const t of ax.ticks) {
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'axisline' : 'gridline' }));
      svg.append(s('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', text: fmtTick(t) }));
    }
    return { svg, m, pw, ph, y };
  }
  function xLabels(frame, buckets, gran) {
    const band = frame.pw / buckets.length;
    const every = Math.max(1, Math.ceil(46 / band));
    buckets.forEach((b, i) => {
      if (i % every) return;
      frame.svg.append(s('text', { x: frame.m.l + band * (i + 0.5), y: frame.m.t + frame.ph + 18, 'text-anchor': 'middle', text: bucketLabel(b, gran) }));
    });
  }
  const empty = (box, text) => box.replaceChildren(h('div', { class: 'empty', text: text || 'Нет данных за выбранный период' }));
  const width = (box, min) => Math.max(box.clientWidth, min || 280);

  function barTop(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  function barRight(x, y, w, hgt, r) {
    r = Math.min(r, w, hgt / 2);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
  }

  // ---------- колонки (в т. ч. составные) ----------
  /**
   * buckets: [{start, end, total, by:{ключ: число}}]; series: [{key, label, color}].
   * opts: gran, percent (доли вместо штук), dataEnd (дата, после которой период неполный), height, ariaLabel.
   */
  function stackedColumns(box, buckets, series, opts) {
    const total = buckets.reduce((a, b) => a + b.total, 0);
    if (!total) return empty(box);
    const W = width(box), H = opts.height || 260;
    const max = opts.percent ? 100 : Math.max(...buckets.map((b) => b.total));
    const f = plotFrame(W, H, axis(max, 4), (v) => (opts.percent ? v + '%' : fmtInt(v)));
    xLabels(f, buckets, opts.gran);
    const band = f.pw / buckets.length, bw = Math.min(28, Math.max(band - 2, 2));
    buckets.forEach((b, i) => {
      const cx = f.m.l + band * (i + 0.5), partial = opts.dataEnd && b.end > opts.dataEnd;
      const g = s('g', partial ? { opacity: 0.6 } : {});
      const title = bucketTitle(b, opts.gran) + (partial ? ' (неполный)' : '');
      const parts = series.map((sr) => ({ sr, n: b.by[sr.key] || 0 })).filter((p) => p.n > 0);
      const rows = [{ label: 'Всего', value: fmtInt(b.total) }, ...parts.map((p) => ({ color: p.sr.color, label: p.sr.label, value: fmtInt(p.n), sub: fmtPct(p.n / b.total) }))];
      const hit = s('rect', { x: cx - band / 2, y: f.m.t, width: band, height: f.ph, class: 'hit', tabindex: 0, 'aria-label': `${title}: ${fmtInt(b.total)}` });
      bindTip(hit, () => ({ title, rows }), () => g.classList.add('on'), () => g.classList.remove('on'));
      g.append(hit);
      let acc = 0;
      parts.forEach((p, k) => {
        const v0 = opts.percent ? (acc / b.total) * 100 : acc, v1 = opts.percent ? ((acc + p.n) / b.total) * 100 : acc + p.n;
        acc += p.n;
        const y1 = f.y(v1), hgt = Math.max(f.y(v0) - y1 - (k ? 2 : 0), 1);
        const last = k === parts.length - 1;
        const st = `fill:${p.sr.color};--k:${i}`;
        g.append(last ? s('path', { d: barTop(cx - bw / 2, y1, bw, hgt, 4), class: 'bar bar-v', style: st })
          : s('rect', { x: cx - bw / 2, y: y1, width: bw, height: hgt, class: 'bar bar-v', style: st }));
      });
      f.svg.append(g);
    });
    f.svg.setAttribute('role', 'img');
    f.svg.setAttribute('aria-label', opts.ariaLabel || 'График по периодам');
    box.replaceChildren(f.svg);
  }

  // ---------- горизонтальные столбцы ----------
  /** rows: [{label, value, text, tip:[…], title}]; подпись над столбцом на узком экране. */
  function hBars(box, rows, opts) {
    opts = opts || {};
    if (!rows.length || !rows.some((r) => r.value > 0)) return empty(box, opts.emptyText);
    const W = width(box, 240), narrow = W < 460;
    const rowH = narrow ? 56 : 36, barH = 20, labelW = narrow ? 0 : Math.min(300, W * 0.46), valueW = 110;
    const area = Math.max(W - labelW - valueW, 40), max = Math.max(...rows.map((r) => r.value));
    const svg = s('svg', { viewBox: `0 0 ${W} ${rows.length * rowH}`, role: 'img', 'aria-label': opts.ariaLabel || 'Сравнение по категориям' });
    const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
    rows.forEach((r, i) => {
      const y = i * rowH + (narrow ? 22 : (rowH - barH) / 2);
      const w = r.value > 0 ? Math.max((r.value / max) * area, 2) : 0;
      const g = s('g');
      g.append(s('text', { x: 0, y: narrow ? y - 7 : y + barH / 2 + 4, class: 'name', text: cut(r.label, narrow ? 50 : Math.floor(labelW / 6.6)) }));
      if (w) g.append(s('path', { d: barRight(labelW, y, w, barH, 4), class: 'bar bar-h', style: (r.color ? 'fill:' + r.color + ';' : '') + '--k:' + i }));
      g.append(s('text', { x: labelW + w + 8, y: y + barH / 2 + 4, class: 'strong', text: r.text }));
      const hit = s('rect', { x: 0, y: i * rowH, width: W, height: rowH, class: 'hit', tabindex: 0, 'aria-label': `${r.label}: ${r.text}` });
      bindTip(hit, () => ({ title: r.label, rows: r.tip || [{ label: 'Значение', value: r.text }] }), () => g.classList.add('on'), () => g.classList.remove('on'));
      g.append(hit);
      svg.append(g);
    });
    box.replaceChildren(svg);
  }

  // ---------- линии (доли по периодам) ----------
  /**
   * defs: [{key, label, color, value(b)→доля|null, num(b), den(b), denText}].
   * Неполный последний период не рисуется: его доли занижены и вводили бы в заблуждение.
   */
  function lines(box, buckets, defs, opts) {
    const live = buckets.map((b) => ({ b, partial: opts.dataEnd && b.end > opts.dataEnd }));
    const val = (x, d) => (x.partial ? null : d.value(x.b));
    if (!live.some((x) => defs.some((d) => val(x, d) != null))) {
      return empty(box, opts.emptyText || 'Недостаточно данных в периодах: выберите более крупный шаг или шире период.');
    }
    const W = width(box), H = opts.height || 280;
    const peak = Math.max(0.05, ...live.flatMap((x) => defs.map((d) => val(x, d) || 0)));
    const f = plotFrame(W, H, axis(Math.min(peak, 1) * 100, 4), (v) => v + '%');
    xLabels(f, buckets, opts.gran);
    const band = f.pw / buckets.length;
    const cx = (i) => f.m.l + band * (i + 0.5), yv = (r) => f.y(r * 100);
    for (const d of defs) {
      let path = '', pen = false, last = -1;
      live.forEach((x, i) => {
        const v = val(x, d);
        if (v == null) { pen = false; return; }
        path += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${yv(v).toFixed(1)}`;
        pen = true; last = i;
      });
      if (path) f.svg.append(s('path', { d: path, pathLength: 1, class: 'line draw', style: 'stroke:' + d.color }));
      if (last >= 0) f.svg.append(s('circle', { cx: cx(last), cy: yv(val(live[last], d)), r: 4, class: 'dot pop', style: 'fill:' + d.color }));
    }
    const cross = s('line', { y1: f.m.t, y2: f.m.t + f.ph, class: 'crosshair', visibility: 'hidden' });
    const dots = defs.map((d) => s('circle', { r: 4, class: 'dot', style: 'fill:' + d.color, visibility: 'hidden' }));
    f.svg.append(cross, ...dots);
    const hit = s('rect', { x: f.m.l, y: f.m.t, width: f.pw, height: f.ph, class: 'hit', tabindex: 0, 'aria-label': (opts.ariaLabel || 'Конверсии по периодам') + ', подробности в таблице' });
    let focusIdx = buckets.length - 1;
    const at = (i, px, py, kb) => {
      const x = live[i];
      cross.setAttribute('x1', cx(i)); cross.setAttribute('x2', cx(i)); cross.setAttribute('visibility', 'visible');
      defs.forEach((d, k) => {
        const v = val(x, d);
        if (v == null) return dots[k].setAttribute('visibility', 'hidden');
        dots[k].setAttribute('cx', cx(i)); dots[k].setAttribute('cy', yv(v)); dots[k].setAttribute('visibility', 'visible');
      });
      const rows = defs.map((d) => {
        const v = d.value(x.b), n = d.den(x.b);
        const sub = v != null ? `${fmtInt(d.num(x.b))} из ${fmtInt(n)} ${d.denText}` : n ? `мало данных: ${fmtInt(n)} ${d.denText}` : 'нет данных';
        return { color: d.color, label: d.label, value: fmtPct(v), sub };
      });
      const title = bucketTitle(x.b, opts.gran) + (x.partial ? ' (неполный, на линии не показан)' : '');
      if (kb) tipAtElement(hit, title, rows); else showTip(title, rows, px, py);
    };
    const off = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); };
    hit.addEventListener('pointermove', (e) => {
      const r = hit.getBoundingClientRect();
      at(Math.min(buckets.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * buckets.length))), e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', off);
    hit.addEventListener('focus', () => at(focusIdx, 0, 0, true));
    hit.addEventListener('blur', off);
    hit.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      focusIdx = Math.min(buckets.length - 1, Math.max(0, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
      at(focusIdx, 0, 0, true);
    });
    f.svg.append(hit);
    f.svg.setAttribute('role', 'img');
    f.svg.setAttribute('aria-label', opts.ariaLabel || 'Конверсии по периодам');
    box.replaceChildren(f.svg);
  }

  // ---------- мини-график в карточке ----------
  /** values: ряд чисел; последний период (возможно неполный) выделен точкой, неполный рисуется пунктиром. */
  function spark(values, partialLast) {
    const W = 120, H = 32, pad = 4;
    const max = Math.max(...values, 1);
    const x = (i) => pad + (i * (W - 2 * pad)) / Math.max(values.length - 1, 1);
    const y = (v) => H - pad - (v / max) * (H - 2 * pad);
    const svg = s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Динамика за последние недели' });
    const full = partialLast ? values.slice(0, -1) : values;
    if (full.length > 1) svg.append(s('path', { d: full.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), pathLength: 1, class: 'spark-line draw' }));
    if (partialLast && values.length > 1) {
      const i = values.length - 2;
      svg.append(s('path', { d: `M${x(i).toFixed(1)},${y(values[i]).toFixed(1)}L${x(i + 1).toFixed(1)},${y(values[i + 1]).toFixed(1)}`, class: 'spark-line partial' }));
    }
    svg.append(s('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3, class: 'spark-dot pop' }));
    return svg;
  }

  // ---------- изменение к прошлому периоду ----------
  /** kind: 'count' (абсолютное и %), 'rate' (п.п.). better: рост — это хорошо (true) или плохо (false). */
  function deltaChip(cur, prev, kind, better, compact) {
    if (prev == null || cur == null) return null;
    let text, dir;
    if (kind === 'rate') {
      const pp = M.deltaPP(cur, prev);
      dir = Math.abs(pp) < 0.05 ? 0 : Math.sign(pp);
      text = fmtPP(pp);
    } else {
      const d = M.delta(cur, prev);
      dir = Math.sign(d.abs);
      text = compact ? fmtRel(d.rel) : `${fmtRel(d.rel)} (${fmtSignedInt(d.abs)})`;
    }
    const good = dir === 0 ? 'flat' : (dir > 0) === (better !== false) ? 'good' : 'bad';
    const arrow = dir > 0 ? '▲' : dir < 0 ? '▼' : '●';
    return h('span', { class: 'delta ' + good, title: kind === 'rate' ? 'Изменение к периоду сравнения' : `Было ${fmtInt(prev)}, стало ${fmtInt(cur)}` }, h('span', { 'aria-hidden': 'true', text: arrow + ' ' }), text);
  }

  // ---------- анимация чисел ----------
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Плавно меняет число в элементе от from до to (если from не задан или анимации отключены, ставит сразу). */
  function countUp(el, to, fmt, from) {
    if (from == null || from === to || reduced()) { el.textContent = fmt(to); return; }
    el.textContent = fmt(from);
    const t0 = performance.now(), dur = 650;
    const step = (now) => {
      const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- иконки (собственные, 24×24, линия) ----------
  const ICONS = {
    overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    marketing: 'M3 5h18l-7 8v6l-4-2v-4z',
    sales: 'M3 8h18v11H3zM8 8V5h8v3M3 13h18',
    access: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
    logo: 'M5 19V10M12 19V5M19 19v-7',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  };
  function icon(name) {
    return s('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: ICONS[name] }));
  }

  // ---------- плитка ----------
  function tile(o) {
    const el = h('div', { class: 'tile' + (o.hero ? ' hero' : '') });
    const val = h('div', { class: 'value' });
    if (o.num != null) countUp(val, o.num, fmtInt, o.countFrom); else val.textContent = o.value;
    el.append(h('div', { class: 'label', text: o.label }), val);
    if (o.note) el.append(h('div', { class: 'note' }, ...o.note));
    if (o.delta) el.append(h('div', { class: 'delta-row' }, o.delta));
    if (o.prevText) el.append(h('div', { class: 'prev', text: o.prevText }));
    if (o.spark) el.append(o.spark);
    return el;
  }
  const strong = (t) => h('strong', { text: t });

  return { h, s, fmtInt, fmtPct, fmtRel, fmtPP, fmtSignedInt, fmtDay, fmtRange, bucketTitle, GRAN_TEXT, showTip, hideTip, bindTip,
    stackedColumns, hBars, lines, spark, deltaChip, tile, strong, empty, icon, countUp, reduced };
})();
