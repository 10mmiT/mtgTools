// ── Available@ embedded calendar ──────────────────────────────────────────────

const AVAIL_MONTHS    = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
const AVAIL_WEEK_DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
// AVAIL_NAME_KEY is in js/state.js: the name behind this bar is what a
// deployment with no accounts uses as an identity, so two features read it.

let availCalId      = null;
let availCalData    = null;
let availColorMap   = {};
let availName       = localStorage.getItem(AVAIL_NAME_KEY) || '';
let availViewYear   = 0;
let availViewMonth  = 0;
let availInitDone   = false;
let availWeekOffset = 0; // 0 = this week, 1 = next week, …

function availToISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Use the LOCAL date, not toISOString() (UTC) — otherwise between midnight
// and the UTC rollover "today" highlights yesterday and blocks toggling it.
const availTodayISO  = (() => { const n = new Date(); return availToISO(n.getFullYear(), n.getMonth(), n.getDate()); })();
const availTodayDate = new Date(availTodayISO + 'T00:00:00');

// ── Colour (§5.6) ────────────────────────────────────────────────────────────
// A name on this calendar is a person, and a person has one colour across the
// app: the slot on their player record, which is what their chip on Players,
// their tick on the Want List and their heading on Pick Night are all drawn
// from. This tab used to number names by their position in a sorted list
// instead, so the same person was one colour here and another everywhere else
// — and everyone's colour shifted the moment a name earlier in the alphabet
// marked a day.
//
// Open mode lets anyone type any name, so a name with no player record falls
// back to a hash of the name itself: stable for that person, on every device,
// which position in a list is not. The hash is playerSlot()'s own fallback,
// over the name rather than over an id these entries do not have.
function availSlot(name) {
  const key    = String(name || '').trim().toLowerCase();
  const player = state.players.find(p => String(p.name || '').trim().toLowerCase() === key);
  if (player) return playerSlot(player);
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % PLAYER_SLOTS;
}

function availBuildColorMap() {
  const names = [...new Set(availCalData.availability.map(a => a.person_name))];
  availColorMap = {};
  // The var() reference, not a resolved colour — the tags are rendered once
  // and must repaint with the theme, exactly as playerColor() does elsewhere.
  for (const n of names) availColorMap[n] = `var(--player-${availSlot(n)})`;
}

function availBuildLookup() {
  const map = {};
  for (const { person_name, date } of availCalData.availability) {
    if (!map[date]) map[date] = [];
    map[date].push(person_name);
  }
  return map;
}

// ── Week helpers ──────────────────────────────────────────────────────────────

function availWeekDates(offset) {
  // Monday of the week (offset weeks from now), returns array of 7 Date objects
  const dow     = (availTodayDate.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const monday  = new Date(availTodayDate);
  monday.setDate(availTodayDate.getDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function availWeekRangeLabel(days) {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const a = days[0], b = days[6];
  return a.getMonth() === b.getMonth()
    ? `${M[a.getMonth()]} ${a.getDate()}–${b.getDate()}`
    : `${M[a.getMonth()]} ${a.getDate()} – ${M[b.getMonth()]} ${b.getDate()}`;
}

function availRenderWeekView() {
  const el = document.getElementById('availWeekCal');
  if (!el) return;

  const DOWS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const days   = availWeekDates(availWeekOffset);
  const lookup = availBuildLookup();

  let html = `<div class="cal-header" style="margin-bottom:var(--space-2)">
    <button class="nav-btn" onclick="availWeekPrev()" ${availWeekOffset === 0 ? 'disabled' : ''}>&#8249;</button>
    <span class="month-title">${availWeekRangeLabel(days)}</span>
    <button class="nav-btn" onclick="availWeekNext()">&#8250;</button>
  </div><div class="avail-week-list">`;

  for (let i = 0; i < 7; i++) {
    const date  = days[i];
    const iso   = availToISO(date.getFullYear(), date.getMonth(), date.getDate());
    const past  = iso < availTodayISO;
    const today = iso === availTodayISO;
    const names = lookup[iso] || [];
    const myDay = availName && names.includes(availName);

    const tags  = names.map(n =>
      `<span class="name-tag" style="--player:${availColorMap[n] ?? 'var(--player-0)'}">${esc(n)}</span>`
    ).join('');

    const cls   = 'avail-week-row'
      + (past  ? ' past'   : ' clickable')
      + (today ? ' today'  : '')
      + (myDay ? ' my-day' : '');
    const click = !past ? `onclick="availToggleDay('${iso}')"` : '';

    html += `<div class="${cls}" ${click}>
      <span class="avail-week-dow">${DOWS[i]}</span>
      <span class="avail-week-day${today ? ' avail-week-today' : ''}">${date.getDate()}</span>
      <div class="avail-week-names">${tags || (past ? '' : '<span class="avail-week-free">free</span>')}</div>
    </div>`;
  }

  html += '</div>';
  el.innerHTML = html;
}

function availWeekPrev() {
  if (availWeekOffset > 0) { availWeekOffset--; availRenderWeekView(); }
}

function availWeekNext() {
  availWeekOffset++;
  availRenderWeekView();
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
      `<span class="name-tag" style="--player:${availColorMap[n] ?? 'var(--player-0)'}">${esc(n)}</span>`
    ).join('');
    const click = !past ? `onclick="availToggleDay('${iso}')"` : '';
    html += `<div class="${cls}${myDay}" ${click}>
      <span class="day-num">${d}</span>
      <div class="day-names">${namesHtml}</div>
    </div>`;
  }
  document.getElementById('availCalGrid').innerHTML = html;
  availRenderWeekView();
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
    el.innerHTML = '<div class="empty-state">No availability marked yet — be the first!</div>';
    return;
  }
  el.innerHTML = ranked.map(([date, names]) => {
    const dt    = new Date(date + 'T00:00:00');
    const label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const tags  = names.map(n =>
      `<span class="name-tag" style="--player:${availColorMap[n] ?? 'var(--player-0)'}">${esc(n)}</span>`
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
  /* In open mode this bar is the only thing that says who you are, so typing
   * a name into it is what makes "my shelf" mean something — and the control
   * that offers it is on another tab, drawn before this was answered. */
  if (typeof colIdentityChanged === 'function') colIdentityChanged();
  const removeBtn = document.getElementById('availRemoveBtn');
  const nameHint  = document.getElementById('availNameHint');
  const hasEntries = availName && availCalData?.availability.some(a => a.person_name === availName);
  if (removeBtn) removeBtn.style.display = hasEntries ? '' : 'none';
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

  // Logged-in non-admin users are identified by their linked player, so the
  // "Who are you?" bar is pointless for them — hide the whole strip. It stays
  // visible for admins (who may manage other people's availability) and in
  // open/guest mode (where the name input is the only way to identify anyone).
  const openMode = currentUser?.username === 'guest';
  const isPinned = currentUser && currentUser.role !== 'admin' && !openMode;
  let   unlinked = false;
  if (isPinned) {
    const linked = currentUser.playerId
      ? state.players.find(p => p.id === currentUser.playerId)
      : null;
    if (linked) availName = linked.name;
    else { unlinked = true; availName = ''; } // no linked player — can't mark days
  }

  const nameBar = document.getElementById('availNameBar');
  if (nameBar) nameBar.style.display = (isPinned && !unlinked) ? 'none' : '';

  const nameInp = document.getElementById('availNameInput');
  if (nameInp) {
    nameInp.value    = availName;
    nameInp.readOnly = isPinned;
    nameInp.style.opacity = isPinned ? '.65' : '';
    nameInp.style.cursor  = isPinned ? 'default' : '';
    availOnNameChange(availName);
  }

  // Unlinked account: keep the panel visible as a notice, minus the input
  // (set after availOnNameChange, which would otherwise overwrite the hint)
  if (unlinked) {
    const hint = document.getElementById('availNameHint');
    if (hint) hint.textContent = 'Your account is not linked to a player. Ask an admin to link it.';
    if (nameInp) nameInp.style.display = 'none';
    const lbl = document.querySelector('#availNameBar label');
    if (lbl) lbl.style.display = 'none';
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
