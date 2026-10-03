'use strict';

const { t } = I18N;
const STATUSES = ['present', 'absent', 'late', 'excused'];
const VIEWS = ['attendance', 'people', 'stats'];

const $ = (selector) => document.querySelector(selector);

const state = {
  user: null, // signed-in username
  view: 'attendance',

  // Monthly attendance sheet
  month: todayIso().slice(0, 7),
  service: '',
  search: '',
  fillDay: todayIso(),
  people: [],
  records: new Map(), // "personId|YYYY-MM-DD" → status
  sheet: { people: [], days: [] }, // what is currently displayed

  // Staff
  editingId: null,

  // Statistics
  statsFrom: todayIso().slice(0, 8) + '01',
  statsTo: todayIso(),
  statsService: '',
  stats: [],
};

// --- Helpers --------------------------------------------------------------

function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayIso() {
  return isoDate(new Date());
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return isoDate(new Date(y, m - 1 + delta, 1)).slice(0, 7);
}

function daysOf(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(y, m - 1, i + 1);
    return { iso: isoDate(date), day: i + 1, date, weekend: date.getDay() === 0 || date.getDay() === 6 };
  });
}

const recordKey = (personId, iso) => `${personId}|${iso}`;

// Tiny DOM builder. Text children are inserted as text nodes, so user data is never parsed as HTML.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const fmt = {
  number: (n) => new Intl.NumberFormat(I18N.lang).format(n),
  percent: (ratio) =>
    ratio == null ? '—' : new Intl.NumberFormat(I18N.lang, { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
  longDate: (date) => new Intl.DateTimeFormat(I18N.lang, { dateStyle: 'full' }).format(date),
  weekday: (date) => new Intl.DateTimeFormat(I18N.lang, { weekday: 'short' }).format(date),
  dayOption: (date) => new Intl.DateTimeFormat(I18N.lang, { weekday: 'short', day: 'numeric' }).format(date),
  month(month) {
    const [y, m] = month.split('-').map(Number);
    const s = new Intl.DateTimeFormat(I18N.lang, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
    return s.charAt(0).toLocaleUpperCase(I18N.lang) + s.slice(1);
  },
};

// Sorts by department, then name, using the rules of the current language (e.g. pinyin order in Chinese).
function sortPeople(list) {
  const collator = new Intl.Collator(I18N.lang, { sensitivity: 'base', numeric: true });
  return [...list].sort((a, b) => {
    if (!a.service !== !b.service) return a.service ? -1 : 1; // people without a department come last
    return collator.compare(a.service, b.service) || collator.compare(a.name, b.name);
  });
}

function distinct(list, field) {
  const collator = new Intl.Collator(I18N.lang);
  return [...new Set(list.map((p) => p[field]).filter(Boolean))].sort(collator.compare);
}

function fillServiceSelect(select, list, current) {
  const services = distinct(list, 'service');
  select.replaceChildren(
    h('option', { value: '' }, t('common.allServices')),
    ...services.map((s) => h('option', { value: s }, s)),
  );
  select.value = services.includes(current) ? current : '';
  return select.value;
}

function emptyCounts() {
  return { present: 0, absent: 0, late: 0, excused: 0 };
}

const recordedOf = (c) => c.present + c.absent + c.late + c.excused;
const attendedRatio = (c) => (recordedOf(c) ? (c.present + c.late) / recordedOf(c) : null);

let toastTimer;
function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function showError(err) {
  const key = `errors.${err.message}`;
  toast(t(I18N.has(key) ? key : 'errors.SERVER_ERROR'), 'error');
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('NETWORK');
  }
  if (url !== '/api/login') checkSignedIn(res);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'SERVER_ERROR');
  return data;
}

// A 401 means the session expired (or the password changed): go back to the login form.
function checkSignedIn(res) {
  if (res.status !== 401) return;
  showLogin();
  throw new Error('UNAUTHORIZED');
}

// Cells sent to the export endpoint: `value` is written to Excel, `text` is printed in the PDF.
const cellPercent = (ratio) => ({ value: ratio ?? '—', text: fmt.percent(ratio) });
const cellNumber = (n) => ({ value: n, text: fmt.number(n) });

// The server lays out the PDF / Excel file; every text in `spec` is already translated here.
async function downloadExport(format, spec, button) {
  const fullSpec = {
    ...spec,
    generatedAt: t('export.generatedAt', {
      date: new Intl.DateTimeFormat(I18N.lang, { dateStyle: 'long', timeStyle: 'short' }).format(new Date()),
    }),
    pageLabel: t('export.page'),
  };
  button.disabled = true;
  try {
    let res;
    try {
      res = await fetch(`/api/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullSpec),
      });
    } catch {
      throw new Error('NETWORK');
    }
    checkSignedIn(res);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'SERVER_ERROR');
    }
    const url = URL.createObjectURL(await res.blob());
    const link = h('a', { href: url, download: `${spec.fileName}.${format}` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
  }
}

function filterSummary(service, search = '') {
  const parts = [t('common.countLabel', { label: t('common.service'), n: service || t('common.allServices') })];
  if (search.trim()) parts.push(t('export.search', { q: search.trim() }));
  return parts.join('   ·   ');
}

// --- Attendance sheet (one row per person, one column per day) ------------

async function loadSheet() {
  const month = state.month;
  const data = await api('GET', `/api/attendance?month=${encodeURIComponent(month)}`);
  if (month !== state.month) return; // the user moved to another month meanwhile
  state.people = data.people;
  state.records = new Map(data.records.filter((r) => r.status).map((r) => [recordKey(r.personId, r.date), r.status]));
  renderSheet();
}

function setMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  state.month = month;
  loadSheet().catch(showError);
}

function matchesFilters(person) {
  if (state.service && person.service !== state.service) return false;
  const query = state.search.trim().toLocaleLowerCase(I18N.lang);
  if (!query) return true;
  return [person.matricule, person.name, person.jobTitle, person.service].some((v) =>
    v.toLocaleLowerCase(I18N.lang).includes(query),
  );
}

function countsFor(personIds, days) {
  const counts = emptyCounts();
  for (const id of personIds) {
    for (const d of days) {
      const status = state.records.get(recordKey(id, d.iso));
      if (status) counts[status]++;
    }
  }
  return counts;
}

// Total columns are numbered from the right edge (r0 = rate) so they can stay pinned there.
function totalClass(index) {
  return `total r${STATUSES.length - index}`;
}

function dayClass(d) {
  return ['day', d.weekend && 'weekend', d.iso === todayIso() && 'today'].filter(Boolean).join(' ');
}

function renderSheet() {
  const days = daysOf(state.month);
  const people = sortPeople(state.people.filter((p) => matchesFilters(p)));
  state.sheet = { people, days };

  $('#att-month').value = state.month;
  $('#att-month-title').textContent = fmt.month(state.month);
  $('#att-legend').textContent = STATUSES.map((s) => `${t(`statusCode.${s}`)} = ${t(`status.${s}`)}`).join('   ·   ');
  state.service = fillServiceSelect($('#att-service'), state.people, state.service);

  // Default "fill" day: keep the chosen day if it is in this month, otherwise today or the 1st.
  if (!days.some((d) => d.iso === state.fillDay)) {
    state.fillDay = days.some((d) => d.iso === todayIso()) ? todayIso() : days[0].iso;
  }
  $('#att-fill-day').replaceChildren(...days.map((d) => h('option', { value: d.iso }, fmt.dayOption(d.date))));
  $('#att-fill-day').value = state.fillDay;

  const columnCount = 4 + days.length + STATUSES.length + 1;
  let body;
  if (!people.length) {
    const message = state.people.length ? t('attendance.noMatch') : t('attendance.empty');
    body = h('tr', {}, h('td', { class: 'empty', colSpan: columnCount }, message));
  } else {
    body = people.map((p) => renderSheetRow(p, days));
  }

  $('#att-sheet').replaceChildren(
    h('thead', {},
      h('tr', {},
        h('th', { class: 'sticky c-mat' }, t('common.matricule')),
        h('th', { class: 'sticky c-name' }, t('common.name')),
        h('th', { class: 'c-text' }, t('common.jobTitle')),
        h('th', { class: 'c-text' }, t('common.service')),
        days.map((d) =>
          h('th', { class: dayClass(d), title: fmt.longDate(d.date) },
            h('span', { class: 'day-num' }, String(d.day)),
            h('span', { class: 'day-wd' }, fmt.weekday(d.date)),
          ),
        ),
        STATUSES.map((s, i) => h('th', { class: `${totalClass(i)} status-${s}`, title: t(`status.${s}`) }, t(`status.${s}`))),
        h('th', { class: `${totalClass(STATUSES.length)} rate` }, t('stats.rate')),
      ),
    ),
    h('tbody', {}, body),
    renderSheetFooter(),
  );
}

function renderSheetRow(person, days) {
  const totalCells = Object.fromEntries(STATUSES.map((s, i) => [s, h('td', { class: `${totalClass(i)} status-${s}` })]));
  const rateCell = h('td', { class: `${totalClass(STATUSES.length)} rate` });

  const refreshTotals = () => {
    const counts = countsFor([person.id], days);
    for (const s of STATUSES) totalCells[s].textContent = fmt.number(counts[s]);
    rateCell.textContent = fmt.percent(attendedRatio(counts));
  };
  refreshTotals();

  return h('tr', {},
    h('td', { class: 'sticky c-mat' }, person.matricule || '—'),
    h('td', { class: 'sticky c-name' }, person.name),
    h('td', { class: 'c-text' }, person.jobTitle || '—'),
    h('td', { class: 'c-text' }, person.service || '—'),
    days.map((d) => h('td', { class: dayClass(d) }, statusSelect(person, d, refreshTotals))),
    STATUSES.map((s) => totalCells[s]),
    rateCell,
  );
}

function paintSelect(select) {
  select.className = `cell-select${select.value ? ` status-${select.value}` : ''}`;
}

function statusSelect(person, day, refreshTotals) {
  const select = h('select', {
    'aria-label': t('attendance.cellLabel', { name: person.name, date: fmt.longDate(day.date) }),
    onchange: () => saveCell(person, day, select, refreshTotals),
  },
    h('option', { value: '' }, '–'),
    STATUSES.map((s) => h('option', { value: s, title: t(`status.${s}`) }, t(`statusCode.${s}`))),
  );
  select.value = state.records.get(recordKey(person.id, day.iso)) ?? '';
  paintSelect(select);
  return select;
}

function setRecord(key, status) {
  if (status) state.records.set(key, status);
  else state.records.delete(key);
}

async function saveCell(person, day, select, refreshTotals) {
  const key = recordKey(person.id, day.iso);
  const previous = state.records.get(key) ?? '';
  const status = select.value || null;

  const apply = (value) => {
    setRecord(key, value);
    select.value = value ?? '';
    paintSelect(select);
    refreshTotals();
    $('#att-sheet tfoot').replaceWith(renderSheetFooter());
  };

  apply(status);
  try {
    await api('PUT', '/api/attendance', { date: day.iso, personId: person.id, status });
  } catch (err) {
    apply(previous || null);
    showError(err);
  }
}

// Bottom row: number of people present (or late) each day, and totals for the displayed people.
function renderSheetFooter() {
  const { people, days } = state.sheet;
  const ids = people.map((p) => p.id);
  const totals = countsFor(ids, days);

  return h('tfoot', {},
    h('tr', {},
      h('th', { class: 'sticky c-mat', colSpan: 2 }, t('attendance.presentPerDay')),
      h('th', { colSpan: 2 }),
      days.map((d) => {
        const c = countsFor(ids, [d]);
        return h('td', { class: dayClass(d) }, recordedOf(c) ? fmt.number(c.present + c.late) : '');
      }),
      STATUSES.map((s, i) => h('td', { class: `${totalClass(i)} status-${s}` }, fmt.number(totals[s]))),
      h('td', { class: `${totalClass(STATUSES.length)} rate` }, fmt.percent(attendedRatio(totals))),
    ),
  );
}

async function fillPresent() {
  const date = $('#att-fill-day').value;
  const personIds = state.sheet.people.filter((p) => !state.records.has(recordKey(p.id, date))).map((p) => p.id);
  if (!personIds.length) {
    toast(t('attendance.filled', { n: 0 }));
    return;
  }
  try {
    await api('PUT', '/api/attendance/bulk', { date, personIds, status: 'present' });
    for (const id of personIds) state.records.set(recordKey(id, date), 'present');
    renderSheet();
    toast(t('attendance.filled', { n: personIds.length }));
  } catch (err) {
    showError(err);
  }
}

function exportSheet(format, button) {
  const { people, days } = state.sheet;
  const ids = people.map((p) => p.id);
  const totals = countsFor(ids, days);
  const today = todayIso();

  const columns = [
    { header: t('common.matricule'), width: 12 },
    { header: t('common.name'), width: 24 },
    { header: t('common.jobTitle'), width: 18 },
    { header: t('common.service'), width: 18 },
    ...days.map((d) => ({
      header: `${d.day}\n${fmt.weekday(d.date)}`,
      width: 4.6,
      align: 'center',
      shade: d.weekend,
      highlight: d.iso === today,
    })),
    ...STATUSES.map((s) => ({ header: t(`status.${s}`), width: 9, align: 'right' })),
    { header: t('stats.rate'), width: 10, align: 'right', format: 'percent' },
  ];

  const rows = people.map((p) => {
    const counts = countsFor([p.id], days);
    return [
      p.matricule, p.name, p.jobTitle, p.service,
      ...days.map((d) => {
        const status = state.records.get(recordKey(p.id, d.iso));
        return status ? { value: t(`statusCode.${status}`), status } : '';
      }),
      ...STATUSES.map((s) => cellNumber(counts[s])),
      cellPercent(attendedRatio(counts)),
    ];
  });

  const footer = [
    '', t('attendance.presentPerDay'), '', '',
    ...days.map((d) => {
      const c = countsFor(ids, [d]);
      return recordedOf(c) ? cellNumber(c.present + c.late) : '';
    }),
    ...STATUSES.map((s) => cellNumber(totals[s])),
    cellPercent(attendedRatio(totals)),
  ];

  downloadExport(format, {
    fileName: `${t('attendance.fileName')}_${state.month}`,
    title: t('attendance.sheetTitle', { month: fmt.month(state.month) }),
    subtitle: filterSummary(state.service, state.search),
    legend: $('#att-legend').textContent,
    sheetName: fmt.month(state.month),
    pageSize: 'A3',
    fontSize: 7,
    freezeColumns: 2,
    columns,
    rows,
    footer,
  }, button);
}

// --- Staff ----------------------------------------------------------------

async function loadPeople() {
  state.people = await api('GET', '/api/people');
  renderPeople();
}

function renderPeople() {
  $('#people-count').textContent = t('people.count', { n: state.people.length });
  $('#job-options').replaceChildren(...distinct(state.people, 'jobTitle').map((v) => h('option', { value: v })));
  $('#service-options').replaceChildren(...distinct(state.people, 'service').map((v) => h('option', { value: v })));

  const rows = state.people.length
    ? sortPeople(state.people).map((p) => (p.id === state.editingId ? renderPersonEditor(p) : renderPerson(p)))
    : h('tr', {}, h('td', { class: 'empty', colSpan: 5 }, t('people.empty')));

  $('#people-table').replaceChildren(
    h('thead', {},
      h('tr', {},
        h('th', {}, t('common.matricule')),
        h('th', {}, t('common.name')),
        h('th', {}, t('common.jobTitle')),
        h('th', {}, t('common.service')),
        h('th', { class: 'actions-col' }, t('common.actions')),
      ),
    ),
    h('tbody', {}, rows),
  );
}

function renderPerson(person) {
  return h('tr', {},
    h('td', {}, person.matricule || '—'),
    h('td', { class: 'name' }, person.name),
    h('td', {}, person.jobTitle || '—'),
    h('td', {}, person.service || '—'),
    h('td', { class: 'actions-col' },
      h('div', { class: 'actions' },
        h('button', {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            state.editingId = person.id;
            renderPeople();
            $('#people-table tbody input')?.focus();
          },
        }, t('common.edit')),
        h('button', { type: 'button', class: 'btn small danger', onclick: () => deletePerson(person) }, t('common.delete')),
      ),
    ),
  );
}

function renderPersonEditor(person) {
  const input = (value, maxLength, labelKey, listId) => {
    const el = h('input', { value, maxLength, 'aria-label': t(labelKey), onkeydown: (e) => onKey(e) });
    if (listId) el.setAttribute('list', listId);
    return el;
  };
  const fields = {
    matricule: input(person.matricule, 30, 'common.matricule'),
    name: input(person.name, 100, 'common.name'),
    jobTitle: input(person.jobTitle, 80, 'common.jobTitle', 'job-options'),
    service: input(person.service, 80, 'common.service', 'service-options'),
  };

  const cancel = () => {
    state.editingId = null;
    renderPeople();
  };
  const save = async () => {
    try {
      const updated = await api('PUT', `/api/people/${person.id}`, {
        matricule: fields.matricule.value,
        name: fields.name.value,
        jobTitle: fields.jobTitle.value,
        service: fields.service.value,
      });
      Object.assign(person, updated);
      state.editingId = null;
      renderPeople();
      toast(t('common.saved'));
    } catch (err) {
      showError(err);
    }
  };
  function onKey(e) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  }

  return h('tr', { class: 'editing' },
    Object.values(fields).map((el) => h('td', {}, el)),
    h('td', { class: 'actions-col' },
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small primary', onclick: save }, t('common.save')),
        h('button', { type: 'button', class: 'btn small', onclick: cancel }, t('common.cancel')),
      ),
    ),
  );
}

async function addPerson(event) {
  event.preventDefault();
  const fields = {
    matricule: $('#person-matricule'),
    name: $('#person-name'),
    jobTitle: $('#person-job'),
    service: $('#person-service'),
  };
  try {
    const person = await api('POST', '/api/people', Object.fromEntries(
      Object.entries(fields).map(([k, el]) => [k, el.value]),
    ));
    state.people.push(person);
    // Department is kept so several colleagues of the same department can be entered in a row.
    fields.matricule.value = '';
    fields.name.value = '';
    fields.jobTitle.value = '';
    fields.matricule.focus();
    renderPeople();
    toast(t('people.added', { name: person.name }));
  } catch (err) {
    showError(err);
  }
}

async function deletePerson(person) {
  if (!confirm(t('people.confirmDelete', { name: person.name }))) return;
  try {
    await api('DELETE', `/api/people/${person.id}`);
    state.people = state.people.filter((p) => p.id !== person.id);
    renderPeople();
  } catch (err) {
    showError(err);
  }
}

// --- Statistics -----------------------------------------------------------

function visibleStats() {
  return sortPeople(state.stats.filter((r) => !state.statsService || r.service === state.statsService));
}

async function loadStats() {
  const { statsFrom: from, statsTo: to } = state;
  if (!from || !to) return;
  if (from > to) {
    showError(new Error('INVALID_RANGE'));
    return;
  }
  const stats = await api('GET', `/api/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (from !== state.statsFrom || to !== state.statsTo) return;
  state.stats = stats;
  renderStats();
}

function renderStats() {
  $('#stats-from').value = state.statsFrom;
  $('#stats-to').value = state.statsTo;
  state.statsService = fillServiceSelect($('#stats-service'), state.stats, state.statsService);

  const rows = visibleStats();
  const totals = emptyCounts();
  for (const row of rows) for (const s of STATUSES) totals[s] += row[s];

  const numberCells = (c) => [
    ...STATUSES.map((s) => h('td', { class: 'num' }, fmt.number(c[s]))),
    h('td', { class: 'num' }, fmt.number(recordedOf(c))),
    h('td', { class: 'num rate' }, fmt.percent(attendedRatio(c))),
  ];

  $('#stats-table').replaceChildren(
    h('thead', {},
      h('tr', {},
        h('th', {}, t('common.matricule')),
        h('th', {}, t('common.name')),
        h('th', {}, t('common.jobTitle')),
        h('th', {}, t('common.service')),
        ...STATUSES.map((s) => h('th', { class: 'num' }, t(`status.${s}`))),
        h('th', { class: 'num' }, t('stats.recorded')),
        h('th', { class: 'num' }, t('stats.rate')),
      ),
    ),
    h('tbody', {},
      rows.length
        ? rows.map((r) =>
            h('tr', {},
              h('td', {}, r.matricule || '—'),
              h('td', { class: 'name' }, r.name),
              h('td', {}, r.jobTitle || '—'),
              h('td', {}, r.service || '—'),
              ...numberCells(r),
            ),
          )
        : h('tr', {}, h('td', { colSpan: 10, class: 'empty' }, t('people.empty'))),
    ),
    rows.length > 1 && h('tfoot', {}, h('tr', {}, h('th', { colSpan: 4 }, t('stats.total')), ...numberCells(totals))),
  );
}

function exportStats(format, button) {
  const rows = visibleStats();
  const totals = emptyCounts();
  for (const row of rows) for (const s of STATUSES) totals[s] += row[s];
  const numberCells = (c) => [
    ...STATUSES.map((s) => cellNumber(c[s])),
    cellNumber(recordedOf(c)),
    cellPercent(attendedRatio(c)),
  ];
  const shortDate = (iso) => new Intl.DateTimeFormat(I18N.lang, { dateStyle: 'long' }).format(new Date(`${iso}T00:00:00`));

  downloadExport(format, {
    fileName: `${t('stats.fileName')}_${state.statsFrom}_${state.statsTo}`,
    title: t('stats.title'),
    subtitle: `${t('export.period', { from: shortDate(state.statsFrom), to: shortDate(state.statsTo) })}   ·   ${filterSummary(state.statsService)}`,
    legend: t('stats.rateHelp'),
    sheetName: t('stats.title'),
    pageSize: 'A4',
    fontSize: 9,
    freezeColumns: 2,
    columns: [
      { header: t('common.matricule'), width: 12 },
      { header: t('common.name'), width: 26 },
      { header: t('common.jobTitle'), width: 20 },
      { header: t('common.service'), width: 22 },
      ...STATUSES.map((s) => ({ header: t(`status.${s}`), width: 10, align: 'right' })),
      { header: t('stats.recorded'), width: 12, align: 'right' },
      { header: t('stats.rate'), width: 13, align: 'right', format: 'percent' },
    ],
    rows: rows.map((r) => [r.matricule, r.name, r.jobTitle, r.service, ...numberCells(r)]),
    footer: rows.length > 1 ? ['', t('stats.total'), '', '', ...numberCells(totals)] : undefined,
  }, button);
}

// --- Navigation & startup -------------------------------------------------

const LOADERS = { attendance: loadSheet, people: loadPeople, stats: loadStats };
const RENDERERS = { attendance: renderSheet, people: renderPeople, stats: renderStats };

function showLogin() {
  state.user = null;
  // Forget everything loaded for the previous user.
  Object.assign(state, { people: [], records: new Map(), stats: [], editingId: null });
  $('.tabs').hidden = true;
  $('#user-box').hidden = true;
  for (const v of VIEWS) $(`#view-${v}`).hidden = true;
  $('#login-password').value = '';
  $('#login-error').hidden = true;
  $('#view-login').hidden = false;
  $('#login-username').focus();
}

function showApp(username) {
  state.user = username;
  $('#user-name').textContent = username;
  $('#view-login').hidden = true;
  $('.tabs').hidden = false;
  $('#user-box').hidden = false;
  showView(location.hash.slice(1));
}

async function signIn(event) {
  event.preventDefault();
  const errorBox = $('#login-error');
  const button = event.submitter;
  errorBox.hidden = true;
  if (button) button.disabled = true;
  try {
    const { username } = await api('POST', '/api/login', {
      username: $('#login-username').value,
      password: $('#login-password').value,
    });
    $('#login-password').value = '';
    showApp(username);
  } catch (err) {
    const key = `errors.${err.message}`;
    errorBox.textContent = t(I18N.has(key) ? key : 'errors.SERVER_ERROR');
    errorBox.hidden = false;
    $('#login-password').select();
  } finally {
    if (button) button.disabled = false;
  }
}

async function signOut() {
  try {
    await api('POST', '/api/logout', {});
  } catch {
    // Already signed out on the server: nothing else to do.
  }
  showLogin();
}

function showView(view) {
  if (!state.user) return;
  state.view = VIEWS.includes(view) ? view : 'attendance';
  state.editingId = null;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== state.view;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
  });
  if (location.hash.slice(1) !== state.view) history.replaceState(null, '', `#${state.view}`);
  LOADERS[state.view]().catch(showError);
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });

  $('#lang-select').addEventListener('change', (e) => {
    I18N.setLang(e.target.value);
    if (state.user) RENDERERS[state.view]();
    else $('#login-error').hidden = true; // its text belongs to the previous language
  });

  $('#login-form').addEventListener('submit', signIn);
  $('#logout').addEventListener('click', signOut);

  $('#att-month').addEventListener('change', (e) => setMonth(e.target.value));
  $('#att-prev').addEventListener('click', () => setMonth(shiftMonth(state.month, -1)));
  $('#att-next').addEventListener('click', () => setMonth(shiftMonth(state.month, 1)));
  $('#att-this-month').addEventListener('click', () => setMonth(todayIso().slice(0, 7)));
  $('#att-service').addEventListener('change', (e) => {
    state.service = e.target.value;
    renderSheet();
  });
  $('#att-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderSheet();
  });
  $('#att-fill-day').addEventListener('change', (e) => {
    state.fillDay = e.target.value;
  });
  $('#att-fill').addEventListener('click', fillPresent);
  $('#att-export-pdf').addEventListener('click', (e) => exportSheet('pdf', e.currentTarget));
  $('#att-export-xlsx').addEventListener('click', (e) => exportSheet('xlsx', e.currentTarget));

  $('#person-form').addEventListener('submit', addPerson);

  $('#stats-from').addEventListener('change', (e) => {
    state.statsFrom = e.target.value;
    loadStats().catch(showError);
  });
  $('#stats-to').addEventListener('change', (e) => {
    state.statsTo = e.target.value;
    loadStats().catch(showError);
  });
  $('#stats-service').addEventListener('change', (e) => {
    state.statsService = e.target.value;
    renderStats();
  });
  $('#stats-export-pdf').addEventListener('click', (e) => exportStats('pdf', e.currentTarget));
  $('#stats-export-xlsx').addEventListener('click', (e) => exportStats('xlsx', e.currentTarget));

  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
}

// Shows the app if a session is still open, the login form otherwise.
async function start() {
  try {
    const res = await fetch('/api/session');
    if (res.ok) {
      showApp((await res.json()).username);
      return;
    }
  } catch {
    // Server unreachable: the login form will report it on submit.
  }
  showLogin();
}

$('#lang-select').value = I18N.lang;
I18N.apply();
bindEvents();
start();
