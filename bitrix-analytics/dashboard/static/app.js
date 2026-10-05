/* Оболочка: боковая рейка, переключение дашбордов с анимацией, оформление, загрузка данных. */
(function () {
  'use strict';
  const M = window.Metrics, UI = window.UI, { h } = UI;
  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;

  // Реестр дашбордов. Позже здесь же появятся права доступа (кто какой дашборд видит).
  const DASHBOARDS = [
    { id: 'overview', title: 'Общий', icon: 'overview', status: 'ready', header: 'Общий дашборд' },
    { id: 'marketing', title: 'Маркетинговый', icon: 'marketing', status: 'ready', header: 'Маркетинговый дашборд' },
    { id: 'sales', title: 'Отдел продаж', icon: 'sales', status: 'planned', header: 'Дашборд отдела продаж',
      plan: ['Работа менеджеров и консультантов: взято в работу, скорость реакции, дозвоны', 'Квалы и МС по консультантам и коучам', 'Проведённые МС, продажи, выручка по менеджерам'] },
    { id: 'access', title: 'Доступы', icon: 'access', status: 'planned', header: 'Управление доступом',
      plan: ['Роли: администратор, команда, внешние подрядчики', 'Для каждого человека выбирается, какие дашборды он видит', 'Администратор выдаёт и забирает доступ в один клик', 'Вход по логину и паролю, работает после переноса системы на сервер (VPS)'] },
  ];

  let data = null, mounted = null, activeId = null, indicator = null;

  const route = () => {
    const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
    return DASHBOARDS.find((d) => d.id === id) || DASHBOARDS[1];
  };

  // ---------- рейка ----------
  function buildRail() {
    $('#logo').replaceChildren(UI.icon('logo'));
    indicator = h('i', { class: 'rail-ind', 'aria-hidden': 'true' });
    $('#rail').replaceChildren(indicator, ...DASHBOARDS.map((d) => h('a', { href: '#/' + d.id, class: 'rail-item', 'data-id': d.id, title: d.title },
      UI.icon(d.icon), h('span', { class: 'rail-label' }, d.title, d.status === 'planned' ? h('em', { text: 'скоро' }) : null))));
    $('#reload').replaceChildren(UI.icon('refresh'), h('span', { text: 'Обновить' }));
  }
  function markActive(id) {
    for (const a of document.querySelectorAll('.rail-item')) {
      const on = a.dataset.id === id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    placeIndicator();
  }
  function placeIndicator() {
    const a = document.querySelector('.rail-item.active');
    if (!a || !indicator) return;
    indicator.style.height = a.offsetHeight + 'px';
    indicator.style.width = a.offsetWidth + 'px';
    indicator.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
  }

  // ---------- содержимое ----------
  function planned(d) {
    return h('section', { class: 'card planned' }, h('h2', { text: `«${d.title}»: в разработке` }),
      h('p', { class: 'hint', text: 'Сначала доделываем маркетинговый дашборд. Здесь будет:' }), h('ul', {}, ...d.plan.map((t) => h('li', { text: t }))));
  }
  function mount(d) {
    $('#title').textContent = d.header;
    $('#subtitle').textContent = data ? (d.id === 'overview'
      ? `Поток по дате события, разбивка по дате создания лида · данные по ${UI.fmtDay(data.meta.asOf || data.meta.dateMax)}`
      : `Атрибуция по дате создания лида · данные по ${UI.fmtDay(data.meta.dateMax)}`) : '';
    const view = $('#view');
    mounted = null;
    if (!data) return;
    if (d.status === 'planned') return view.replaceChildren(planned(d));
    mounted = d.id === 'overview'
      ? window.Overview.create({ events: data.events, meta: data.meta })
      : window.Marketing.create({ deals: data.deals, meta: data.meta });
    [...mounted.el.children].forEach((c, i) => c.style.setProperty('--i', i));
    view.replaceChildren(mounted.el);
    mounted.update();
  }
  function render(animate) {
    const d = route();
    markActive(d.id);
    const view = $('#view');
    if (!animate || UI.reduced() || d.id === activeId) { activeId = d.id; return mount(d); }
    activeId = d.id;
    view.classList.add('leaving');
    setTimeout(() => {
      mount(d);
      view.classList.remove('leaving');
      view.classList.add('entering');
      setTimeout(() => view.classList.remove('entering'), 450);
      window.scrollTo({ top: 0 });
    }, 170);
  }

  function showError(text) {
    $('#view').replaceChildren(h('div', { class: 'error' }, h('h2', { text: 'Не удалось загрузить данные' }), h('p', { text: text }),
      h('p', { text: 'Положите CSV-выгрузку сделок в папку data рядом с программой и нажмите «Обновить».' })));
  }
  async function load(first) {
    let payload;
    try {
      const res = await fetch('/api/deals', { cache: 'no-store' });
      payload = await res.json();
    } catch (e) { data = null; return showError('Сервер не отвечает. Запущена ли программа?'); }
    if (payload.error) { data = null; return showError(payload.error); }
    data = { deals: M.decode(payload), meta: payload.meta, events: M.decodeEvents(payload.events) };
    const m = data.meta;
    const files = (m.files || []).map((f) => `${f.funnel}: ${f.name} (${UI.fmtInt(f.rows)})`).join('; ');
    $('#file-meta').textContent = `Файлы: ${files || m.file}. Лидов в «Консультантах»: ${UI.fmtInt(m.rowsUsed)} из ${UI.fmtInt(m.rowsTotal)}` +
      (m.rowsSkipped ? `, пропущено без даты создания: ${UI.fmtInt(m.rowsSkipped)}` : '') + (m.warnings.length ? '. ' + m.warnings.join(' ') : '');
    activeId = null;
    render(false);
  }

  // ---------- оформление ----------
  function setSkin(skin, animate) {
    if (animate && !UI.reduced()) { root.classList.add('skin-fade'); setTimeout(() => root.classList.remove('skin-fade'), 520); }
    root.dataset.skin = skin;
    for (const b of document.querySelectorAll('#switcher button')) b.setAttribute('aria-pressed', String(b.dataset.skin === skin));
    $('#switcher').dataset.skin = skin;
    try { localStorage.setItem('skin', skin); } catch (e) { /* без сохранения */ }
    requestAnimationFrame(placeIndicator);
  }
  for (const b of document.querySelectorAll('#switcher button')) b.addEventListener('click', () => setSkin(b.dataset.skin, true));
  let saved = 'glass';
  try { saved = localStorage.getItem('skin') || 'glass'; } catch (e) { /* ок */ }
  setSkin(saved === 'light' ? 'light' : 'glass', false);

  // ---------- события ----------
  $('#reload').addEventListener('click', () => load(false));
  window.addEventListener('hashchange', () => render(true));
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { placeIndicator(); if (mounted) mounted.resize(); });
  });

  buildRail();
  load(true);
})();
