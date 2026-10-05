// Запуск: node --test tests/metrics.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../static/metrics.js');

const deal = (created, source, o = {}) => ({ created, source, isNew: 1, webinar: 0, reached: 0, qual: 0, mc: 0, ...o });

const deals = [
  deal('2026-03-02', 'A', { webinar: 1, reached: 1, qual: 1, mc: 1 }),
  deal('2026-03-03', 'A', { webinar: 1, reached: 1, qual: 1 }),
  deal('2026-03-09', 'A'),
  deal('2026-03-10', 'B', { webinar: 1, mc: 1 }), // МС без квала: в «квал → МС» не входит
  deal('2026-03-10', 'B', { isNew: 0, webinar: 1 }),
];

test('decode превращает строки в объекты', () => {
  const out = M.decode({ fields: ['created', 'source'], rows: [['2026-01-01', 'X']] });
  assert.deepEqual(out, [{ created: '2026-01-01', source: 'X' }]);
});

test('filterDeals: период включительно, источники, только новые', () => {
  assert.equal(M.filterDeals(deals, { from: '2026-03-03', to: '2026-03-09' }).length, 2);
  assert.equal(M.filterDeals(deals, { onlyNew: true }).length, 4);
  assert.equal(M.filterDeals(deals, { sources: new Set(['B']) }).length, 2);
  assert.equal(M.filterDeals(deals, {}).length, 5);
});

test('summarize и rates', () => {
  const t = M.summarize(deals.slice(0, 4));
  assert.deepEqual(t, { deals: 4, webinar: 3, reached: 2, qual: 2, mc: 2, qualMc: 1 });
  const r = M.rates(t);
  assert.equal(r.webinarRate, 0.75);
  assert.equal(r.qualToMc, 0.5);
  assert.equal(M.rates(M.summarize([])).webinarRate, null);
});

test('bySource считает по источникам', () => {
  const rows = M.bySource(deals);
  const a = rows.find((r) => r.source === 'A');
  assert.equal(a.deals, 3);
  assert.equal(a.qual, 2);
  assert.equal(a.qualToMc, 0.5);
});

test('bucketStart: неделя начинается с понедельника, месяц с 1-го', () => {
  assert.equal(M.bucketStart('2026-03-08', 'week'), '2026-03-02'); // воскресенье
  assert.equal(M.bucketStart('2026-03-09', 'week'), '2026-03-09'); // понедельник
  assert.equal(M.bucketStart('2026-03-31', 'month'), '2026-03-01');
  assert.equal(M.nextBucket('2026-12-01', 'month'), '2027-01-01');
});

test('series заполняет пустые периоды нулями', () => {
  const s = M.series(deals, 'week', '2026-03-02', '2026-03-23');
  assert.deepEqual(s.map((b) => [b.start, b.deals]), [['2026-03-02', 2], ['2026-03-09', 3], ['2026-03-16', 0], ['2026-03-23', 0]]);
  assert.equal(s[2].webinarRate, null); // деление на ноль → нет точки на графике
});

test('autoGranularity', () => {
  assert.equal(M.autoGranularity('2026-03-01', '2026-03-30'), 'day');
  assert.equal(M.autoGranularity('2026-01-01', '2026-10-05'), 'week');
  assert.equal(M.autoGranularity('2024-01-01', '2026-10-05'), 'month');
});
