/* Расчёт метрик воронки. Чистые функции без доступа к DOM: работают и в браузере, и в Node (тесты). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Ответ сервера {fields, dicts, rows} → массив объектов (строки восстанавливаются из словарей). */
  function decode(payload) {
    const f = payload.fields, dicts = payload.dicts || {};
    const tables = f.map((name) => dicts[name] || null);
    return payload.rows.map((r) => {
      const o = {};
      for (let i = 0; i < f.length; i++) o[f[i]] = tables[i] ? tables[i][r[i]] : r[i];
      return o;
    });
  }

  /** Фильтр: from/to — 'YYYY-MM-DD' включительно, groups — Set (null = все), onlyNew — bool. */
  function filterDeals(deals, { from, to, groups, onlyNew }) {
    return deals.filter(
      (d) =>
        (!from || d.created >= from) &&
        (!to || d.created <= to) &&
        (!onlyNew || d.isNew) &&
        (!groups || groups.has(d.group))
    );
  }

  function emptyTotals() {
    return { leads: 0, webinar: 0, reached: 0, qual: 0, mc: 0, mcRequest: 0, failed: 0 };
  }
  function addDeal(t, d) {
    t.leads += 1;
    t.webinar += d.webinar;
    t.reached += d.reached;
    t.qual += d.qual;
    t.mc += d.mc;
    t.mcRequest += d.mcRequest;
    t.failed += d.failed;
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

  /** Доли. Каждая считается из тех же чисел, что показаны на карточках, чтобы всё сходилось «на калькуляторе». */
  function rates(t) {
    return {
      webinarRate: ratio(t.webinar, t.leads), // посетили / лиды
      reachedRate: ratio(t.reached, t.leads), // дозвонились / лиды
      qualFromReached: ratio(t.qual, t.reached), // квал / дозвонились
      mcFromQual: ratio(t.mc, t.qual), // МС / квал
      mcRequestRate: ratio(t.mcRequest, t.leads),
    };
  }

  /** Изменение к прошлому периоду: абсолютное и относительное (null, если не с чем сравнивать). */
  function delta(cur, prev) {
    if (prev == null || cur == null) return null;
    return { abs: cur - prev, rel: prev > 0 ? (cur - prev) / prev : null };
  }
  /** Изменение доли в процентных пунктах. */
  function deltaPP(cur, prev) {
    if (prev == null || cur == null) return null;
    return (cur - prev) * 100;
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
  function addMonths(s, n) {
    const dt = toDate(s.slice(0, 7) + '-01');
    dt.setUTCMonth(dt.getUTCMonth() + n);
    return iso(dt);
  }
  function daysBetween(a, b) {
    return Math.round((toDate(b) - toDate(a)) / 86400000);
  }
  function monthEnd(s) {
    return addDays(addMonths(s, 1), -1);
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
    return addMonths(s, 1);
  }
  function bucketEnd(s, gran) {
    return addDays(nextBucket(s, gran), -1);
  }
  function autoGranularity(from, to) {
    const days = daysBetween(from, to) + 1;
    return days <= 62 ? 'day' : days <= 400 ? 'week' : 'month';
  }

  /** Готовые периоды относительно последней даты в данных (а не «сегодня»: выгрузка статична). */
  function presetRange(kind, maxDate, minDate) {
    switch (kind) {
      case 'thisWeek': return { from: bucketStart(maxDate, 'week'), to: maxDate };
      case 'lastWeek': {
        const from = addDays(bucketStart(maxDate, 'week'), -7);
        return { from, to: addDays(from, 6) };
      }
      case 'thisMonth': return { from: bucketStart(maxDate, 'month'), to: maxDate };
      case 'lastMonth': {
        const from = addMonths(maxDate, -1);
        return { from, to: monthEnd(from) };
      }
      case 'last30': return { from: addDays(maxDate, -29), to: maxDate };
      case 'last90': return { from: addDays(maxDate, -89), to: maxDate };
      default: return { from: minDate, to: maxDate };
    }
  }

  /** Период для сравнения. mode: 'prev' | 'year' | 'none'. Для недель и месяцев берётся предыдущая неделя / месяц. */
  function comparePeriod(range, preset, mode) {
    if (mode === 'none' || !range.from) return null;
    const len = daysBetween(range.from, range.to) + 1;
    if (mode === 'year') {
      const shift = (s) => {
        const dt = toDate(s);
        dt.setUTCFullYear(dt.getUTCFullYear() - 1);
        return iso(dt);
      };
      return { from: shift(range.from), to: shift(range.to) };
    }
    if (preset === 'thisMonth' || preset === 'lastMonth') {
      const from = addMonths(range.from, -1), end = monthEnd(from);
      const to = addDays(from, len - 1);
      return { from, to: to > end ? end : to };
    }
    // неделя и произвольный период: такой же отрезок сразу перед текущим
    return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
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
      out.push({ start: k, end: bucketEnd(k, gran), ...t, ...rates(t) });
    }
    return out;
  }

  /** Динамика с разбивкой по значениям поля: [{start, end, total, by:{ключ: число}}]. */
  function seriesBy(deals, gran, from, to, keyFn) {
    const map = new Map();
    for (const d of deals) {
      const k = bucketStart(d.created, gran);
      if (!map.has(k)) map.set(k, { total: 0, by: {} });
      const b = map.get(k), key = keyFn(d);
      b.total += 1;
      b.by[key] = (b.by[key] || 0) + 1;
    }
    const out = [];
    for (let k = bucketStart(from, gran); k <= to; k = nextBucket(k, gran)) {
      const b = map.get(k) || { total: 0, by: {} };
      out.push({ start: k, end: bucketEnd(k, gran), ...b });
    }
    return out;
  }

  /** Оценка лида в любой из шкал: новая (звёзды) важнее старой (A–F). Нет оценки: null. */
  const STAR_ORDER = ['1★', '2★', '3★', '4★', '5★'];
  const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];
  function scoreLabel(d) {
    const stars = (d.stars || '').trim(), grade = (d.grade || '').trim().toUpperCase();
    if (stars) return stars;
    return grade || null;
  }

  /** Подсчёт по значению поля, по убыванию. */
  function countBy(deals, keyFn) {
    const map = new Map();
    for (const d of deals) {
      const k = keyFn(d);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key), 'ru'));
  }

  /**
   * Дерево: levels — функции, возвращающие ключ узла на каждом уровне.
   * Узел: {id, key, depth, t (итоги по всем вложенным лидам), children}.
   */
  function buildTree(deals, levels) {
    const root = { id: '', key: '', depth: -1, t: emptyTotals(), kids: new Map() };
    for (const d of deals) {
      let node = root;
      addDeal(root.t, d);
      for (let depth = 0; depth < levels.length; depth++) {
        const key = levels[depth](d);
        let child = node.kids.get(key);
        if (!child) {
          child = { id: node.id + '\u0001' + key, key, depth, t: emptyTotals(), kids: new Map() };
          node.kids.set(key, child);
        }
        addDeal(child.t, d);
        node = child;
      }
    }
    const finish = (n) => {
      n.children = [...n.kids.values()].sort((a, b) => b.t.leads - a.t.leads || String(a.key).localeCompare(String(b.key), 'ru'));
      delete n.kids;
      n.children.forEach(finish);
    };
    finish(root);
    return root;
  }


  // ======================================================================================
  // События для «Общего» дашборда. Событие: {type, date, lead, group, source, isNew, amount, ...}.
  // date — дата самого события, lead — дата создания лида (когорта).
  // ======================================================================================
  const inRange = (d, r) => d >= r.from && d <= r.to;

  /** Ответ сервера {fields, dicts, rows} → массив событий. */
  function decodeEvents(payload) {
    return payload ? decode(payload) : [];
  }

  /** Фильтр по группам источников и «только новые» (даты здесь не трогаем). */
  function filterEvents(events, { groups, onlyNew, dealType }) {
    return events.filter((e) =>
      (!onlyNew || e.isNew) && (!groups || groups.has(e.group)) &&
      (!dealType || dealType === 'all' || (dealType === 'new' ? e.isNew : !e.isNew)));
  }

  /**
   * Поток за период по дате события: всего, из лидов самого периода (own) и из лидов прошлых периодов (earlier).
   * amount — сумма (для покупок).
   */
  function flowTotals(events, type, range) {
    const t = { total: 0, own: 0, earlier: 0, amount: 0 };
    for (const e of events) {
      if (e.type !== type || !inRange(e.date, range)) continue;
      t.total += 1;
      t.amount += e.amount || 0;
      if (e.lead >= range.from) t.own += 1; else t.earlier += 1;
    }
    return t;
  }

  /** Поток по периодам: в каждом — сколько из лидов этого периода (same), прошлого (prev) и более старых (older). */
  function flowSeries(events, type, gran, from, to) {
    const map = new Map();
    for (const e of events) {
      if (e.type !== type || !inRange(e.date, { from, to })) continue;
      const k = bucketStart(e.date, gran), lk = bucketStart(e.lead, gran);
      if (!map.has(k)) map.set(k, { total: 0, same: 0, prev: 0, older: 0, amount: 0 });
      const b = map.get(k);
      b.total += 1; b.amount += e.amount || 0;
      if (lk >= k) b.same += 1; else if (lk === addPeriods(k, gran, -1)) b.prev += 1; else b.older += 1;
    }
    const out = [];
    for (let k = bucketStart(from, gran); k <= to; k = nextBucket(k, gran)) {
      out.push({ start: k, end: bucketEnd(k, gran), ...(map.get(k) || { total: 0, same: 0, prev: 0, older: 0, amount: 0 }) });
    }
    return out;
  }
  function addPeriods(s, gran, n) {
    if (gran === 'day') return addDays(s, n);
    if (gran === 'week') return addDays(s, 7 * n);
    return addMonths(s, n);
  }

  /**
   * Когортная таблица: строки — недели создания лида, столбцы — через сколько недель произошло событие (0…maxLag).
   * size — число лидов недели. rate = n / size. future: эта неделя ещё не наступила (данных быть не может).
   */
  function cohortMatrix(events, type, { from, to, maxLag, asOf }) {
    const rows = new Map();
    const first = bucketStart(from, 'week');
    for (let k = first; k <= to; k = nextBucket(k, 'week')) rows.set(k, { start: k, size: 0, counts: new Array(maxLag + 1).fill(0), later: 0, total: 0 });
    for (const e of events) {
      const row = rows.get(bucketStart(e.lead, 'week'));
      if (!row) continue;
      if (e.type === 'lead') { row.size += 1; continue; }
      if (e.type !== type) continue;
      const lag = Math.max(0, Math.round(daysBetween(row.start, bucketStart(e.date, 'week')) / 7));
      row.total += 1;
      if (lag > maxLag) row.later += 1; else row.counts[lag] += 1;
    }
    const asOfWeek = bucketStart(asOf, 'week');
    return [...rows.values()].map((r) => ({
      ...r,
      cells: r.counts.map((n, lag) => {
        const future = addDays(r.start, 7 * lag) > asOfWeek;
        return { lag, n: future ? null : n, rate: future || !r.size ? null : n / r.size, future };
      }),
    }));
  }

  /** Воронка МС: записаны (по дате записи), проведены (по дате МС), ожидают впереди, «зависли» (дата прошла, не проведена). */
  function mcPipeline(events, range, asOf) {
    const booked = flowTotals(events, 'mc_booked', range), held = flowTotals(events, 'mc_held', range);
    let upcoming = 0, nextWeek = 0, stale = 0, staleInPeriod = 0;
    for (const e of events) {
      if (e.type !== 'mc_wait') continue;
      if (e.date > asOf) { upcoming += 1; if (e.date <= addDays(asOf, 7)) nextWeek += 1; }
      else { stale += 1; if (inRange(e.date, range)) staleInPeriod += 1; }
    }
    return { booked, held, upcoming, nextWeek, stale, staleInPeriod };
  }

  /** SL: стали и ушли за период (по дате изменения), сейчас в SL всего и сколько из них без даты входа. */
  function slStats(events, range) {
    let inN = 0, outN = 0, now = 0, datedIn = 0;
    for (const e of events) {
      if (e.type === 'sl_in') { datedIn += 1; if (inRange(e.date, range)) inN += 1; }
      else if (e.type === 'sl_out' && inRange(e.date, range)) outN += 1;
      else if (e.type === 'sl_now') now += 1;
    }
    return { in: inN, out: outN, net: inN - outN, now, undated: Math.max(0, now - datedIn) };
  }

  /** Покупки за период: число, сумма, средний чек, медиана дней от создания лида до покупки. */
  function purchaseStats(events, type, range) {
    const days = [];
    let n = 0, amount = 0, own = 0;
    for (const e of events) {
      if (e.type !== type || !inRange(e.date, range)) continue;
      n += 1; amount += e.amount || 0;
      if (e.lead >= range.from) own += 1;
      days.push(Math.max(0, daysBetween(e.lead, e.date)));
    }
    days.sort((a, b) => a - b);
    return { n, amount, own, earlier: n - own, avg: n ? amount / n : null, medianDays: days.length ? days[Math.floor(days.length / 2)] : null };
  }

  return {
    decodeEvents, filterEvents, flowTotals, flowSeries, cohortMatrix, mcPipeline, slStats, purchaseStats,
    decode, filterDeals, summarize, scoreLabel, STAR_ORDER, GRADE_ORDER, rates, ratio, delta, deltaPP, series, seriesBy, countBy, buildTree,
    bucketStart, nextBucket, bucketEnd, autoGranularity, presetRange, comparePeriod, addDays, addMonths, daysBetween,
  };
});
