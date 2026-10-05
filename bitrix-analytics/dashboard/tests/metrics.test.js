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

