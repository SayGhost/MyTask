/* Общие фильтры дашбордов: период, сравнение, группы источников, повторные сделки.
   Состояние хранится в объекте state, который передаёт дашборд (он же его читает). */
window.Filters = (function () {
  'use strict';
  const M = window.Metrics, UI = window.UI;
  const { h, strong } = UI;

  const PRESETS = [
    ['thisWeek', 'Эта неделя'], ['lastWeek', 'Прошлая неделя'], ['thisMonth', 'Этот месяц'],
    ['lastMonth', 'Прошлый месяц'], ['last30', '30 дней'], ['all', 'Всё время'],
  ];
  const COMPARE = [['prev', 'С предыдущим периодом'], ['year', 'С тем же периодом прошлого года'], ['custom', 'Со своим периодом'], ['none', 'Без сравнения']];

  /**
   * opts: state, prefix, dataStart, dataEnd, groups, groupColors, repeatsLabel, summaryLead, maturityText, onChange.
   * state получает поля preset, range, compare, customCompare, groups, repeats.
   */
  function create(opts) {
    const { state: st, prefix, dataStart, dataEnd, groups: allGroups, groupColors } = opts;
    Object.assign(st, { preset: 'lastWeek', range: M.presetRange('lastWeek', dataEnd, dataStart), compare: 'prev', customCompare: null, groups: null, repeats: false });
    const ref = {};
    const inputOf = (box) => box.querySelector('input');
    const dateInput = (id, label) => h('label', { class: 'dateinput' }, h('span', { class: 'sr-only', text: label }), h('input', { type: 'date', id: `${prefix}-${id}`, min: dataStart, max: dataEnd }));

    const presets = h('div', { class: 'seg', role: 'group', 'aria-label': 'Период' });
    for (const [k, t] of PRESETS) {
      const b = h('button', { type: 'button', text: t, 'data-preset': k });
      b.addEventListener('click', () => {
        st.preset = k;
        st.range = M.presetRange(k, dataEnd, dataStart);
        if (st.range.from < dataStart) st.range.from = dataStart;
        opts.onChange();
      });
      presets.append(b);
    }
    ref.presets = presets;

    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Группы источников' });
    for (const g of allGroups) {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true' }, h('i', { class: 'dot', style: 'background:' + groupColors[g] }), g);
      b.addEventListener('click', () => {
        const next = new Set(st.groups || allGroups);
        next.has(g) ? next.delete(g) : next.add(g);
        st.groups = next.size === allGroups.length ? null : next;
        opts.onChange();
      });
      chips.append(b);
    }
    ref.chips = chips;
    let repeats;
    if (opts.dealTypes) {
      // Все / Новые / Повторные (важно для «Общего»: показываем и итог, и разбивку)
      st.dealType = 'all';
      repeats = h('div', { class: 'seg', role: 'group', 'aria-label': 'Тип сделки' });
      for (const [k, t] of [['all', 'Все сделки'], ['new', 'Новые'], ['repeat', 'Повторные']]) {
        const b = h('button', { type: 'button', text: t, 'data-type': k });
        b.addEventListener('click', () => { st.dealType = k; opts.onChange(); });
        repeats.append(b);
      }
    } else {
      const rep = h('input', { type: 'checkbox' });
      rep.addEventListener('change', () => { st.repeats = rep.checked; opts.onChange(); });
      repeats = h('label', { class: 'check' }, rep, opts.repeatsLabel);
    }

    ref.from = dateInput('from', 'С даты'); ref.to = dateInput('to', 'По дату');
    for (const el of [ref.from, ref.to]) inputOf(el).addEventListener('change', () => {
      const f = inputOf(ref.from).value || dataStart, t = inputOf(ref.to).value || dataEnd;
      st.preset = 'custom';
      st.range = f <= t ? { from: f, to: t } : { from: t, to: f };
      opts.onChange();
    });
    ref.compareSel = h('select', { 'aria-label': 'Сравнение' });
    for (const [k, t] of COMPARE) ref.compareSel.append(h('option', { value: k, text: t }));
    ref.compareSel.addEventListener('change', () => {
      st.compare = ref.compareSel.value;
      if (st.compare === 'custom' && !st.customCompare) st.customCompare = M.comparePeriod(st.range, st.preset, 'prev');
      opts.onChange();
    });
    ref.cFrom = dateInput('cfrom', 'Сравнение с даты'); ref.cTo = dateInput('cto', 'Сравнение по дату');
    for (const el of [ref.cFrom, ref.cTo]) inputOf(el).addEventListener('change', () => {
      const f = inputOf(ref.cFrom).value, t = inputOf(ref.cTo).value;
      if (f && t) { st.customCompare = f <= t ? { from: f, to: t } : { from: t, to: f }; opts.onChange(); }
    });
    ref.cBox = h('span', { class: 'dates' }, h('span', { class: 'muted', text: 'сравнить с' }), ref.cFrom, h('span', { 'aria-hidden': 'true', text: '—' }), ref.cTo);

    ref.summary = h('p', { class: 'period-summary' });
    ref.maturity = h('p', { class: 'maturity', hidden: true });
    const el = h('section', { class: 'filters controls', 'aria-label': 'Фильтры' },
      h('div', { class: 'row' }, presets, h('span', { class: 'dates' }, ref.from, h('span', { 'aria-hidden': 'true', text: '—' }), ref.to), ref.compareSel, ref.cBox),
      h('div', { class: 'row' }, chips, repeats),
      ref.summary, ref.maturity);

    /** Период сравнения для текущих настроек: {cmp, cmpNote}. */
    function resolve() {
      let cmp = st.compare === 'custom' ? st.customCompare : M.comparePeriod(st.range, st.preset, st.compare);
      let cmpNote = null;
      if (cmp && cmp.to < dataStart) { cmpNote = 'Сравнение недоступно: период сравнения раньше первых данных (' + UI.fmtDay(dataStart) + ').'; cmp = null; }
      else if (cmp && cmp.from < dataStart) cmpNote = 'Период сравнения начинается раньше данных, поэтому он неполный: цифры «было» занижены.';
      return { cmp, cmpNote };
    }

    /** Показывает в элементах управления текущее состояние. r = {range, cmp, cmpNote}. */
    function sync(r) {
      for (const b of presets.children) b.setAttribute('aria-pressed', String(b.dataset.preset === st.preset));
      inputOf(ref.from).value = st.range.from;
      inputOf(ref.to).value = st.range.to;
      ref.compareSel.value = st.compare;
      ref.cBox.hidden = st.compare !== 'custom';
      if (r.cmp) { inputOf(ref.cFrom).value = r.cmp.from; inputOf(ref.cTo).value = r.cmp.to; }
      if (opts.dealTypes) for (const b of repeats.children) b.setAttribute('aria-pressed', String(b.dataset.type === st.dealType));
      [...chips.children].forEach((b, i) => b.setAttribute('aria-pressed', String(!st.groups || st.groups.has(allGroups[i]))));
      ref.summary.replaceChildren(...[
        h('span', {}, opts.summaryLead, strong(UI.fmtRange(r.range))),
        r.cmp ? h('span', {}, ' · сравнение: ', strong(UI.fmtRange(r.cmp))) : null,
        h('span', { class: 'muted', text: ` · по ${UI.fmtDay(dataEnd)} данные есть` }),
        r.cmpNote ? h('span', { class: 'warn', text: ' · ' + r.cmpNote }) : null].filter(Boolean));
      // последние дни ещё «дозревают»: квал, МС и покупки появляются позже создания лида
      ref.maturity.hidden = !(r.range.to > M.addDays(dataEnd, -7));
      ref.maturity.textContent = opts.maturityText;
    }
    return { el, resolve, sync };
  }
  return { create };
})();
