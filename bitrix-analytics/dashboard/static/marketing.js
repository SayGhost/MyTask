/* Маркетинговый дашборд: лиды → мероприятие → дозвон → квал → МС, с атрибуцией по дате создания лида. */
window.Marketing = (function () {
  'use strict';
  const M = window.Metrics, UI = window.UI;
  const { h, fmtInt, fmtPct, strong } = UI;

  const GROUP_COLORS = { 'Вебинарные': 'var(--series-1)', 'Практикум': 'var(--series-2)', 'Мини-продукты': 'var(--series-3)', 'Другое': 'var(--other)' };
  const PRESETS = [
    ['thisWeek', 'Эта неделя'], ['lastWeek', 'Прошлая неделя'], ['thisMonth', 'Этот месяц'],
    ['lastMonth', 'Прошлый месяц'], ['last30', '30 дней'], ['all', 'Всё время'],
  ];
  const COMPARE = [['prev', 'С предыдущим периодом'], ['year', 'С тем же периодом прошлого года'], ['custom', 'Со своим периодом'], ['none', 'Без сравнения']];
  const UTM_LEVELS = [['utm_source', 'source'], ['utm_medium', 'medium'], ['utm_campaign', 'campaign'], ['utm_content', 'content'], ['utm_term', 'term']];
  const NONE = '(не указано)';
  const KPIS = [
    { key: 'leads', value: (t) => t.leads },
    { key: 'webinar', label: 'Посетили мероприятие', value: (t) => t.webinar, rate: (r) => r.webinarRate, rateText: 'от лидов', rateLabel: 'доходимость' },
    { key: 'reached', label: 'Дозвонились', value: (t) => t.reached, rate: (r) => r.reachedRate, rateText: 'от лидов' },
    { key: 'qual', label: 'Квал', value: (t) => t.qual, rate: (r) => r.qualFromReached, rateText: 'из дозвонившихся' },
    { key: 'mc', label: 'МС назначено', value: (t) => t.mc, rate: (r) => r.mcFromQual, rateText: 'из квалов' },
  ];
  const SCORE_DIMS = [
    { id: 'stars', label: 'Звёзды ★', field: 'stars', ordinal: 'asc', order: ['1★', '2★', '3★', '4★', '5★'] },
    { id: 'grade', label: 'Оценка A–F', field: 'grade', ordinal: 'desc', order: ['A', 'B', 'C', 'D', 'E', 'F'] },
    { id: 'band', label: 'Балл', field: 'band', ordinal: 'asc', order: ['до 0', '1–3', '4–6', '7 и выше'] },
    { id: 'segment', label: 'Сегмент', field: 'segment' },
    { id: 'expert', label: 'Эксперты', field: 'portrait', prefix: 'Эксперт - ' },
    { id: 'newbie', label: 'Новички', field: 'portrait', prefix: 'Новичок - ' },
    { id: 'self', label: 'Для себя', field: 'portrait', prefix: 'Для себя - ' },
  ];
  const CAT_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

  const label = (v) => (v === '' || v == null ? NONE : v);
  const heat = (v, max) => `background: color-mix(in srgb, var(--series-1) ${Math.round(4 + (max > 0 ? v / max : 0) * 26)}%, transparent)`;

  function create(ctx) {
    const { deals: all, meta } = ctx;
    const dataEnd = meta.dateMax, dataStart = meta.dateMin;
    const st = {
      preset: 'lastWeek', range: M.presetRange('lastWeek', dataEnd, dataStart), compare: 'prev', customCompare: null,
      groups: null, repeats: false, gran: 'auto', table: { leads: false, rates: false },
      scoreDim: 'segment', scorePct: false, tree: {}, prevNums: {},
    };
    const root = h('div', { class: 'dash' });
    const ref = {};
    let cur = null;

    // ---------- расчёт ----------
    const base = () => M.filterDeals(all, { groups: st.groups, onlyNew: !st.repeats });
    const slice = (deals, r) => (r ? deals.filter((d) => d.created >= r.from && d.created <= r.to) : []);
    function compute() {
      const b = base();
      const range = st.range;
      let cmp = st.compare === 'custom' ? st.customCompare : M.comparePeriod(range, st.preset, st.compare);
      // период сравнения целиком до начала данных: сравнивать не с чем
      let cmpNote = null;
      if (cmp && cmp.to < dataStart) { cmpNote = 'Сравнение недоступно: период сравнения раньше первых данных (' + UI.fmtDay(dataStart) + ').'; cmp = null; }
      else if (cmp && cmp.from < dataStart) cmpNote = 'Период сравнения начинается раньше данных, поэтому он неполный: цифры «было» занижены.';
      const now = slice(b, range), prev = cmp ? slice(b, cmp) : null;
      cur = { base: b, range, cmp, cmpNote, now, prev, t: M.summarize(now), pt: prev ? M.summarize(prev) : null };
      cur.r = M.rates(cur.t);
      cur.pr = cur.pt ? M.rates(cur.pt) : null;
      cur.gran = st.gran === 'auto' ? M.autoGranularity(range.from, range.to) : st.gran;
    }

    // ---------- управление (основная область) ----------
    function dateInput(id, label) {
      return h('label', { class: 'dateinput' }, h('span', { class: 'sr-only', text: label }), h('input', { type: 'date', id, min: dataStart, max: dataEnd }));
    }
    const inputOf = (box) => box.querySelector('input');
    function buildControls() {
      const presets = h('div', { class: 'seg', role: 'group', 'aria-label': 'Период' });
      for (const [k, t] of PRESETS) {
        const b = h('button', { type: 'button', text: t, 'data-preset': k });
        b.addEventListener('click', () => setPreset(k));
        presets.append(b);
      }
      ref.presets = presets;

      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Группы источников' });
      for (const g of meta.groups) {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true' }, h('i', { class: 'dot', style: 'background:' + GROUP_COLORS[g] }), g);
        b.addEventListener('click', () => {
          const next = new Set(st.groups || meta.groups);
          next.has(g) ? next.delete(g) : next.add(g);
          st.groups = next.size === meta.groups.length ? null : next;
          update();
        });
        chips.append(b);
      }
      ref.chips = chips;
      const rep = h('input', { type: 'checkbox' });
      rep.addEventListener('change', () => { st.repeats = rep.checked; update(); });
      ref.repeats = h('label', { class: 'check' }, rep, 'Включать повторные сделки');

      ref.from = dateInput('m-from', 'С даты'); ref.to = dateInput('m-to', 'По дату');
      for (const el of [ref.from, ref.to]) inputOf(el).addEventListener('change', onCustomRange);
      ref.compareSel = h('select', { 'aria-label': 'Сравнение' });
      for (const [k, t] of COMPARE) ref.compareSel.append(h('option', { value: k, text: t }));
      ref.compareSel.addEventListener('change', () => {
        st.compare = ref.compareSel.value;
        if (st.compare === 'custom' && !st.customCompare) st.customCompare = M.comparePeriod(st.range, st.preset, 'prev');
        update();
      });
      ref.cFrom = dateInput('m-cfrom', 'Сравнение с даты'); ref.cTo = dateInput('m-cto', 'Сравнение по дату');
      for (const el of [ref.cFrom, ref.cTo]) inputOf(el).addEventListener('change', () => {
        const f = inputOf(ref.cFrom).value, t = inputOf(ref.cTo).value;
        if (f && t) { st.customCompare = f <= t ? { from: f, to: t } : { from: t, to: f }; update(); }
      });
      ref.cBox = h('span', { class: 'dates' }, h('span', { class: 'muted', text: 'сравнить с' }), ref.cFrom, h('span', { 'aria-hidden': 'true', text: '—' }), ref.cTo);

      ref.summary = h('p', { class: 'period-summary' });
      ref.maturity = h('p', { class: 'maturity', hidden: true });
      return h('section', { class: 'filters controls', 'aria-label': 'Фильтры' },
        h('div', { class: 'row' }, presets, h('span', { class: 'dates' }, ref.from, h('span', { 'aria-hidden': 'true', text: '—' }), ref.to), ref.compareSel, ref.cBox),
        h('div', { class: 'row' }, chips, ref.repeats),
        ref.summary, ref.maturity);
    }

    function setPreset(k) {
      st.preset = k;
      st.range = M.presetRange(k, dataEnd, dataStart);
      if (st.range.from < dataStart) st.range.from = dataStart;
      update();
    }
    function onCustomRange() {
      const f = inputOf(ref.from).value || dataStart, t = inputOf(ref.to).value || dataEnd;
      st.preset = 'custom';
      st.range = f <= t ? { from: f, to: t } : { from: t, to: f };
      update();
    }
    function syncControls() {
      for (const b of ref.presets.children) b.setAttribute('aria-pressed', String(b.dataset.preset === st.preset));
      inputOf(ref.from).value = st.range.from;
      inputOf(ref.to).value = st.range.to;
      ref.compareSel.value = st.compare;
      ref.cBox.hidden = st.compare !== 'custom';
      if (cur.cmp) { inputOf(ref.cFrom).value = cur.cmp.from; inputOf(ref.cTo).value = cur.cmp.to; }
      [...ref.chips.children].forEach((b, i) => b.setAttribute('aria-pressed', String(!st.groups || st.groups.has(meta.groups[i]))));
      ref.summary.replaceChildren(...[
        h('span', {}, 'Лиды, созданные ', strong(UI.fmtRange(cur.range))),
        cur.cmp ? h('span', {}, ' · сравнение: ', strong(UI.fmtRange(cur.cmp))) : null,
        h('span', { class: 'muted', text: ` · по ${UI.fmtDay(dataEnd)} данные есть` }),
        cur.cmpNote ? h('span', { class: 'warn', text: ' · ' + cur.cmpNote }) : null].filter(Boolean));
      // последние дни ещё «дозревают»: дозвон, квал и МС появляются позже создания лида
      const young = cur.range.to > M.addDays(dataEnd, -7);
      ref.maturity.hidden = !young;
      ref.maturity.textContent = 'Последние 7 дней ещё не созрели: дозвон, квал и МС у свежих лидов появляются через несколько дней. Для честного сравнения берите полные недели или месяцы.';
    }

    // ---------- обзор: карточки ----------
    function weeklyContext() {
      const to = dataEnd, from = M.addDays(M.bucketStart(dataEnd, 'week'), -7 * 11);
      const weeks = M.series(base(), 'week', from < dataStart ? M.bucketStart(dataStart, 'week') : from, to);
      return { weeks, partial: M.bucketEnd(weeks[weeks.length - 1].start, 'week') > dataEnd };
    }
    function renderKpis() {
      const ctxWeeks = weeklyContext();
      ref.kpis.replaceChildren(...KPIS.map((k) => {
        const val = k.value(cur.t), pval = cur.pt ? k.value(cur.pt) : null;
        const rate = k.rate ? k.rate(cur.r) : null, prate = k.rate && cur.pr ? k.rate(cur.pr) : null;
        const chips = [];
        if (cur.pt) {
          chips.push(UI.deltaChip(val, pval, 'count', true));
          if (k.rate) chips.push(UI.deltaChip(rate, prate, 'rate', true));
        }
        const countFrom = st.prevNums[k.key];
        st.prevNums[k.key] = val;
        return UI.tile({
          hero: k.key === 'leads',
          label: k.label || (st.repeats ? 'Лиды' : 'Новые лиды'),
          num: val, countFrom,
          note: k.rate ? [strong(fmtPct(rate)), ' ' + k.rateText] : ['созданы в периоде'],
          delta: chips.length ? h('span', {}, ...chips.filter(Boolean).flatMap((c, i) => (i ? [' ', c] : [c]))) : null,
          prevText: cur.pt ? `было ${fmtInt(pval)}${k.rate ? ' · ' + fmtPct(prate) : ''}` : null,
          spark: UI.spark(ctxWeeks.weeks.map((b) => k.value(b)), ctxWeeks.partial),
        });
      }));
    }

    // ---------- «что изменилось» ----------
    function renderInsights() {
      const box = ref.insights;
      if (!cur.prev) return box.replaceChildren(h('p', { class: 'empty', text: 'Включите сравнение, и здесь появится список главных изменений.' }));
      const items = [];
      const byKey = (deals, fn) => new Map(M.countBy(deals, fn).map((x) => [x.key, x.n]));
      for (const [name, fn] of [['Группа', (d) => d.group], ['UTM source', (d) => label(d.utm_source)]]) {
        const a = byKey(cur.now, fn), b = byKey(cur.prev, fn);
        for (const key of new Set([...a.keys(), ...b.keys()])) {
          const n = a.get(key) || 0, p = b.get(key) || 0, big = Math.max(n, p);
          if (big < 15) continue;
          const d = M.delta(n, p);
          if (Math.abs(d.abs) < 8 || (d.rel != null && Math.abs(d.rel) < 0.2)) continue;
          items.push({ score: Math.abs(d.abs), kind: 'Объём', text: `${key}: лиды ${fmtInt(p)} → ${fmtInt(n)}`, chip: UI.deltaChip(n, p, 'count', true) });
        }
      }
      for (const g of meta.groups) {
        if (st.groups && !st.groups.has(g)) continue;
        const a = M.summarize(cur.now.filter((d) => d.group === g)), b = M.summarize(cur.prev.filter((d) => d.group === g));
        const ra = M.rates(a), rb = M.rates(b);
        const rows = [
          ['доходимость', ra.webinarRate, rb.webinarRate, a.leads, b.leads], ['дозвон', ra.reachedRate, rb.reachedRate, a.leads, b.leads],
          ['квал из дозвона', ra.qualFromReached, rb.qualFromReached, a.reached, b.reached], ['МС из квала', ra.mcFromQual, rb.mcFromQual, a.qual, b.qual],
        ];
        for (const [name, x, y, nA, nB] of rows) {
          if (x == null || y == null || Math.min(nA, nB) < 20) continue;
          const pp = M.deltaPP(x, y);
          if (Math.abs(pp) < 5) continue;
          items.push({ score: Math.abs(pp) * 4, kind: 'Конверсия', text: `${g}: ${name} ${fmtPct(y)} → ${fmtPct(x)}`, chip: UI.deltaChip(x, y, 'rate', true) });
        }
      }
      items.sort((x, y) => y.score - x.score);
      const top = items.slice(0, 7);
      box.replaceChildren(...(top.length
        ? top.map((i) => h('li', {}, h('span', { class: 'kind', text: i.kind }), h('span', { class: 'txt', text: i.text }), i.chip))
        : [h('li', { class: 'none', text: 'Существенных изменений нет: объёмы и конверсии в пределах обычных колебаний.' })]));
    }

    // ---------- воронка ----------
    function renderFunnel() {
      const t = cur.t, r = cur.r;
      const stage = (name, n, share, stepFrom, step) => ({
        label: name, value: n, text: `${fmtInt(n)} · ${fmtPct(share)}`,
        tip: [{ label: 'Лидов', value: fmtInt(n) }, { label: 'От лидов', value: fmtPct(share) }].concat(stepFrom ? [{ label: 'Из «' + stepFrom + '»', value: fmtPct(step) }] : []),
      });
      UI.hBars(ref.funnel, [
        stage(st.repeats ? 'Лиды' : 'Новые лиды', t.leads, t.leads ? 1 : null),
        stage('Посетили мероприятие', t.webinar, r.webinarRate),
        stage('Дозвонились', t.reached, r.reachedRate),
        stage('Квал', t.qual, M.ratio(t.qual, t.leads), 'дозвонились', r.qualFromReached),
        stage('МС назначено', t.mc, M.ratio(t.mc, t.leads), 'квал', r.mcFromQual),
      ], { ariaLabel: 'Воронка от лидов до МС' });
    }

    // ---------- источники ----------
    function renderLeadTrend() {
      const box = ref.leadTrend;
      const buckets = M.seriesBy(cur.now, cur.gran, cur.range.from, cur.range.to, (d) => d.group);
      if (st.table.leads) return trendTable(box, buckets.map((b) => ({ b, cells: meta.groups.map((g) => fmtInt(b.by[g] || 0)).concat(fmtInt(b.total)) })), meta.groups.concat('Всего'));
      const series = meta.groups.filter((g) => !st.groups || st.groups.has(g)).map((g) => ({ key: g, label: g, color: GROUP_COLORS[g] }));
      UI.stackedColumns(box, buckets, series, { gran: cur.gran, dataEnd, ariaLabel: 'Лиды по группам источников ' + UI.GRAN_TEXT[cur.gran] });
    }
    function trendTable(box, rows, heads, gran) {
      box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Период' }), ...heads.map((x) => h('th', { text: x })))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', { text: UI.bucketTitle(r.b, gran || cur.gran) }), ...r.cells.map((c) => h('td', { text: c }))))))));
    }
    function cellWithDelta(value, prev, text) {
      const td = h('td', {}, text != null ? text : fmtInt(value));
      if (prev != null) {
        const c = UI.deltaChip(value, prev, 'count', true, true);
        if (c) { c.classList.add('mini'); td.append(' ', c); }
      }
      return td;
    }
    function renderGroupTable() {
      const groups = meta.groups.filter((g) => !st.groups || st.groups.has(g));
      const rowFor = (name, deals, prevDeals) => ({ name, t: M.summarize(deals), p: prevDeals ? M.summarize(prevDeals) : null });
      const rows = groups.map((g) => rowFor(g, cur.now.filter((d) => d.group === g), cur.prev && cur.prev.filter((d) => d.group === g)));
      const total = rowFor('Итого', cur.now, cur.prev);
      const mkRow = (x, tag) => {
        const r = M.rates(x.t), p = x.p ? M.rates(x.p) : null;
        const tr = h('tr', { class: tag || '' });
        tr.append(h('td', {}, x.name === 'Итого' ? 'Итого' : h('span', { class: 'gname' }, h('i', { class: 'dot', style: 'background:' + GROUP_COLORS[x.name] }), x.name)));
        const cnt = (k) => cellWithDelta(x.t[k], x.p ? x.p[k] : null);
        const pct = (v) => h('td', { class: 'rate' }, fmtPct(v));
        tr.append(cnt('leads'), cnt('webinar'), pct(r.webinarRate), cnt('reached'), pct(r.reachedRate), cnt('qual'), pct(r.qualFromReached), cnt('mc'), pct(r.mcFromQual));
        return tr;
      };
      ref.groupTable.replaceChildren(h('table', {},
        h('thead', {}, h('tr', {}, ...['Источник', 'Лиды', 'Посетили', '% от лидов', 'Дозвонились', '% от лидов', 'Квал', '% из дозвона', 'МС', '% из квала'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...rows.map((x) => mkRow(x))), h('tfoot', {}, mkRow(total))));
    }

    // ---------- динамика конверсий ----------
    const RATE_DEFS = [
      { key: 'w', label: 'Посетили от лидов', color: 'var(--series-1)', value: (b) => M.ratio(b.webinar, b.leads), num: (b) => b.webinar, den: (b) => b.leads, denText: 'лидов' },
      { key: 'r', label: 'Дозвонились от лидов', color: 'var(--series-2)', value: (b) => M.ratio(b.reached, b.leads), num: (b) => b.reached, den: (b) => b.leads, denText: 'лидов' },
      { key: 'q', label: 'Квал из дозвонившихся', color: 'var(--series-3)', value: (b) => (b.reached >= 10 ? M.ratio(b.qual, b.reached) : null), num: (b) => b.qual, den: (b) => b.reached, denText: 'дозвонившихся' },
      { key: 'm', label: 'МС из квалов', color: 'var(--series-4)', value: (b) => (b.qual >= 10 ? M.ratio(b.mc, b.qual) : null), num: (b) => b.mc, den: (b) => b.qual, denText: 'квалов' },
    ];
    function renderRates() {
      // Недели, а не дни: на днях проценты прыгают от 0 до 100% из-за малых чисел.
      // Окно: 12 недель до конца выбранного периода, поэтому тренд виден и при выборе одной недели.
      const to = cur.range.to > dataEnd ? dataEnd : cur.range.to;
      let from = M.addDays(M.bucketStart(to, 'week'), -7 * 11);
      if (from < dataStart) from = M.bucketStart(dataStart, 'week');
      const buckets = M.series(slice(cur.base, { from, to }), 'week', from, to);
      if (st.table.rates) return trendTable(ref.rates, buckets.map((b) => ({ b, cells: RATE_DEFS.map((d) => fmtPct(d.value(b))) })), RATE_DEFS.map((d) => d.label), 'week');
      UI.lines(ref.rates, buckets, RATE_DEFS, { gran: 'week', dataEnd, ariaLabel: 'Конверсии воронки по неделям',
        emptyText: 'В неделях слишком мало данных для процентов.' });
    }

    // ---------- дерево ----------
    /**
     * Раскрывающаяся таблица. cfg: {id, levels:[fn], levelNames, columns:[{title, value(node, rootT)->строка, sort(node)}],
     * heatBy(node), note}. Состояние (раскрытые узлы, сортировка) хранится в st.tree[id].
     */
    function renderTree(box, deals, cfg) {
      const state = st.tree[cfg.id] || (st.tree[cfg.id] = { open: new Set(), sort: 0, dir: -1, shown: {} });
      const rootNode = M.buildTree(deals, cfg.levels);
      if (!rootNode.t.leads) return UI.empty(box, cfg.emptyText);
      const sortKids = (kids) => {
        const col = cfg.columns[state.sort];
        return [...kids].sort((a, b) => (col.sort(b, rootNode) - col.sort(a, rootNode)) * -state.dir || b.t.leads - a.t.leads);
      };
      const body = h('tbody');
      const addRows = (node) => {
        const kids = sortKids(node.children), limit = state.shown[node.id] || 100;
        const max = Math.max(...kids.map((k) => cfg.heatBy(k)), 0);
        kids.slice(0, limit).forEach((k) => {
          const expandable = k.children.length > 0, open = state.open.has(k.id);
          const tr = h('tr', { style: heat(cfg.heatBy(k), max) });
          const first = h('td', { class: 'tree-label', style: `padding-left:${10 + k.depth * 20}px` });
          if (expandable) {
            const b = h('button', { type: 'button', class: 'twisty', 'aria-expanded': String(open), 'aria-label': (open ? 'Свернуть ' : 'Раскрыть ') + label(k.key) , text: open ? '−' : '+' });
            b.addEventListener('click', () => { open ? state.open.delete(k.id) : state.open.add(k.id); renderTree(box, deals, cfg); });
            first.append(b);
          } else first.append(h('span', { class: 'twisty-gap' }));
          first.append(h('span', { class: 'lbl', text: label(k.key), title: label(k.key) }));
          tr.append(first, ...cfg.columns.map((c) => h('td', { text: c.value(k, rootNode) })));
          body.append(tr);
          if (expandable && open) addRows(k);
        });
        if (kids.length > limit) {
          const more = h('button', { type: 'button', class: 'linkbtn', text: `Показать ещё (осталось ${kids.length - limit})` });
          more.addEventListener('click', () => { state.shown[node.id] = limit + 100; renderTree(box, deals, cfg); });
          body.append(h('tr', {}, h('td', { colspan: cfg.columns.length + 1, style: `padding-left:${10 + (node.depth + 1) * 20}px` }, more)));
        }
      };
      addRows(rootNode);

      const head = h('tr', {}, h('th', { text: cfg.levelNames[0] }));
      cfg.columns.forEach((c, i) => {
        const th = h('th', { scope: 'col', 'aria-sort': state.sort === i ? (state.dir > 0 ? 'ascending' : 'descending') : 'none' });
        const b = h('button', { type: 'button', text: c.title });
        b.addEventListener('click', () => { state.dir = state.sort === i ? -state.dir : -1; state.sort = i; renderTree(box, deals, cfg); });
        th.append(b); head.append(th);
      });
      const total = h('tr', {}, h('td', { text: 'Итого' }), ...cfg.columns.map((c) => h('td', { text: c.value(rootNode, rootNode) })));

      // «раскрыть до уровня»
      const depthSel = h('select', { 'aria-label': 'Раскрыть до уровня' }, h('option', { value: '', text: 'Раскрыть до…' }));
      cfg.levelNames.slice(1).forEach((n, i) => depthSel.append(h('option', { value: String(i + 1), text: n })));
      depthSel.addEventListener('change', () => {
        const depth = Number(depthSel.value);
        state.open = new Set();
        const walk = (n) => n.children.forEach((k) => { if (k.depth < depth && k.children.length) { state.open.add(k.id); walk(k); } });
        if (depth) walk(rootNode);
        renderTree(box, deals, cfg);
      });
      const collapse = h('button', { type: 'button', class: 'btn', text: 'Свернуть всё' });
      collapse.addEventListener('click', () => { state.open = new Set(); renderTree(box, deals, cfg); });
      box.replaceChildren(h('div', { class: 'tree-tools' }, depthSel, collapse, h('span', { class: 'muted', text: cfg.note || '' })),
        h('div', { class: 'table-wrap tree' }, h('table', {}, h('thead', {}, head), body, h('tfoot', {}, total))));
    }
    const utmLevels = UTM_LEVELS.map(([f]) => (d) => d[f]);
    const levelNames = (first) => [first, ...UTM_LEVELS.slice(1).map(([, n]) => n)]; // имя уровня по глубине
    const rateText = (a, b) => fmtPct(M.ratio(a, b));

    function renderUtm() {
      renderTree(ref.utm, cur.now, {
        id: 'utm', levels: utmLevels, levelNames: levelNames('UTM source'), heatBy: (n) => n.t.leads,
        note: 'Цвет строки: чем больше лидов, тем темнее.', emptyText: 'Нет лидов за период',
        columns: [
          { title: 'Лиды', value: (n) => fmtInt(n.t.leads), sort: (n) => n.t.leads },
          { title: 'Посетили', value: (n) => fmtInt(n.t.webinar), sort: (n) => n.t.webinar },
          { title: '% посетили', value: (n) => rateText(n.t.webinar, n.t.leads), sort: (n) => n.t.webinar / n.t.leads },
          { title: 'Дозвонились', value: (n) => fmtInt(n.t.reached), sort: (n) => n.t.reached },
          { title: 'Квал', value: (n) => fmtInt(n.t.qual), sort: (n) => n.t.qual },
          { title: '% из дозвона', value: (n) => rateText(n.t.qual, n.t.reached), sort: (n) => (n.t.reached ? n.t.qual / n.t.reached : -1) },
          { title: 'МС', value: (n) => fmtInt(n.t.mc), sort: (n) => n.t.mc },
          { title: '% из квала', value: (n) => rateText(n.t.mc, n.t.qual), sort: (n) => (n.t.qual ? n.t.mc / n.t.qual : -1) },
          { title: 'Заявок на МС', value: (n) => fmtInt(n.t.mcRequest), sort: (n) => n.t.mcRequest },
        ],
      });
    }

    // ---------- причины отказа ----------
    function renderReasons() {
      const failed = cur.now.filter((d) => d.reason);
      const leads = cur.t.leads;
      const counts = M.countBy(failed, (d) => d.reason);
      const top = counts.slice(0, 10), rest = counts.slice(10).reduce((a, x) => a + x.n, 0);
      const rows = top.map((x) => ({ label: x.key, value: x.n, text: `${fmtInt(x.n)} · ${fmtPct(x.n / leads)}`,
        tip: [{ label: 'Лидов с этой причиной', value: fmtInt(x.n) }, { label: 'От всех лидов', value: fmtPct(x.n / leads) }, { label: 'От отказов', value: fmtPct(x.n / failed.length) }] }));
      if (rest) rows.push({ label: 'Прочие причины', value: rest, text: `${fmtInt(rest)} · ${fmtPct(rest / leads)}` });
      UI.hBars(ref.reasonBars, rows, { emptyText: 'За период нет отказов с причиной', ariaLabel: 'Причины отказа' });
      renderTree(ref.reasonTree, failed, {
        id: 'reasons', levels: [(d) => d.reason, ...utmLevels.slice(0, 3)], levelNames: ['Причина', 'UTM source', 'medium', 'campaign'], heatBy: (n) => n.t.leads,
        emptyText: 'За период нет отказов с причиной',
        columns: [
          { title: 'Кол-во', value: (n) => fmtInt(n.t.leads), sort: (n) => n.t.leads },
          { title: '% от лидов', value: (n) => fmtPct(n.t.leads / leads), sort: (n) => n.t.leads },
          { title: '% от отказов', value: (n, r) => fmtPct(n.t.leads / r.t.leads), sort: (n) => n.t.leads },
        ],
      });
    }

    // ---------- заявки на МС ----------
    function renderRequests() {
      const req = cur.now.filter((d) => d.mcRequest);
      const counts = M.countBy(req, (d) => label(d.utm_source));
      const top = counts.slice(0, 8), rest = counts.slice(8).reduce((a, x) => a + x.n, 0);
      const rows = top.map((x) => ({ label: x.key, value: x.n, text: `${fmtInt(x.n)} · ${fmtPct(x.n / req.length)}` }));
      if (rest) rows.push({ label: 'Остальные источники', value: rest, text: `${fmtInt(rest)} · ${fmtPct(rest / req.length)}` });
      UI.hBars(ref.reqBars, rows, { emptyText: 'За период нет заявок на МС', ariaLabel: 'Заявки на МС по UTM source' });
      renderTree(ref.reqTree, req, {
        id: 'requests', levels: utmLevels, levelNames: levelNames('UTM source'), heatBy: (n) => n.t.leads, emptyText: 'За период нет заявок на МС',
        columns: [
          { title: 'Заявок', value: (n) => fmtInt(n.t.leads), sort: (n) => n.t.leads },
          { title: '% от заявок', value: (n, r) => fmtPct(n.t.leads / r.t.leads), sort: (n) => n.t.leads },
          { title: 'МС назначено', value: (n) => fmtInt(n.t.mc), sort: (n) => n.t.mc },
        ],
      });
    }

    // ---------- скоринг ----------
    function renderScoring() {
      const dim = SCORE_DIMS.find((d) => d.id === st.scoreDim);
      const keyOf = (d) => {
        const v = d[dim.field];
        if (!v) return null;
        if (dim.prefix) return v.startsWith(dim.prefix) ? v.slice(dim.prefix.length) : null;
        return v;
      };
      const scored = base().filter((d) => keyOf(d) !== null);
      const counts = M.countBy(scored, keyOf);
      let keys = dim.order ? dim.order.filter((k) => counts.some((c) => c.key === k)) : counts.map((c) => c.key);
      keys = dim.order ? keys.concat(counts.map((c) => c.key).filter((k) => !keys.includes(k))) : keys;
      const colorFor = (k, i, n) => {
        if (dim.ordinal) {
          const pos = n > 1 ? Math.round((i * 5) / (n - 1)) : 3;
          return `var(--o${(dim.ordinal === 'desc' ? 5 - pos : pos) + 1})`;
        }
        return CAT_COLORS[i % CAT_COLORS.length];
      };
      const series = keys.map((k, i) => ({ key: k, label: k, color: colorFor(k, i, keys.length) }));
      ref.scoreLegend.replaceChildren(...series.map((sr) => h('span', {}, h('i', { class: 'sw', style: 'background:' + sr.color }), sr.label)));
      const weekFrom = M.addDays(M.bucketStart(dataEnd, 'week'), -7 * 11), monthFrom = M.addMonths(dataEnd, -5);
      const draw = (box, gran, from) => {
        const buckets = M.seriesBy(scored, gran, from, dataEnd, keyOf);
        UI.stackedColumns(box, buckets, series, { gran, percent: st.scorePct, dataEnd, height: 240, ariaLabel: `Скоринг ${UI.GRAN_TEXT[gran]}` });
        if (!scored.length) UI.empty(box, 'Для этой оценки в выгрузке нет заполненных значений');
      };
      draw(ref.scoreWeek, 'week', weekFrom < dataStart ? M.bucketStart(dataStart, 'week') : weekFrom);
      draw(ref.scoreMonth, 'month', monthFrom < dataStart ? M.bucketStart(dataStart, 'month') : monthFrom);
      [...ref.scoreDims.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dim === st.scoreDim)));
    }

    // ---------- каркас страницы ----------
    function card(title, hint, ...content) {
      return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h2', { text: title }), hint ? h('p', { class: 'hint', text: hint }) : null)), ...content);
    }
    function section(id, title, ...cards) { return h('div', { class: 'block', id }, h('h2', { class: 'block-title', text: title }), ...cards); }
    function toggleBtn(key) {
      const b = h('button', { type: 'button', class: 'btn', text: 'Таблица' });
      b.addEventListener('click', () => { st.table[key] = !st.table[key]; b.textContent = st.table[key] ? 'График' : 'Таблица'; update(); });
      return b;
    }
    function build() {
      root.append(buildControls());
      const nav = h('nav', { class: 'subnav', 'aria-label': 'Разделы' });
      for (const [id, t] of [['overview', 'Обзор'], ['sources', 'Источники'], ['utm', 'UTM'], ['refusals', 'Отказы'], ['requests', 'Заявки на МС'], ['scoring', 'Скоринг']]) {
        nav.append(h('a', { href: '#' + id, text: t, 'data-scroll': id }));
      }
      nav.addEventListener('click', (e) => {
        const id = e.target.dataset && e.target.dataset.scroll;
        if (!id) return;
        e.preventDefault();
        document.getElementById('m-' + id).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      root.append(nav);

      ref.kpis = h('div', { class: 'kpis' });
      ref.insights = h('ul', { class: 'insights' });
      ref.funnel = h('div', { class: 'chart' });
      ref.leadTrend = h('div', { class: 'chart' });
      const granSel = h('select', { 'aria-label': 'Шаг графиков' });
      for (const [k, t] of [['auto', 'Шаг: авто'], ['day', 'По дням'], ['week', 'По неделям'], ['month', 'По месяцам']]) granSel.append(h('option', { value: k, text: t }));
      granSel.addEventListener('change', () => { st.gran = granSel.value; update(); });
      ref.groupTable = h('div', { class: 'table-wrap groups' });
      ref.rates = h('div', { class: 'chart' });
      ref.rateLegend = h('div', { class: 'legend' }, ...RATE_DEFS.map((d) => h('span', {}, h('i', { class: 'k', style: 'background:' + d.color }), d.label)));
      ref.utm = h('div');
      ref.reasonBars = h('div', { class: 'chart' }); ref.reasonTree = h('div');
      ref.reqBars = h('div', { class: 'chart' }); ref.reqTree = h('div');
      ref.scoreLegend = h('div', { class: 'legend' });
      ref.scoreWeek = h('div', { class: 'chart' }); ref.scoreMonth = h('div', { class: 'chart' });
      ref.scoreDims = h('div', { class: 'seg multi', role: 'group', 'aria-label': 'Что показывать' });
      for (const d of SCORE_DIMS) {
        const b = h('button', { type: 'button', text: d.label, 'data-dim': d.id });
        b.addEventListener('click', () => { st.scoreDim = d.id; renderScoring(); });
        ref.scoreDims.append(b);
      }
      const pct = h('input', { type: 'checkbox' });
      pct.addEventListener('change', () => { st.scorePct = pct.checked; renderScoring(); });

      const withTools = (c, ...tools) => { c.querySelector('.card-head').append(h('div', { class: 'card-tools' }, ...tools)); return c; };
      root.append(
        section('m-overview', 'Обзор', ref.kpis,
          h('div', { class: 'grid-2' },
            card('Что изменилось', 'Главные сдвиги к периоду сравнения', ref.insights),
            card('Путь лидов по этапам', 'Сколько лидов дошло до этапа и какая это доля от всех лидов периода', ref.funnel))),
        section('m-sources', 'Источники',
          withTools(card('Лиды по группам источников', 'Сколько лидов создано в каждом периоде', ref.leadTrend), granSel, toggleBtn('leads')),
          card('Результаты по группам источников', 'Рядом с числом показано изменение к периоду сравнения', ref.groupTable),
          withTools(card('Конверсии по неделям', 'Последние 12 недель до конца выбранного периода. Процент из малого числа (меньше 10) не рисуется, неполная неделя тоже', ref.rateLegend, ref.rates), toggleBtn('rates'))),
        section('m-utm', 'Дерево UTM', card('Лиды и результаты по UTM-меткам', 'Раскрывайте source → medium → campaign → content → term. Метрики те же, что в карточках', ref.utm)),
        section('m-refusals', 'Причины отказа',
          h('div', { class: 'grid-2' },
            card('Причины отказа', 'Топ-10 причин; доля считается от всех лидов периода', ref.reasonBars),
            card('Причины по UTM', 'Раскройте причину, чтобы увидеть, откуда пришли такие лиды', ref.reasonTree))),
        section('m-requests', 'Заявки на МС',
          h('div', { class: 'grid-2' },
            card('Откуда пришли заявки на МС', 'По UTM source, поле «Оставил заявку на МС»', ref.reqBars),
            card('Заявки на МС по UTM', 'Дерево меток', ref.reqTree))),
        section('m-scoring', 'Скоринг',
          withTools(card('Скоринг по дате создания лида', 'Последние 12 недель и 6 месяцев, не зависит от выбранного периода. Неполный период бледнее', ref.scoreDims, ref.scoreLegend,
            h('div', { class: 'grid-2' }, h('div', {}, h('h3', { text: 'По неделям' }), ref.scoreWeek), h('div', {}, h('h3', { text: 'По месяцам' }), ref.scoreMonth))),
            h('label', { class: 'check' }, pct, 'В процентах'))));
    }

    function update() {
      root.classList.remove('no-anim');
      compute();
      syncControls();
      renderKpis();
      renderInsights();
      renderFunnel();
      renderLeadTrend();
      renderGroupTable();
      renderRates();
      renderUtm();
      renderReasons();
      renderRequests();
      renderScoring();
    }
    function resize() {
      if (!cur) return;
      root.classList.add('no-anim'); // перерисовка при изменении размера окна без повторной анимации
      renderFunnel(); renderLeadTrend(); renderRates(); renderReasons(); renderRequests(); renderScoring();
    }

    build();
    // первая отрисовка — после вставки на страницу (app.js вызывает update), иначе у графиков нулевая ширина
    return { el: root, resize, update };
  }
  return { create };
})();
