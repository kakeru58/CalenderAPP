const statusEl = document.getElementById('status');
const timeGridEl = document.getElementById('timeGrid');
const calendarGridEl = document.getElementById('calendarGrid');
const selectedSuggestionsEl = document.getElementById('selectedSuggestions');
const clearSelectionsBtn = document.getElementById('clearSelectionsBtn');
const submitResultEl = document.getElementById('submitResult');
const filtersForm = document.getElementById('filters');
const proposalForm = document.getElementById('proposalForm');
const submitBtnEl = proposalForm.querySelector('button[type="submit"]');

const startDateEl = document.getElementById('startDate');
const endDateEl = document.getElementById('endDate');
const slotPresetEl = document.getElementById('slotPreset');
const slotCustomEl = document.getElementById('slotCustom');

const nameEl = document.getElementById('name');
const emailEl = document.getElementById('email');
const noteEl = document.getElementById('note');

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 18;
let calendarTimeZone = 'Asia/Tokyo';
const API_BASE_URL = (globalThis.__APP_CONFIG__?.API_BASE_URL || '').replace(/\/$/, '');

let freeIntervals = [];
let selectedCells = new Set();
let isDragging = false;
let dragMode = 'select';

function apiUrl(pathWithQuery) {
  if (!API_BASE_URL) return pathWithQuery;
  return `${API_BASE_URL}${pathWithQuery}`;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function setDefaultDates() {
  const now = new Date();
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  startDateEl.value = toInputDate(now);
  endDateEl.value = toInputDate(end);
}

function toDayStart(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function minutesToHHMM(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateLabel(date) {
  return date.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  });
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get('year'),
    month: String(get('month')).padStart(2, '0'),
    day: String(get('day')).padStart(2, '0'),
    hour: get('hour'),
    minute: get('minute')
  };
}

function getSlotMinutes() {
  if (slotPresetEl.value === 'custom') {
    const v = Number(slotCustomEl.value);
    if (Number.isFinite(v) && v >= 10 && v <= 180) return v;
    return 30;
  }
  return Number(slotPresetEl.value);
}

function updateCustomInputVisibility() {
  slotCustomEl.hidden = slotPresetEl.value !== 'custom';
}

function getRangeDays() {
  const days = [];
  const start = toDayStart(startDateEl.value);
  const end = toDayStart(endDateEl.value);
  const cursor = new Date(start);

  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      days.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildDateParams() {
  return new URLSearchParams({
    start: new Date(`${startDateEl.value}T00:00:00`).toISOString(),
    end: new Date(`${endDateEl.value}T23:59:59`).toISOString()
  });
}

function getIntervalsByDay() {
  const map = new Map();
  for (const interval of freeIntervals) {
    const start = new Date(interval.start);
    const end = new Date(interval.end);
    const startParts = getZonedParts(start, calendarTimeZone);
    const endParts = getZonedParts(end, calendarTimeZone);
    const key = `${startParts.year}-${startParts.month}-${startParts.day}`;
    if (!map.has(key)) map.set(key, []);

    const startMin = startParts.hour * 60 + startParts.minute;
    const endMin = endParts.hour * 60 + endParts.minute;
    map.get(key).push({ startMin, endMin });
  }

  for (const [, ranges] of map) {
    ranges.sort((a, b) => a.startMin - b.startMin);
  }
  return map;
}

function isCellAvailable(dayKey, startMin, slotMinutes, byDay) {
  const ranges = byDay.get(dayKey) || [];
  const endMin = startMin + slotMinutes;
  return ranges.some((r) => startMin >= r.startMin && endMin <= r.endMin);
}

function cellKey(dayKey, startMin) {
  return `${dayKey}|${startMin}`;
}

function parseCellKey(key) {
  const [dayKey, startMinRaw] = key.split('|');
  return { dayKey, startMin: Number(startMinRaw) };
}

function cleanupSelectedCells(slotMinutes, byDay) {
  selectedCells = new Set(
    [...selectedCells].filter((key) => {
      const { dayKey, startMin } = parseCellKey(key);
      return isCellAvailable(dayKey, startMin, slotMinutes, byDay);
    })
  );
}

function applyCellSelection(dayKey, startMin) {
  const key = cellKey(dayKey, startMin);
  if (dragMode === 'select') {
    selectedCells.add(key);
  } else {
    selectedCells.delete(key);
  }
}

function syncCellSelectedClass(cell) {
  const key = cellKey(cell.dataset.dayKey, Number(cell.dataset.startMin));
  cell.classList.toggle('selected', selectedCells.has(key));
}

function buildMergedSuggestions(slotMinutes) {
  const grouped = new Map();
  for (const key of selectedCells) {
    const { dayKey, startMin } = parseCellKey(key);
    if (!grouped.has(dayKey)) grouped.set(dayKey, []);
    grouped.get(dayKey).push(startMin);
  }

  const result = [];
  for (const [dayKey, starts] of grouped) {
    starts.sort((a, b) => a - b);
    let curStart = null;
    let curEnd = null;

    for (const s of starts) {
      if (curStart === null) {
        curStart = s;
        curEnd = s + slotMinutes;
        continue;
      }
      if (s === curEnd) {
        curEnd += slotMinutes;
      } else {
        result.push({
          id: makeId(),
          start: new Date(`${dayKey}T${minutesToHHMM(curStart)}:00`).toISOString(),
          end: new Date(`${dayKey}T${minutesToHHMM(curEnd)}:00`).toISOString()
        });
        curStart = s;
        curEnd = s + slotMinutes;
      }
    }

    if (curStart !== null) {
      result.push({
        id: makeId(),
        start: new Date(`${dayKey}T${minutesToHHMM(curStart)}:00`).toISOString(),
        end: new Date(`${dayKey}T${minutesToHHMM(curEnd)}:00`).toISOString()
      });
    }
  }

  result.sort((a, b) => new Date(a.start) - new Date(b.start));
  return result;
}

function renderSelectedSuggestions(slotMinutes) {
  selectedSuggestionsEl.innerHTML = '';
  const suggestions = buildMergedSuggestions(slotMinutes);
  if (!suggestions.length) {
    selectedSuggestionsEl.innerHTML = '<p>まだ候補時間は選択されていません。</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const s of suggestions) {
    const start = new Date(s.start);
    const end = new Date(s.end);
    const card = document.createElement('article');
    card.className = 'suggestion-card';
    card.innerHTML = `
      <div>
        <strong>${formatDateLabel(start)}</strong><br>
        <small>${minutesToHHMM(start.getHours() * 60 + start.getMinutes())} - ${minutesToHHMM(end.getHours() * 60 + end.getMinutes())}</small>
      </div>
    `;
    frag.appendChild(card);
  }
  selectedSuggestionsEl.appendChild(frag);
}

function renderTimeGrid() {
  const slotMinutes = getSlotMinutes();
  const byDay = getIntervalsByDay();
  cleanupSelectedCells(slotMinutes, byDay);

  const days = getRangeDays();
  const startMin = WORK_START_HOUR * 60;
  const endMin = WORK_END_HOUR * 60;
  const columns = [];
  for (let m = startMin; m + slotMinutes <= endMin; m += slotMinutes) {
    columns.push(m);
  }

  timeGridEl.innerHTML = '';
  if (!days.length || !columns.length) {
    timeGridEl.innerHTML = '<p>表示できる時間枠がありません。</p>';
    renderSelectedSuggestions(slotMinutes);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'time-grid';

  const header = document.createElement('div');
  header.className = 'time-grid-row';
  header.style.setProperty('--cols', String(columns.length));
  header.innerHTML = '<div class="time-grid-day">日付 / 時間</div>';
  for (const m of columns) {
    const label = document.createElement('div');
    const hourStart = m % 60 === 0;
    label.className = `time-grid-label${hourStart ? ' hour-start' : ''}`;
    label.textContent = hourStart ? minutesToHHMM(m) : '';
    header.appendChild(label);
  }
  grid.appendChild(header);

  for (const day of days) {
    const dayKey = toDayKey(day);
    const row = document.createElement('div');
    row.className = 'time-grid-row';
    row.style.setProperty('--cols', String(columns.length));

    const dayLabel = document.createElement('div');
    dayLabel.className = 'time-grid-day';
    dayLabel.textContent = formatDateLabel(day);
    row.appendChild(dayLabel);

    for (const m of columns) {
      const available = isCellAvailable(dayKey, m, slotMinutes, byDay);
      const key = cellKey(dayKey, m);
      const selected = selectedCells.has(key);
      const cell = document.createElement('button');
      cell.type = 'button';
      const hourStart = m % 60 === 0;
      cell.className = `time-cell ${available ? 'available' : 'blocked'}${selected ? ' selected' : ''}${hourStart ? ' hour-start' : ''}`;
      cell.dataset.dayKey = dayKey;
      cell.dataset.startMin = String(m);
      cell.disabled = !available;

      if (available) {
        cell.addEventListener('mousedown', (e) => {
          e.preventDefault();
          isDragging = true;
          dragMode = selectedCells.has(key) ? 'unselect' : 'select';
          applyCellSelection(dayKey, m);
          syncCellSelectedClass(cell);
          renderSelectedSuggestions(slotMinutes);
        });

        cell.addEventListener('mouseenter', () => {
          if (!isDragging) return;
          applyCellSelection(dayKey, m);
          syncCellSelectedClass(cell);
          renderSelectedSuggestions(slotMinutes);
        });
      }

      row.appendChild(cell);
    }

    grid.appendChild(row);
  }

  timeGridEl.appendChild(grid);
  renderSelectedSuggestions(slotMinutes);
}

document.addEventListener('mouseup', () => {
  isDragging = false;
});

function parseEventBoundary(value, isAllDay) {
  if (isAllDay) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

function getWorkWindow(dayStart) {
  const workStart = new Date(dayStart);
  workStart.setHours(WORK_START_HOUR, 0, 0, 0);
  const workEnd = new Date(dayStart);
  workEnd.setHours(WORK_END_HOUR, 0, 0, 0);
  return { workStart, workEnd };
}

function formatHHMM(date) {
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function eventOverlapsDay(event, dayStart) {
  const { workStart, workEnd } = getWorkWindow(dayStart);
  const eventStart = parseEventBoundary(event.start, event.isAllDay);
  const eventEnd = parseEventBoundary(event.end, event.isAllDay);
  return eventStart < workEnd && eventEnd > workStart;
}

function formatDailyEventLine(event, dayStart) {
  if (event.isAllDay) {
    return `${String(WORK_START_HOUR).padStart(2, '0')}:00 - ${String(WORK_END_HOUR).padStart(2, '0')}:00`;
  }

  const { workStart, workEnd } = getWorkWindow(dayStart);
  const eventStart = parseEventBoundary(event.start, false);
  const eventEnd = parseEventBoundary(event.end, false);
  const from = eventStart < workStart ? `${String(WORK_START_HOUR).padStart(2, '0')}:00` : formatHHMM(eventStart);
  const to = eventEnd > workEnd ? `${String(WORK_END_HOUR).padStart(2, '0')}:00` : formatHHMM(eventEnd);
  return `${from} - ${to}`;
}

function renderCalendar(events) {
  calendarGridEl.innerHTML = '';
  const days = getRangeDays();
  if (!days.length) return;

  const weekdays = ['月', '火', '水', '木', '金'];
  const frag = document.createDocumentFragment();
  for (const label of weekdays) {
    const head = document.createElement('div');
    head.className = 'weekday';
    head.textContent = label;
    frag.appendChild(head);
  }

  const firstDayOffset = Math.max(0, days[0].getDay() - 1);
  for (let i = 0; i < firstDayOffset; i += 1) {
    const blank = document.createElement('div');
    blank.className = 'calendar-cell blank';
    frag.appendChild(blank);
  }

  for (const dayStart of days) {
    const dayEvents = events.filter((event) => eventOverlapsDay(event, dayStart));
    const cell = document.createElement('article');
    cell.className = 'calendar-cell';

    const head = document.createElement('div');
    head.className = 'cell-head';

    const dayNum = document.createElement('span');
    dayNum.className = 'cell-day';
    dayNum.textContent = String(dayStart.getDate());
    head.appendChild(dayNum);

    const badge = document.createElement('span');
    badge.className = `badge ${dayEvents.length ? 'busy' : 'free'}`;
    badge.textContent = dayEvents.length ? `予定あり ${dayEvents.length}件` : '予定なし';
    head.appendChild(badge);

    cell.appendChild(head);

    const lines = document.createElement('div');
    lines.className = 'event-lines';

    if (dayEvents.length) {
      for (const event of dayEvents.slice(0, 3)) {
        const line = document.createElement('div');
        line.className = 'event-line';
        line.textContent = formatDailyEventLine(event, dayStart);
        lines.appendChild(line);
      }
      if (dayEvents.length > 3) {
        const more = document.createElement('div');
        more.className = 'event-line';
        more.textContent = `ほか ${dayEvents.length - 3}件`;
        lines.appendChild(more);
      }
    }

    cell.appendChild(lines);
    frag.appendChild(cell);
  }

  calendarGridEl.appendChild(frag);
}

async function loadCalendarView() {
  statusEl.textContent = '空き枠と予定カレンダーを読み込み中です...';
  const baseParams = buildDateParams();

  try {
    const [intervalsRes, eventsRes] = await Promise.all([
      fetch(apiUrl(`/api/free-intervals?${baseParams.toString()}`)),
      fetch(apiUrl(`/api/calendar-events?${baseParams.toString()}`))
    ]);

    const [intervalsData, eventsData] = await Promise.all([
      intervalsRes.json(),
      eventsRes.json()
    ]);

    if (!intervalsRes.ok) throw new Error(intervalsData.error || '空き時間帯の取得に失敗しました');
    if (!eventsRes.ok) throw new Error(eventsData.error || '予定の取得に失敗しました');

    const eventList = eventsData.events || [];
    calendarTimeZone = intervalsData.timezone || 'Asia/Tokyo';
    freeIntervals = intervalsData.intervals || [];
    renderTimeGrid();
    renderCalendar(eventList);
    statusEl.textContent = `空き時間帯 ${freeIntervals.length} 件 / 予定 ${eventList.length} 件`;
  } catch (err) {
    statusEl.textContent = err.message;
    timeGridEl.innerHTML = '';
    selectedSuggestionsEl.innerHTML = '';
    calendarGridEl.innerHTML = '';
  }
}

let autoReloadTimer;
function scheduleAutoReload() {
  clearTimeout(autoReloadTimer);
  autoReloadTimer = setTimeout(loadCalendarView, 200);
}

filtersForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadCalendarView();
});

startDateEl.addEventListener('change', scheduleAutoReload);
endDateEl.addEventListener('change', scheduleAutoReload);
slotPresetEl.addEventListener('change', () => {
  updateCustomInputVisibility();
  scheduleAutoReload();
});
slotCustomEl.addEventListener('input', scheduleAutoReload);

clearSelectionsBtn.addEventListener('click', () => {
  selectedCells = new Set();
  renderTimeGrid();
});

proposalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitResultEl.textContent = '';
  submitResultEl.className = 'submit-result';

  const slotSuggestions = buildMergedSuggestions(getSlotMinutes()).map(({ start, end }) => ({ start, end }));

  if (!slotSuggestions.length) {
    statusEl.textContent = '候補時間を1つ以上選択してください。';
    return;
  }

  statusEl.textContent = '候補時間を送信中です...';
  submitBtnEl.disabled = true;
  submitBtnEl.classList.add('loading');
  submitBtnEl.textContent = '送信中です...';
  try {
    const res = await fetch(apiUrl('/api/proposals'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameEl.value,
        email: emailEl.value,
        note: noteEl.value,
        slotSuggestions
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '送信に失敗しました');

    statusEl.textContent = '';
    submitResultEl.textContent = '送信を完了しました。ありがとうございます。';
    submitResultEl.classList.add('success');
    proposalForm.reset();
    selectedCells = new Set();
    renderTimeGrid();
  } catch (err) {
    statusEl.textContent = '';
    submitResultEl.textContent = err.message;
    submitResultEl.classList.add('error');
  } finally {
    submitBtnEl.disabled = false;
    submitBtnEl.classList.remove('loading');
    submitBtnEl.textContent = '選択した候補を送信する';
  }
});

setDefaultDates();
updateCustomInputVisibility();
loadCalendarView();
