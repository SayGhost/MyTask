// Запуск: node --test tests/metrics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../static/metrics.js');

const deal = (created, group, o = {}) => ({ created, group, isNew: 1, webinar: 0, reached: 0, qual: 0, mc: 0, mcRequest: 0, failed: 0, ...o });

const deals = [
  deal('2026-03-02', 'A', { webinar: 1, reached: 1, qual: 1, mc: 1 }),
  deal('2026-03-03', 'A', { webinar: 1, reached: 1, qual: 1 }),
  deal('2026-03-09', 'A'),
  deal('2026-03-10', 'B', { webinar: 1, mc: 1 }),
  deal('2026-03-10', 'B', { isNew: 0, webinar: 1 }),
];

test('decode восстанавливает строки из словарей', () => {
  const out = M.decode({ fields: ['created', 'group', 'isNew'], dicts: { created: ['2026-01-01'], group: ['X', 'Y'] }, rows: [[0, 1, 1]] });
  assert.deepEqual(out, [{ created: '2026-01-01', group: 'Y', isNew: 1 }]);
});

test('filterDeals: период включительно, группы, только новые', () => {
  assert.equal(M.filterDeals(deals, { from: '2026-03-03', to: '2026-03-09' }).length, 2);
  assert.equal(M.filterDeals(deals, { onlyNew: true }).length, 4);
  assert.equal(M.filterDeals(deals, { groups: new Set(['B']) }).length, 2);
  assert.equal(M.filterDeals(deals, {}).length, 5);
});

test('summarize и rates: каждая доля считается из показанных чисел', () => {
  const t = M.summarize(deals.slice(0, 4));
  assert.deepEqual(t, { leads: 4, webinar: 3, reached: 2, qual: 2, mc: 2, mcRequest: 0, failed: 0 });
  const r = M.rates(t);
  assert.equal(r.webinarRate, 0.75);
  assert.equal(r.reachedRate, 0.5);
  assert.equal(r.qualFromReached, 1);
  assert.equal(r.mcFromQual, 1);
  assert.equal(M.rates(M.summarize([])).webinarRate, null);
});

test('delta и deltaPP', () => {
  assert.deepEqual(M.delta(120, 100), { abs: 20, rel: 0.2 });
  assert.deepEqual(M.delta(5, 0), { abs: 5, rel: null });
  assert.equal(M.delta(5, null), null);
  assert.ok(Math.abs(M.deltaPP(0.35, 0.3) - 5) < 1e-9);
});

test('bucketStart: неделя с понедельника, месяц с 1-го', () => {
  assert.equal(M.bucketStart('2026-03-08', 'week'), '2026-03-02');
  assert.equal(M.bucketStart('2026-03-09', 'week'), '2026-03-09');
  assert.equal(M.bucketStart('2026-03-31', 'month'), '2026-03-01');
  assert.equal(M.nextBucket('2026-12-01', 'month'), '2027-01-01');
  assert.equal(M.bucketEnd('2026-03-02', 'week'), '2026-03-08');
});

test('series: пустые периоды нулями, у каждого есть конец периода', () => {
  const s = M.series(deals, 'week', '2026-03-02', '2026-03-23');
  assert.deepEqual(s.map((b) => [b.start, b.leads]), [['2026-03-02', 2], ['2026-03-09', 3], ['2026-03-16', 0], ['2026-03-23', 0]]);
  assert.equal(s[0].end, '2026-03-08');
  assert.equal(s[2].webinarRate, null);
});

test('seriesBy: разбивка по ключу', () => {
  const s = M.seriesBy(deals, 'week', '2026-03-02', '2026-03-16', (d) => d.group);
  assert.deepEqual(s[1].by, { A: 1, B: 2 });
  assert.equal(s[2].total, 0);
});

test('presetRange относительно последней даты данных (пн 2026-10-05)', () => {
  const max = '2026-10-05', min = '2026-01-01';
  assert.deepEqual(M.presetRange('thisWeek', max, min), { from: '2026-10-05', to: '2026-10-05' });
  assert.deepEqual(M.presetRange('lastWeek', max, min), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(M.presetRange('thisMonth', max, min), { from: '2026-10-01', to: '2026-10-05' });
  assert.deepEqual(M.presetRange('lastMonth', max, min), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(M.presetRange('last30', max, min), { from: '2026-09-06', to: '2026-10-05' });
  assert.deepEqual(M.presetRange('all', max, min), { from: min, to: max });
});

test('comparePeriod: неделя, месяц, год, произвольный период', () => {
  const week = { from: '2026-09-28', to: '2026-10-04' };
  assert.deepEqual(M.comparePeriod(week, 'lastWeek', 'prev'), { from: '2026-09-21', to: '2026-09-27' });
  // «этот месяц» (5 дней) сравнивается с первыми 5 днями прошлого месяца
  assert.deepEqual(M.comparePeriod({ from: '2026-10-01', to: '2026-10-05' }, 'thisMonth', 'prev'), { from: '2026-09-01', to: '2026-09-05' });
  // прошлый месяц с коротким предыдущим: 31 день → февраль не вылезает за конец
  assert.deepEqual(M.comparePeriod({ from: '2026-03-01', to: '2026-03-31' }, 'lastMonth', 'prev'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(M.comparePeriod({ from: '2026-09-06', to: '2026-10-05' }, 'last30', 'prev'), { from: '2026-08-07', to: '2026-09-05' });
  assert.deepEqual(M.comparePeriod(week, 'lastWeek', 'year'), { from: '2025-09-28', to: '2025-10-04' });
  assert.equal(M.comparePeriod(week, 'lastWeek', 'none'), null);
});

test('buildTree: итоги по уровням и сортировка по лидам', () => {
  const ds = [
    deal('2026-03-02', 'A', { utm: 'a|x', webinar: 1 }),
    deal('2026-03-02', 'A', { utm: 'a|y' }),
    deal('2026-03-02', 'A', { utm: 'a|y' }),
    deal('2026-03-02', 'B', { utm: 'b|x', qual: 1 }),
  ];
  const tree = M.buildTree(ds, [(d) => d.utm.split('|')[0], (d) => d.utm.split('|')[1]]);
  assert.equal(tree.t.leads, 4);
  assert.deepEqual(tree.children.map((n) => [n.key, n.t.leads]), [['a', 3], ['b', 1]]);
  assert.deepEqual(tree.children[0].children.map((n) => [n.key, n.t.leads]), [['y', 2], ['x', 1]]);
  assert.equal(tree.children[0].t.webinar, 1);
  assert.equal(tree.children[1].children[0].t.qual, 1);
  assert.notEqual(tree.children[0].children[0].id, tree.children[1].children[0].id);
});

test('countBy сортирует по убыванию', () => {
  assert.deepEqual(M.countBy(deals, (d) => d.group), [{ key: 'A', n: 3 }, { key: 'B', n: 2 }]);
});

test('autoGranularity', () => {
  assert.equal(M.autoGranularity('2026-03-01', '2026-03-30'), 'day');
  assert.equal(M.autoGranularity('2026-01-01', '2026-10-05'), 'week');
  assert.equal(M.autoGranularity('2024-01-01', '2026-10-05'), 'month');
});


test('scoreLabel: звёзды (новая шкала) приоритетнее A–F (старая), старые оценки не теряются', () => {
  assert.equal(M.scoreLabel({ stars: '4★', grade: '' }), '4★');
  assert.equal(M.scoreLabel({ stars: '', grade: 'b' }), 'B');
  assert.equal(M.scoreLabel({ stars: '3★', grade: 'D' }), '3★');
  assert.equal(M.scoreLabel({ stars: '', grade: '' }), null);
  assert.deepEqual(M.GRADE_ORDER.concat(M.STAR_ORDER).length, 11);
});

// ---------- события ----------
const ev = (type, date, lead, o = {}) => ({ type, date, lead, group: 'A', source: 's', isNew: 1, amount: 0, ...o });

test('flowTotals: всего, из лидов периода и из прошлых', () => {
  const events = [
    ev('qual', '2026-03-10', '2026-03-09'), ev('qual', '2026-03-11', '2026-03-02'), ev('qual', '2026-03-12', '2026-02-01'),
    ev('qual', '2026-03-20', '2026-03-10'), ev('mc_booked', '2026-03-10', '2026-03-09'),
  ];
  const r = { from: '2026-03-09', to: '2026-03-15' };
  assert.deepEqual(M.flowTotals(events, 'qual', r), { total: 3, own: 1, earlier: 2, amount: 0 });
  assert.equal(M.flowTotals(events, 'mc_booked', r).total, 1);
});

test('flowSeries: same / prev / older по неделям', () => {
  const events = [
    ev('qual', '2026-03-10', '2026-03-09'), ev('qual', '2026-03-11', '2026-03-03'), ev('qual', '2026-03-12', '2026-01-05'),
    ev('qual', '2026-03-03', '2026-03-03'),
  ];
  const s = M.flowSeries(events, 'qual', 'week', '2026-03-02', '2026-03-15');
  assert.deepEqual([s[0].total, s[0].same], [1, 1]);
  assert.deepEqual([s[1].total, s[1].same, s[1].prev, s[1].older], [3, 1, 1, 1]);
});

test('cohortMatrix: лаг в неделях, размер когорты, будущие недели без данных', () => {
  const events = [
    ev('lead', '2026-03-02', '2026-03-02'), ev('lead', '2026-03-03', '2026-03-03'), ev('lead', '2026-03-09', '2026-03-09'),
    ev('qual', '2026-03-04', '2026-03-02'), ev('qual', '2026-03-11', '2026-03-02'), ev('qual', '2026-03-12', '2026-03-09'),
  ];
  const m = M.cohortMatrix(events, 'qual', { from: '2026-03-02', to: '2026-03-15', maxLag: 3, asOf: '2026-03-12' });
  assert.equal(m.length, 2);
  assert.equal(m[0].size, 2);
  assert.deepEqual(m[0].cells.map((c) => c.n), [1, 1, null, null]);   // недели 2 и 3 ещё не наступили
  assert.equal(m[0].cells[0].rate, 0.5);
  assert.deepEqual(m[1].cells.map((c) => c.n), [1, null, null, null]);
  assert.equal(m[0].cells[2].future, true);
});

test('mcPipeline: записаны, проведены, ожидают, зависли', () => {
  const asOf = '2026-03-10';
  const events = [
    ev('mc_booked', '2026-03-05', '2026-03-02'), ev('mc_held', '2026-03-06', '2026-03-02'), ev('mc_held', '2026-02-20', '2026-02-10'),
    ev('mc_wait', '2026-03-12', '2026-03-08'), ev('mc_wait', '2026-03-25', '2026-03-08'), ev('mc_wait', '2026-03-07', '2026-03-01'),
  ];
  const p = M.mcPipeline(events, { from: '2026-03-02', to: '2026-03-10' }, asOf);
  assert.equal(p.booked.total, 1); assert.equal(p.held.total, 1);
  assert.deepEqual([p.upcoming, p.nextWeek, p.stale, p.staleInPeriod], [2, 1, 1, 1]);
});

test('slStats: стали, ушли, сейчас и без даты', () => {
  const events = [
    ev('sl_in', '2026-03-05', '2026-03-01'), ev('sl_out', '2026-03-06', '2026-03-01'), ev('sl_out', '2026-02-06', '2026-01-01'),
    ev('sl_now', '2026-03-05', '2026-03-01'), ev('sl_now', '2026-03-02', '2026-03-02'), ev('sl_now', '2026-03-03', '2026-03-03'),
  ];
  assert.deepEqual(M.slStats(events, { from: '2026-03-01', to: '2026-03-31' }), { in: 1, out: 1, net: 0, now: 3, undated: 2 });
});

test('purchaseStats: число, сумма, средний чек, медиана дней', () => {
  const events = [
    ev('purchase', '2026-03-10', '2026-03-01', { amount: 100 }), ev('purchase', '2026-03-12', '2026-03-12', { amount: 300 }),
    ev('purchase', '2026-04-01', '2026-03-01', { amount: 999 }),
  ];
  const s = M.purchaseStats(events, 'purchase', { from: '2026-03-09', to: '2026-03-31' });
  assert.deepEqual([s.n, s.amount, s.avg, s.own, s.earlier, s.medianDays], [2, 400, 200, 1, 1, 9]);
  assert.equal(M.purchaseStats(events, 'purchase', { from: '2026-05-01', to: '2026-05-02' }).avg, null);
});

test('filterEvents: группы и только новые', () => {
  const events = [ev('lead', '2026-03-01', '2026-03-01'), ev('lead', '2026-03-01', '2026-03-01', { isNew: 0, group: 'B' })];
  assert.equal(M.filterEvents(events, { onlyNew: true }).length, 1);
  assert.equal(M.filterEvents(events, { groups: new Set(['B']) }).length, 1);
  assert.equal(M.filterEvents(events, {}).length, 2);
  assert.equal(M.filterEvents(events, { dealType: 'repeat' }).length, 1);
  assert.equal(M.filterEvents(events, { dealType: 'new' })[0].isNew, 1);
  assert.equal(M.filterEvents(events, { dealType: 'all' }).length, 2);
});

test('mcBreakdown: посчитано и не посчитано по пояснениям', () => {
  const events = [
    ev('mc_held', '2026-03-05', '2026-03-01', { note: '5 0,1 Греем' }), ev('mc_held', '2026-03-06', '2026-03-01', { note: '5 0,1 Греем' }),
    ev('mc_skip', '2026-03-07', '2026-03-01', { note: 'Просроченая сделка: стадия не из списка' }), ev('mc_held', '2026-04-07', '2026-03-01', { note: 'вне периода' }),
    ev('mc_wait', '2026-03-08', '2026-03-01', { note: '0 МС назначена' }),   // дата прошла: не посчитана
    ev('mc_wait', '2026-03-25', '2026-03-01', { note: '0 МС назначена' }),   // МС ещё впереди: к сверке не относится
  ];
  const b = M.mcBreakdown(events, { from: '2026-03-01', to: '2026-03-31' }, '2026-03-10');
  assert.deepEqual(b.counted, [{ note: '5 0,1 Греем', n: 2 }]);
  assert.equal(b.skipped.reduce((a, x) => a + x.n, 0), 2);
  assert.ok(b.skipped.some((x) => x.note.includes('0 МС назначена: дата МС прошла')));
});
