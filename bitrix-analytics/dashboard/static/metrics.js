/* Расчёт метрик воронки. Чистые функции без доступа к DOM: работают и в браузере, и в Node (тесты). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Ответ сервера {fields, rows} → массив объектов. */
  function decode(payload) {
    const f = payload.fields;
    return payload.rows.map((r) => {
      const o = {};
      for (let i = 0; i < f.length; i++) o[f[i]] = r[i];
      return o;
    });
  }

  /** Фильтр: from/to — 'YYYY-MM-DD' включительно, sources — Set (null = все), onlyNew — bool. */
  function filterDeals(deals, { from, to, sources, onlyNew }) {
    return deals.filter(
      (d) =>
        (!from || d.created >= from) &&
        (!to || d.created <= to) &&
        (!onlyNew || d.isNew) &&
        (!sources || sources.has(d.source))
    );
  }

  function emptyTotals() {
    return { deals: 0, webinar: 0, reached: 0, qual: 0, mc: 0, qualMc: 0 };
  }

  function addDeal(t, d) {
    t.deals += 1;
    t.webinar += d.webinar;
    t.reached += d.reached;
    t.qual += d.qual;
    t.mc += d.mc;
    if (d.qual && d.mc) t.qualMc += 1;
    return t;
  }

  function summarize(deals) {
    const t = emptyTotals();
    for (const d of deals) addDeal(t, d);
    return t;
  }

  /** Доля a/b, null если делить не на что. */
  function ratio(a, b) {
    return b > 0 ? a / b : null;
  }

  /** Доли (суффикс Rate, чтобы не затирать счётчики). Производные показатели из итогов. qualToMc считается по сделкам, у которых есть и квал, и МС. */
  function rates(t) {
    return {
      webinarRate: ratio(t.webinar, t.deals), // доходимость
      reachedRate: ratio(t.reached, t.deals),
      qualRate: ratio(t.qual, t.deals),
      mcRate: ratio(t.mc, t.deals),
      qualToMc: ratio(t.qualMc, t.qual),
    };
  }

  function bySource(deals) {
    const map = new Map();
    for (const d of deals) {
      if (!map.has(d.source)) map.set(d.source, emptyTotals());
      addDeal(map.get(d.source), d);
    }
    return [...map.entries()].map(([source, t]) => ({ source, ...t, ...rates(t) }));
  }

  // --- даты (строки 'YYYY-MM-DD', вычисления в UTC, чтобы часовой пояс не сдвигал день) ---
  function toDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function iso(dt) {
    return dt.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const dt = toDate(s);
    dt.setUTCDate(dt.getUTCDate() + n);
    return iso(dt);
  }
  function daysBetween(a, b) {
    return Math.round((toDate(b) - toDate(a)) / 86400000);
  }

  /** Начало периода (день / неделя с понедельника / месяц), в который попадает дата. */
  function bucketStart(s, gran) {
    if (gran === 'day') return s;
    if (gran === 'month') return s.slice(0, 7) + '-01';
    const dt = toDate(s);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return iso(dt);
  }
  function nextBucket(s, gran) {
    if (gran === 'day') return addDays(s, 1);
    if (gran === 'week') return addDays(s, 7);
    const dt = toDate(s);
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    return iso(dt);
  }

  function autoGranularity(from, to) {
    const days = daysBetween(from, to) + 1;
    return days <= 62 ? 'day' : days <= 400 ? 'week' : 'month';
  }

  /** Динамика по периодам; пустые периоды между from и to остаются в ряду с нулями. */
  function series(deals, gran, from, to) {
    const map = new Map();
    for (const d of deals) {
      const k = bucketStart(d.created, gran);
      if (!map.has(k)) map.set(k, emptyTotals());
      addDeal(map.get(k), d);
    }
    const out = [];
    for (let k = bucketStart(from, gran); k <= to; k = nextBucket(k, gran)) {
      const t = map.get(k) || emptyTotals();
      out.push({ start: k, ...t, ...rates(t) });
    }
    return out;
  }

  return { decode, filterDeals, summarize, rates, ratio, bySource, series, bucketStart, nextBucket, autoGranularity, addDays, daysBetween };
});
