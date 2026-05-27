// ── Available@ embedded calendar ──────────────────────────────────────────────

const AVAIL_MONTHS    = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
const AVAIL_WEEK_DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const AVAIL_NAME_KEY  = 'avail_name';

let availCalId      = null;
let availCalData    = null;
let availColorMap   = {};
let availName       = localStorage.getItem(AVAIL_NAME_KEY) || '';
let availViewYear   = 0;
let availViewMonth  = 0;
let availInitDone   = false;

const availTodayISO  = new Date().toISOString().slice(0, 10);
const availTodayDate = new Date(availTodayISO + 'T00:00:00');

function availToISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function availBuildColorMap() {
  const names = [...new Set(availCalData.availability.map(a => a.person_name))].sort();
  availColorMap = {};
  names.forEach((n, i) => { availColorMap[n] = i % 8; });
}

function availBuildLookup() {
  const map = {};
  for (const { person_name, date } of availCalData.availability) {
    if (!map[date]) map[date] = [];
    map[date].push(person_name);
  }
  return map;
}

function availRenderCalendar() {
  const lookup = availBuildLookup();
  document.getElementById('availMonthTitle').textContent =
    `${AVAIL_MONTHS[availViewMonth]} ${availViewYear}`;
  const prevBtn = document.getElementById('availPrevBtn');
  if (prevBtn) prevBtn.disabled =
    availViewYear === availTodayDate.getFullYear() &&
    availViewMonth === availTodayDate.getMonth();

  const firstDow    = (new Date(availViewYear, availViewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(availViewYear, availViewMonth + 1, 0).getDate();

  let html = AVAIL_WEEK_DAYS.map(d => `<div class="cal-hdr">${d}</div>`).join('');
  for (let i = 0; i < firstDow; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const iso     = availToISO(availViewYear, availViewMonth, d);
    const past    = iso < availTodayISO;
    const isToday = iso === availTodayISO;
    const cls     = 'cal-cell' + (past ? ' past' : ' clickable') + (isToday ? ' today' : '');
    const names   = lookup[iso] || [];
    const myDay   = availName && names.includes(availName) ? ' my-day' : '';
    const namesHtml = names.map(n =>
      `<span class="name-tag p${availColorMap[n] ?? 0}">${esc(n)}</span>`
    ).join('');
    const click = !past ? `onclick="availToggleDay('${iso}')"` : '';
    html += `<div class="${cls}${myDay}" ${click}>
      <span class="day-num">${d}</span>
      <div class="day-names">${namesHtml}</div>
    </div>`;
  }
  document.getElementById('availCalGrid').innerHTML = html;
}

function availRenderBestDays() {
  const lookup = availBuildLookup();
  const ranked = Object.entries(lookup)
    .filter(([date]) => date >= availTodayISO)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 8);

  const el = document.getElementById('availBestDays');
  if (!el) return;
  if (!ranked.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:.875rem">No availability marked yet — be the first!</p>';
    return;
  }
  el.innerHTML = ranked.map(([date, names]) => {
    const dt    = new Date(date + 'T00:00:00');
    const label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const tags  = names.map(n =>
      `<span class="name-tag p${availColorMap[n] ?? 0}">${esc(n)}</span>`
    ).join('');
    return `<div class="best-day">
      <div class="best-day-info">
        <div class="best-day-date">${label}</div>
        <div class="best-day-count">${names.length} available</div>
      </div>
      <div class="best-day-names">${tags}</div>
    </div>`;
  }).join('');
}

function availOnNameChange(val) {
  availName = val.trim();
  localStorage.setItem(AVAIL_NAME_KEY, availName);
  const removeBtn = document.getElementById('availRemoveBtn');
  const nameHint  = document.getElementById('availNameHint');
  const hasEntries = availName && availCalData?.availability.some(a => a.person_name === availName);
  if (removeBtn) removeBtn.style.display = hasEntries ? 'inline-block' : 'none';
  if (nameHint) nameHint.textContent = availName
    ? 'Click a day to toggle your availability'
    : 'Enter your name to mark your availability';
  availRenderCalendar();
}

async function availToggleDay(iso) {
  if (!availName) {
    const inp = document.getElementById('availNameInput');
    if (!inp) return;
    inp.focus();
    inp.classList.add('shake');
    setTimeout(() => inp.classList.remove('shake'), 400);
    return;
  }

  const idx = availCalData.availability.findIndex(
    a => a.person_name === availName && a.date === iso
  );
  if (idx >= 0) availCalData.availability.splice(idx, 1);
  else availCalData.availability.push({ person_name: availName, date: iso });

  availBuildColorMap();
  availRenderCalendar();
  availRenderBestDays();
  availOnNameChange(availName);

  try {
    await fetch(`/available/api/calendars/${availCalId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_name: availName, date: iso }),
    });
  } catch { await availLoad(); }
}

async function availRemoveSelf() {
  if (!availName || !confirm(`Remove all of "${availName}"'s availability?`)) return;
  await fetch(`/available/api/calendars/${availCalId}/persons/${encodeURIComponent(availName)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  await availLoad();
}

function availPrevMonth() {
  if (availViewMonth === 0) { availViewMonth = 11; availViewYear--; } else availViewMonth--;
  availRenderCalendar();
}

function availNextMonth() {
  if (availViewMonth === 11) { availViewMonth = 0; availViewYear++; } else availViewMonth++;
  availRenderCalendar();
}

function availInitUI() {
  availBuildColorMap();
  availViewYear  = availTodayDate.getFullYear();
  availViewMonth = availTodayDate.getMonth();

  document.getElementById('availLoading').style.display = 'none';
  document.getElementById('availApp').style.display     = '';

  // For logged-in non-admin users, pin the name to their linked player
  const openMode = currentUser?.username === 'guest';
  if (currentUser && currentUser.role !== 'admin' && !openMode) {
    const linked = currentUser.playerId
      ? state.players.find(p => p.id === currentUser.playerId)
      : null;
    if (linked) {
      availName = linked.name;
    } else {
      // No linked player — show notice and disable calendar interaction
      const hint = document.getElementById('availNameHint');
      if (hint) hint.textContent = 'Your account is not linked to a player. Ask an admin to link it.';
    }
  }

  const nameInp = document.getElementById('availNameInput');
  if (nameInp) {
    nameInp.value    = availName;
    const openMode   = currentUser?.username === 'guest';
    const isLocked   = currentUser && currentUser.role !== 'admin' && !openMode;
    nameInp.readOnly = isLocked;
    nameInp.style.opacity = isLocked ? '.65' : '';
    nameInp.style.cursor  = isLocked ? 'default' : '';
    availOnNameChange(availName);
  }
  availRenderCalendar();
  availRenderBestDays();
}

async function availLoad() {
  try {
    const res = await fetch(`/available/api/calendars/${availCalId}`);
    if (!res.ok) throw new Error(res.status);
    availCalData = await res.json();
    availInitUI();
  } catch (e) {
    const el = document.getElementById('availLoading');
    if (el) el.textContent = 'Failed to load calendar. Please refresh.';
  }
}

async function initAvailable() {
  if (availInitDone) return;
  availInitDone = true;
  // The default calendar ID is always 'default' — skip the extra round-trip
  // to /available/api/default and go straight to loading calendar data.
  availCalId = 'default';
  await availLoad();
}
