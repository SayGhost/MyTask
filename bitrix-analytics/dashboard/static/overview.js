/* Общий дашборд: путь от лида до покупки по обеим воронкам.
   Главная идея: каждый этап показан «потоком» (по дате самого события) с разбивкой на лиды этого периода и прошлых. */
window.Overview = (function () {
  'use strict';
  const M = window.Metrics, UI = window.UI;
  const { h, fmtInt, fmtPct, strong } = UI;

  const GROUP_COLORS = { 'Вебинарные': 'var(--series-1)', 'Практикум': 'var(--series-2)', 'Мини-продукты': 'var(--series-3)', 'Другое': 'var(--other)' };
  const RUB = (n) => fmtInt(Math.round(n)) + ' ₽';
  const COMPACT = (v) => (v >= 1e6 ? +(v / 1e6).toFixed(1) + ' млн' : v >= 1e3 ? Math.round(v / 1e3) + ' тыс' : String(v));
  const NONE = '(не указан)';

  const FLOWS = [
    { type: 'qual', title: 'Квалы', hint: 'По дате квала' },
    { type: 'mc_booked', title: 'Записались на МС', hint: 'По дате завершения сделки на стадии «МС назначена»' },
    { type: 'mc_held', title: 'МС проведено', hint: 'По дате МС' },
    { type: 'purchase', title: 'Покупки', hint: 'По дате завершения, стадия «Передан на обучение»' },
  ];
  const COHORTS = [['qual', 'Квалы'], ['mc_booked', 'Записались на МС'], ['mc_held', 'МС проведено'], ['purchase', 'Покупки']];
  const MAX_LAG = 6;

  function create(ctx) {
    const { events: all, meta } = ctx;
    const dataEnd = meta.dateMax, dataStart = meta.dateMin, asOf = meta.asOf || meta.dateMax;
    const st = { table: false, cohort: 'qual', cohortPct: true, prevNums: {} };
    const root = h('div', { class: 'dash' });
    const ref = {};
    let cur = null;

    const F = window.Filters.create({
      state: st, prefix: 'o', dataStart, dataEnd, groups: meta.groups, groupColors: GROUP_COLORS, dealTypes: true,
      summaryLead: 'События за период ',
      maturityText: 'Последние 7 дней ещё не созрели: квалы, записи на МС и покупки по свежим лидам появятся в следующие недели. Сравнивайте полные недели и месяцы.',
      onChange: () => update(),
    });

    // ---------- расчёт ----------
    const SIX = ['lead', 'qual', 'mc_booked', 'mc_held', 'purchase', 'addon'];
    function totals(ev, range) {
      const t = {};
      for (const k of SIX) t[k] = M.flowTotals(ev, k, range);
      t.sl = M.slStats(ev, range);
      t.mc = M.mcPipeline(ev, range, asOf);
      t.buy = M.purchaseStats(ev, 'purchase', range);
      t.addon = M.purchaseStats(ev, 'addon', range);
      return t;
    }
    function compute() {
      const range = st.range;
      const { cmp, cmpNote } = F.resolve();
      const ev = M.filterEvents(all, { groups: st.groups, dealType: st.dealType });
      const evGroups = M.filterEvents(all, { groups: st.groups });
      cur = { range, cmp, cmpNote, ev, evGroups, t: totals(ev, range), p: cmp ? totals(ev, cmp) : null };
      // окно для недельных графиков: не меньше 12 недель, заканчивается концом периода
      const to = range.to > asOf ? asOf : range.to;
      let from = M.addDays(M.bucketStart(to, 'week'), -7 * 11);
      if (range.from < from) from = range.from;
      if (from < dataStart) from = dataStart;
      cur.win = { from, to, gran: M.daysBetween(from, to) > 400 ? 'month' : 'week' };
    }
    const sparkOf = (ev, type, pick) => {
      const to = asOf, from = M.addDays(M.bucketStart(to, 'week'), -7 * 11);
      const s = M.flowSeries(ev, type, 'week', from < dataStart ? M.bucketStart(dataStart, 'week') : from, to);
      return { values: s.map(pick || ((b) => b.total)), partial: s.length && s[s.length - 1].end > asOf };
    };

    // ---------- пульс ----------
    function renderPulse() {
      const t = cur.t, p = cur.p;
      const split = (x) => (x.total ? x.own / x.total : null);
      const flowNote = (x) => [strong(fmtInt(x.own)), ' из лидов периода · ', strong(fmtInt(x.earlier)), ' из прошлых'];
      const defs = [];
      const newN = M.flowTotals(cur.evGroups.filter((e) => e.isNew), 'lead', cur.range).total;
      const repN = M.flowTotals(cur.evGroups.filter((e) => !e.isNew), 'lead', cur.range).total;
      defs.push({ key: 'lead', label: 'Лиды созданы', val: t.lead.total, prev: p && p.lead.total, hero: true, note: [strong(fmtInt(newN)), ' новых · ', strong(fmtInt(repN)), ' повторных'], type: 'lead' });
      defs.push({ key: 'qual', label: 'Квалы', val: t.qual.total, prev: p && p.qual.total, note: flowNote(t.qual), split: split(t.qual), type: 'qual' });
      defs.push({ key: 'booked', label: 'Записались на МС', val: t.mc_booked.total, prev: p && p.mc_booked.total, note: flowNote(t.mc_booked), split: split(t.mc_booked), type: 'mc_booked' });
      defs.push({ key: 'held', label: 'МС проведено', val: t.mc_held.total, prev: p && p.mc_held.total, note: flowNote(t.mc_held), split: split(t.mc_held), type: 'mc_held',
        extra: [strong(fmtInt(t.mc.upcoming)), ' ожидают впереди (на 7 дней: ', strong(fmtInt(t.mc.nextWeek)), ')'] });
      defs.push({ key: 'sl', label: 'Стали SL', val: t.sl.in, prev: p && p.sl.in, note: ['ушли ', strong(fmtInt(t.sl.out)), ' · чистый ', strong((t.sl.net > 0 ? '+' : t.sl.net < 0 ? '−' : '') + fmtInt(Math.abs(t.sl.net)))],
        extra: ['сейчас в SL: ', strong(fmtInt(t.sl.now))], type: 'sl_in' });
      defs.push({ key: 'buy', label: 'Покупки', val: t.buy.n, prev: p && p.buy.n, note: [strong(RUB(t.buy.amount)), t.buy.avg != null ? ` · чек ${RUB(t.buy.avg)}` : ''], split: t.buy.n ? t.buy.own / t.buy.n : null, type: 'purchase' });
      ref.pulse.replaceChildren(...defs.map((d) => {
        const countFrom = st.prevNums[d.key];
        st.prevNums[d.key] = d.val;
        const sp = sparkOf(cur.ev, d.type);
        const tl = UI.tile({
          hero: d.hero, label: d.label, num: d.val, countFrom, note: d.note, split: d.split,
          delta: d.prev != null ? UI.deltaChip(d.val, d.prev, 'count', true) : null,
          prevText: d.prev != null ? `было ${fmtInt(d.prev)}` : null, spark: UI.spark(sp.values, sp.partial),
        });
        if (d.extra) tl.querySelector('.note').after(h('div', { class: 'note' }, ...d.extra));
        return tl;
      }));
    }

    // ---------- поток по неделям ----------
    const flowSeriesFor = (type) => M.flowSeries(cur.ev, type, cur.win.gran, cur.win.from, cur.win.to)
      .map((b) => ({ start: b.start, end: b.end, total: b.total, by: { same: b.same, prev: b.prev, older: b.older } }));
    function renderFlows() {
      const g = cur.win.gran === 'month' ? 'месяца' : 'недели';
      const series = [
        { key: 'same', label: `Из лидов этой ${g === 'месяца' ? 'месяца' : 'недели'}`, color: 'var(--series-1)' },
        { key: 'prev', label: `Из лидов прошлой ${g === 'месяца' ? 'месяца' : 'недели'}`, color: 'var(--series-3)' },
        { key: 'older', label: 'Из более старых лидов', color: 'var(--other)' },
      ];
      ref.flowLegend.replaceChildren(...series.map((s) => h('span', {}, h('i', { class: 'sw', style: 'background:' + s.color }), s.label)));
      if (st.table) {
        const rows = M.flowSeries(cur.ev, 'qual', cur.win.gran, cur.win.from, cur.win.to);
        const by = Object.fromEntries(FLOWS.map((f) => [f.type, M.flowSeries(cur.ev, f.type, cur.win.gran, cur.win.from, cur.win.to)]));
        const head = h('tr', {}, h('th', { text: 'Период' }), ...FLOWS.flatMap((f) => [h('th', { text: f.title }), h('th', { text: 'из своих' })]));
        const body = rows.map((r, i) => h('tr', {}, h('td', { text: UI.bucketTitle(r, cur.win.gran) }), ...FLOWS.flatMap((f) => [h('td', { text: fmtInt(by[f.type][i].total) }), h('td', { class: 'rate', text: fmtInt(by[f.type][i].same) })])));
        ref.flowGrid.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body))));
        return;
      }
      // сначала вставляем карточки на страницу, потом рисуем: графику нужна реальная ширина контейнера
      const boxes = FLOWS.map((f) => {
        const box = h('div', { class: 'chart' });
        return { f, box, card: h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: f.title }), h('p', { class: 'hint', text: f.hint }))), box) };
      });
      ref.flowGrid.replaceChildren(...boxes.map((x) => x.card));
      for (const { f, box } of boxes) UI.stackedColumns(box, flowSeriesFor(f.type), series, { gran: cur.win.gran, dataEnd: asOf, height: 220, ariaLabel: f.title + ' по периодам' });
    }

    // ---------- когорты ----------
    function renderCohorts() {
      const type = st.cohort;
      const to = asOf;
      let from = M.addDays(M.bucketStart(to, 'week'), -7 * 11);
      if (from < dataStart) from = M.bucketStart(dataStart, 'week');
      const matrix = M.cohortMatrix(cur.ev, type, { from, to, maxLag: MAX_LAG, asOf });
      if (!matrix.some((r) => r.size)) return UI.empty(ref.cohort, 'Нет лидов в выбранных фильтрах');
      const maxRate = Math.max(0.01, ...matrix.flatMap((r) => r.cells.map((c) => c.rate || 0)));
      const heat = (rate) => (rate == null ? '' : `background: color-mix(in srgb, var(--series-1) ${Math.round(6 + (rate / maxRate) * 54)}%, transparent)`);
      const show = (c, size) => (c.future ? '·' : st.cohortPct ? (size ? fmtPct(c.rate) : '—') : fmtInt(c.n));
      const lagTitle = (k) => (k === 0 ? 'В неделю создания' : `+${k} нед.`);
      const head = h('tr', {}, h('th', { text: 'Неделя создания лидов' }), h('th', { text: 'Лидов' }), ...Array.from({ length: MAX_LAG + 1 }, (_, k) => h('th', { text: lagTitle(k) })), h('th', { text: 'Позже' }), h('th', { text: 'Всего' }));
      const body = matrix.map((r) => h('tr', {},
        h('td', { text: UI.bucketTitle({ start: r.start, end: M.bucketEnd(r.start, 'week') }, 'week') }),
        h('td', { text: fmtInt(r.size) }),
        ...r.cells.map((c) => h('td', { class: 'cohort-cell' + (c.future ? ' future' : ''), style: heat(c.rate), title: c.future ? 'Эта неделя ещё не наступила' : `${fmtInt(c.n)} из ${fmtInt(r.size)} лидов` , text: show(c, r.size) })),
        h('td', { text: st.cohortPct ? fmtPct(r.size ? r.later / r.size : null) : fmtInt(r.later) }),
        h('td', { class: 'strongcell', text: st.cohortPct ? fmtPct(r.size ? r.total / r.size : null) : fmtInt(r.total) })));
      // средняя кривая: сколько в среднем от лидов происходит на каждой неделе после создания (только по «созревшим» неделям)
      const avg = Array.from({ length: MAX_LAG + 1 }, (_, k) => {
        const rows = matrix.filter((r) => !r.cells[k].future && r.size);
        const n = rows.reduce((a, r) => a + r.cells[k].n, 0), size = rows.reduce((a, r) => a + r.size, 0);
        return st.cohortPct ? fmtPct(size ? n / size : null) : fmtInt(n);
      });
      const foot = h('tr', {}, h('td', { text: 'В среднем' }), h('td', { text: '' }), ...avg.map((t) => h('td', { text: t })), h('td', {}), h('td', {}));
      ref.cohort.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'cohort' }, h('thead', {}, head), h('tbody', {}, ...body), h('tfoot', {}, foot))));
      [...ref.cohortTabs.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === st.cohort)));
    }

    // ---------- МС ----------
    function renderMc() {
      const t = cur.t, mc = t.mc;
      const rows = [
        { label: 'Записались на МС', value: mc.booked.total, color: 'var(--series-1)', text: fmtInt(mc.booked.total),
          tip: [{ label: 'Всего за период', value: fmtInt(mc.booked.total) }, { label: 'Из лидов периода', value: fmtInt(mc.booked.own) }, { label: 'Из прошлых', value: fmtInt(mc.booked.earlier) }] },
        { label: 'МС проведено', value: mc.held.total, color: 'var(--series-3)', text: fmtInt(mc.held.total),
          tip: [{ label: 'Всего за период (по дате МС)', value: fmtInt(mc.held.total) }, { label: 'Из лидов периода', value: fmtInt(mc.held.own) }, { label: 'Из прошлых', value: fmtInt(mc.held.earlier) }] },
        { label: 'Ожидают впереди', value: mc.upcoming, color: 'var(--other)', text: fmtInt(mc.upcoming),
          tip: [{ label: 'Дата МС ещё впереди', value: fmtInt(mc.upcoming) }, { label: 'В ближайшие 7 дней', value: fmtInt(mc.nextWeek) }] },
        { label: 'Зависли: дата МС прошла', value: mc.stale, color: 'var(--series-2)', text: fmtInt(mc.stale),
          tip: [{ label: 'Дата МС прошла, но МС не проведена и сделка не движется', value: fmtInt(mc.stale) }, { label: 'Из них с датой МС в периоде', value: fmtInt(mc.staleInPeriod) }] },
      ];
      UI.hBars(ref.mcBars, rows, { ariaLabel: 'Записи на МС, проведённые, ожидающие и зависшие' });
      ref.mcNote.replaceChildren(
        h('li', {}, 'Записаны и проведены считаются по разным датам (дата записи и дата МС), поэтому за короткий период числа не обязаны совпадать (МС проходит через несколько дней после записи).'),
        h('li', {}, 'Из проведённых за период: ', strong(fmtInt(mc.held.own)), ' из лидов периода и ', strong(fmtInt(mc.held.earlier)), ' из прошлых.'),
        h('li', {}, '«Ожидают впереди» и «Зависли» показаны на сегодня, не ограничены выбранным периодом.'),
        h('li', {}, 'МС считается проведённой по правилу из «Как считаются показатели» (стадия, дата МС, причина отказа).'));
    }

    function renderMcBreakdown() {
      const b = M.mcBreakdown(cur.ev, cur.range, asOf);
      const total = (x) => x.reduce((a, r) => a + r.n, 0);
      const table = (title, rows, cls) => h('div', { class: 'bd ' + cls },
        h('h3', { text: `${title}: ${fmtInt(total(rows))}` }),
        rows.length ? h('table', {}, h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', { text: r.note }), h('td', { text: fmtInt(r.n) }))))) : h('p', { class: 'hint', text: 'Нет' }));
      ref.mcBreakdown.replaceChildren(
        table('Посчитано как проведённые', b.counted, 'ok'),
        table('Не посчитано', b.skipped, 'no'));
    }

    // ---------- SL ----------
    function renderSl() {
      const t = cur.t, p = cur.p, sl = t.sl;
      const one = (title, val, prev, note) => {
        const countFrom = st.prevNums['sl_' + title];
        st.prevNums['sl_' + title] = val;
        return UI.tile({ label: title, num: val, countFrom, note: note ? [note] : null, delta: prev != null ? UI.deltaChip(val, prev, 'count', true) : null });
      };
      const net = h('div', { class: 'tile' }, h('div', { class: 'label', text: 'Чистый прирост' }), h('div', { class: 'value', text: (sl.net > 0 ? '+' : sl.net < 0 ? '−' : '') + fmtInt(Math.abs(sl.net)) }), h('div', { class: 'note', text: 'стали минус ушли' }));
      ref.slTiles.replaceChildren(
        one('Стали SL', sl.in, p && p.sl.in, 'за период'), one('Ушли из SL', sl.out, p && p.sl.out, 'за период'), net,
        one('Сейчас в SL', sl.now, null, sl.undated ? `у ${fmtInt(sl.undated)} нет даты входа` : null));
      const mk = (type) => M.flowSeries(cur.ev, type, cur.win.gran, cur.win.from, cur.win.to).map((b) => ({ start: b.start, end: b.end, total: b.total, by: { n: b.total } }));
      UI.stackedColumns(ref.slIn, mk('sl_in'), [{ key: 'n', label: 'Стали SL', color: 'var(--series-3)' }], { gran: cur.win.gran, dataEnd: asOf, height: 200, ariaLabel: 'Стали SL по периодам' });
      UI.stackedColumns(ref.slOut, mk('sl_out'), [{ key: 'n', label: 'Ушли из SL', color: 'var(--series-2)' }], { gran: cur.win.gran, dataEnd: asOf, height: 200, ariaLabel: 'Ушли из SL по периодам' });
      ref.slNote.textContent = 'Поле «SL лид» хранит только последнее состояние: стал, потерял и снова стал считается по последней дате изменения. SL без даты входа попадают только в «Сейчас в SL».';
    }

    // ---------- продажи ----------
    function renderSales() {
      const t = cur.t, p = cur.p, b = t.buy, a = t.addon;
      const mk = (label, key, num, fmt, prevNum, note) => {
        const countFrom = st.prevNums[key]; st.prevNums[key] = num;
        const el = UI.tile({ label, value: fmt(num), note, delta: prevNum != null ? UI.deltaChip(num, prevNum, 'count', true) : null });
        const v = el.querySelector('.value');
        if (countFrom != null && countFrom !== num && !UI.reduced()) UI.countUp(v, num, fmt, countFrom);
        return el;
      };
      ref.salesTiles.replaceChildren(
        mk('Покупки', 'buy_n', b.n, fmtInt, p && p.buy.n, [strong(fmtInt(b.own)), ' из лидов периода · ', strong(fmtInt(b.earlier)), ' из прошлых']),
        mk('Сумма покупок', 'buy_sum', b.amount, RUB, p && p.buy.amount, null),
        UI.tile({ label: 'Средний чек', value: b.avg != null ? RUB(b.avg) : '—', delta: p && p.buy.avg != null && b.avg != null ? UI.deltaChip(b.avg, p.buy.avg, 'count', true, true) : null }),
        UI.tile({ label: 'Дней от создания лида до покупки', value: b.medianDays != null ? fmtInt(b.medianDays) : '—', note: ['медиана'] }),
        mk('Доп. продукт', 'addon_n', a.n, fmtInt, p && p.addon.n, [strong(RUB(a.amount)), ' сумма']));
      const buy = M.flowSeries(cur.ev, 'purchase', cur.win.gran, cur.win.from, cur.win.to);
      UI.stackedColumns(ref.buyAmount, buy.map((x) => ({ start: x.start, end: x.end, total: Math.round(x.amount), by: { sum: Math.round(x.amount) } })),
        [{ key: 'sum', label: 'Сумма покупок', color: 'var(--series-1)' }], { gran: cur.win.gran, dataEnd: asOf, height: 220, fmtTick: COMPACT, fmtValue: RUB, ariaLabel: 'Сумма покупок по периодам' });
      UI.stackedColumns(ref.buyCount, buy.map((x) => ({ start: x.start, end: x.end, total: x.total, by: { own: x.same, prev: x.prev, older: x.older } })),
        [{ key: 'own', label: 'Из лидов этого периода', color: 'var(--series-1)' }, { key: 'prev', label: 'Из лидов прошлого', color: 'var(--series-3)' }, { key: 'older', label: 'Из более старых', color: 'var(--other)' }],
        { gran: cur.win.gran, dataEnd: asOf, height: 220, ariaLabel: 'Число покупок по периодам' });
      // по группам источников
      const buys = cur.ev.filter((e) => e.type === 'purchase' && e.date >= cur.range.from && e.date <= cur.range.to);
      const totalAmount = buys.reduce((s, e) => s + e.amount, 0);
      const rows = meta.groups.filter((g) => !st.groups || st.groups.has(g)).map((g) => {
        const x = buys.filter((e) => e.group === g), sum = x.reduce((s, e) => s + e.amount, 0);
        return { label: g, value: sum, color: GROUP_COLORS[g], text: `${RUB(sum)} · ${fmtPct(totalAmount ? sum / totalAmount : null)}`,
          tip: [{ label: 'Покупок', value: fmtInt(x.length) }, { label: 'Сумма', value: RUB(sum) }, { label: 'Средний чек', value: x.length ? RUB(sum / x.length) : '—' }] };
      });
      UI.hBars(ref.buyGroups, rows, { emptyText: 'За период нет покупок', ariaLabel: 'Сумма покупок по группам источников' });
    }

    // ---------- материалы ----------
    function renderMaterials() {
      const take = (type, field, box, emptyText) => {
        const ev = cur.ev.filter((e) => e.type === type && e.date >= cur.range.from && e.date <= cur.range.to && e[field]);
        const rest = cur.ev.filter((e) => e.type === type && e.date >= cur.range.from && e.date <= cur.range.to).length - ev.length;
        const counts = M.countBy(ev, (e) => e[field]).slice(0, 10);
        UI.hBars(box, counts.map((c) => ({ label: c.key, value: c.n, text: `${fmtInt(c.n)} · ${fmtPct(c.n / (ev.length + rest))}`,
          tip: [{ label: 'Сделок', value: fmtInt(c.n) }, { label: 'От всех за период', value: fmtPct(c.n / (ev.length + rest)) }] })),
          { emptyText, ariaLabel: 'Материалы' });
        return { filled: ev.length, rest };
      };
      const a = take('sl_in', 'matSl', ref.matSl, 'Поле «Материал, который довёл клиента до SL» пока не заполнено. Данные появятся по мере заполнения.');
      const b = take('mc_booked', 'matMc', ref.matMc, 'Поле «Материал, после которого закрыли на МС» пока почти не заполнено. Данные появятся по мере заполнения.');
      ref.matNote.textContent = `Заполнено: до SL — у ${fmtInt(a.filled)} из ${fmtInt(a.filled + a.rest)} за период, перед МС — у ${fmtInt(b.filled)} из ${fmtInt(b.filled + b.rest)}.`;
    }

    // ---------- каркас ----------
    const card = (title, hint, ...c) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: title }), hint ? h('p', { class: 'hint', text: hint }) : null)), ...c);
    const section = (id, title, ...c) => h('div', { class: 'block', id }, h('h2', { class: 'block-title', text: title }), ...c);
    const withTools = (c, ...tools) => { c.querySelector('.card-head').append(h('div', { class: 'card-tools' }, ...tools)); return c; };

    function build() {
      root.append(F.el);
      if (!meta.hasSales) root.append(h('p', { class: 'maturity' }, 'Нет выгрузки воронки «Продажи»: блоки «МС проведено», SL и покупки пустые. Положите её в папку data рядом с выгрузкой «Консультантов».'));
      const nav = h('nav', { class: 'subnav', 'aria-label': 'Разделы' });
      for (const [id, t] of [['pulse', 'Пульс'], ['flow', 'Поток'], ['cohorts', 'Когорты'], ['mc', 'МС'], ['sl', 'SL'], ['sales', 'Продажи'], ['materials', 'Материалы']]) nav.append(h('a', { href: '#' + id, text: t, 'data-scroll': id }));
      nav.addEventListener('click', (e) => {
        const id = e.target.dataset && e.target.dataset.scroll;
        if (!id) return;
        e.preventDefault();
        document.getElementById('o-' + id).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      root.append(nav);

      Object.assign(ref, {
        pulse: h('div', { class: 'kpis kpis-6' }), flowLegend: h('div', { class: 'legend' }), flowGrid: h('div', { class: 'grid-2 flow-grid' }),
        cohort: h('div'), cohortTabs: h('div', { class: 'seg multi', role: 'group', 'aria-label': 'Событие' }),
        mcBars: h('div', { class: 'chart' }), mcNote: h('ul', { class: 'bullets' }), mcBreakdown: h('div', { class: 'grid-2' }),
        slTiles: h('div', { class: 'kpis kpis-4' }), slIn: h('div', { class: 'chart' }), slOut: h('div', { class: 'chart' }), slNote: h('p', { class: 'hint' }),
        salesTiles: h('div', { class: 'kpis kpis-5' }), buyAmount: h('div', { class: 'chart' }), buyCount: h('div', { class: 'chart' }), buyGroups: h('div', { class: 'chart' }),
        matSl: h('div', { class: 'chart' }), matMc: h('div', { class: 'chart' }), matNote: h('p', { class: 'hint' }),
      });
      for (const [k, t] of COHORTS) {
        const b = h('button', { type: 'button', text: t, 'data-type': k });
        b.addEventListener('click', () => { st.cohort = k; renderCohorts(); });
        ref.cohortTabs.append(b);
      }
      const pct = h('input', { type: 'checkbox', checked: true });
      pct.addEventListener('change', () => { st.cohortPct = pct.checked; renderCohorts(); });
      const tableBtn = h('button', { type: 'button', class: 'btn', text: 'Таблица' });
      tableBtn.addEventListener('click', () => { st.table = !st.table; tableBtn.textContent = st.table ? 'Графики' : 'Таблица'; renderFlows(); });

      root.append(
        section('o-pulse', 'Пульс периода', ref.pulse),
        section('o-flow', 'Поток по неделям',
          withTools(card('Сколько произошло за период и из каких лидов', 'Каждое событие считается по дате, когда оно случилось. Цвет показывает, когда был создан лид. Неполный период бледнее', ref.flowLegend), tableBtn),
          ref.flowGrid),
        section('o-cohorts', 'Когорты',
          withTools(card('Как быстро лиды доходят до этапа', 'Строка: лиды, созданные в неделю. Столбец: через сколько недель после создания случилось событие. Последние 12 недель', ref.cohortTabs, ref.cohort),
            h('label', { class: 'check' }, pct, 'В процентах от лидов'))),
        section('o-mc', 'МС: записаны, проведены, ожидают',
          h('div', { class: 'grid-2' }, card('Воронка МС', 'Записи и проведённые за период, ожидающие и зависшие на сегодня', ref.mcBars), card('Как читать', null, ref.mcNote)),
          card('Из чего сложилось «МС проведено»', 'Все сделки с датой МС в выбранном периоде: что посчитано и что нет, и по какой причине. Для сверки с вашим подсчётом', ref.mcBreakdown)),
        section('o-sl', 'SL лиды', ref.slTiles,
          h('div', { class: 'grid-2' }, card('Стали SL', 'По дате изменения SL', ref.slIn), card('Ушли из SL', 'По дате изменения SL', ref.slOut)), card('Важно', null, ref.slNote)),
        section('o-sales', 'Продажи', ref.salesTiles,
          h('div', { class: 'grid-2' }, card('Сумма покупок', 'По дате завершения', ref.buyAmount), card('Число покупок', 'Цвет: когда создан лид', ref.buyCount)),
          card('Выручка по группам источников', 'Источник берётся из копии сделки в «Продажах» (в ней он продублирован)', ref.buyGroups)),
        section('o-materials', 'Что приводит к SL и МС',
          h('div', { class: 'grid-2' }, card('Материал, который довёл до SL', 'Стали SL за период', ref.matSl), card('Материал, после которого закрыли на МС', 'Записались на МС за период', ref.matMc)), ref.matNote));
    }

    function update() {
      root.classList.remove('no-anim');
      compute();
      F.sync(cur);
      renderPulse(); renderFlows(); renderCohorts(); renderMc(); renderMcBreakdown(); renderSl(); renderSales(); renderMaterials();
    }
    function resize() {
      if (!cur) return;
      root.classList.add('no-anim');
      renderFlows(); renderMc(); renderSl(); renderSales(); renderMaterials();
    }
    build();
    return { el: root, resize, update };
  }
  return { create };
})();
