// ── Mana Base Calculator ───────────────────────────────────────────────────

const LAND_NAMES  = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes' };
const LAND_COLORS = { W: '#c8b87a', U: '#4a90d9', B: '#7a7a8a', R: '#d94a4a', G: '#3a9a5c', C: '#888' };
const LAND_BG     = { W: 'rgba(200,184,122,.15)', U: 'rgba(74,144,217,.15)', B: 'rgba(122,122,138,.15)', R: 'rgba(217,74,74,.15)', G: 'rgba(58,154,92,.15)', C: 'rgba(160,160,160,.1)' };

let _landsInited = false;

function initLands() {
  if (_landsInited) return;
  _landsInited = true;

  const recalc = () => landsRecalc();
  ['W','U','B','R','G','C'].forEach(c => document.getElementById(`pip-${c}`).addEventListener('input', recalc));
  ['dual','fetch','other'].forEach(k => document.getElementById(`nb-${k}`).addEventListener('input', recalc));

  landsAddSteppers();

  document.querySelectorAll('.land-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.land-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('landsCustomSize').value = '';
      landsRecalc();
    });
  });

  landsRecalc();
}

// Wrap each number input with custom − / + stepper buttons.
function landsAddSteppers() {
  document.querySelectorAll('.lands-num-input').forEach(input => {
    if (input.parentNode.classList.contains('num-stepper')) return; // already wrapped
    const wrap = document.createElement('div');
    wrap.className = 'num-stepper';
    input.parentNode.insertBefore(wrap, input);

    const makeBtn = (label, delta) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stepper-btn';
      b.textContent = label;
      b.tabIndex = -1;
      b.setAttribute('aria-label', delta < 0 ? 'Decrease' : 'Increase');
      b.addEventListener('click', () => landsStep(input, delta));
      return b;
    };

    wrap.appendChild(makeBtn('−', -1)); // − (minus sign)
    wrap.appendChild(input);
    wrap.appendChild(makeBtn('+', 1));
  });
}

function landsStep(input, delta) {
  const min = input.min !== '' ? parseInt(input.min) : 0;
  const max = input.max !== '' ? parseInt(input.max) : Infinity;
  let v = parseInt(input.value);
  if (isNaN(v)) v = 0;
  v = Math.max(min, Math.min(max, v + delta));
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function landsGetDeckSize() {
  const custom = parseInt(document.getElementById('landsCustomSize').value);
  if (custom > 0) return custom;
  const active = document.querySelector('.land-preset-btn.active');
  return active ? parseInt(active.dataset.size) : 60;
}

function landsOnCustomSize(val) {
  if (val && parseInt(val) > 0) {
    document.querySelectorAll('.land-preset-btn').forEach(b => b.classList.remove('active'));
  }
  landsRecalc();
}

function landsDefaultLands(deckSize) {
  if (deckSize === 40)  return 17;
  if (deckSize === 60)  return 24;
  if (deckSize === 100) return 38;
  return Math.round(deckSize * 0.4);
}

function landsDistribute(basicSlots, pips) {
  const colors = ['W','U','B','R','G','C'];
  const totalPips = colors.reduce((s, c) => s + (pips[c] || 0), 0);
  if (totalPips === 0) return colors.reduce((o, c) => { o[c] = 0; return o; }, {});

  const exact  = {};
  const floors = {};
  colors.forEach(c => {
    exact[c]  = basicSlots * (pips[c] || 0) / totalPips;
    floors[c] = Math.floor(exact[c]);
  });

  let remaining = basicSlots - colors.reduce((s, c) => s + floors[c], 0);
  const fracs = colors.map(c => ({ c, frac: exact[c] - floors[c] })).sort((a, b) => b.frac - a.frac);

  const result = { ...floors };
  for (let i = 0; i < remaining; i++) result[fracs[i].c]++;
  return result;
}

function landsRecalc() {
  const deckSize  = landsGetDeckSize();
  const totalLands = landsDefaultLands(deckSize);

  const nonBasics = (parseInt(document.getElementById('nb-dual').value)  || 0)
                  + (parseInt(document.getElementById('nb-fetch').value) || 0)
                  + (parseInt(document.getElementById('nb-other').value) || 0);

  const basicSlots = Math.max(0, totalLands - nonBasics);

  const pips = {};
  ['W','U','B','R','G','C'].forEach(c => { pips[c] = parseInt(document.getElementById(`pip-${c}`).value) || 0; });
  const totalPips = Object.values(pips).reduce((s, v) => s + v, 0);

  const dist = landsDistribute(basicSlots, pips);

  renderLands(deckSize, totalLands, nonBasics, basicSlots, dist, totalPips, pips);
}

function renderLands(deckSize, totalLands, nonBasics, basicSlots, dist, totalPips, pips) {
  const colors = ['W','U','B','R','G','C'];

  // Summary cards
  const summaryEl = document.getElementById('landsSummaryCards');
  summaryEl.innerHTML = `
    <div class="lands-stat-card">
      <div class="lands-stat-val">${totalLands}</div>
      <div class="lands-stat-lbl">Total Lands</div>
    </div>
    <div class="lands-stat-card">
      <div class="lands-stat-val">${nonBasics}</div>
      <div class="lands-stat-lbl">Non-Basics</div>
    </div>
    <div class="lands-stat-card lands-stat-highlight">
      <div class="lands-stat-val">${basicSlots}</div>
      <div class="lands-stat-lbl">Basic Lands</div>
    </div>`;

  const rowsEl  = document.getElementById('landsResultRows');
  const emptyEl = document.getElementById('landsEmptyState');

  if (totalPips === 0) {
    rowsEl.innerHTML  = '';
    emptyEl.style.display = '';
    emptyEl.textContent = `Enter pip counts to see how to split your ${basicSlots} basic land${basicSlots !== 1 ? 's' : ''}.`;
    return;
  }

  emptyEl.style.display = 'none';

  const maxCount = Math.max(...colors.map(c => dist[c]), 1);

  let rows = '';
  colors.forEach(c => {
    const count = dist[c];
    if (count === 0 && pips[c] === 0) return; // hide colors not in use
    const barPct = count / maxCount * 100;
    const sharePct = basicSlots > 0 ? Math.round(count / basicSlots * 100) : 0;
    rows += `
      <div class="lands-row">
        <i class="ms ms-${c.toLowerCase()} ms-cost ms-shadow lands-row-mana"></i>
        <div class="lands-name">${LAND_NAMES[c]}</div>
        <div class="lands-bar-wrap">
          <div class="lands-bar-fill" style="width:${barPct}%;background:${LAND_COLORS[c]}"></div>
        </div>
        <div class="lands-count" style="color:${LAND_COLORS[c]}">${count}</div>
        <div class="lands-share">${count > 0 ? sharePct + '%' : '—'}</div>
      </div>`;
  });

  rowsEl.innerHTML = rows;
}

function landsReset() {
  ['W','U','B','R','G','C'].forEach(c => { document.getElementById(`pip-${c}`).value = ''; });
  ['dual','fetch','other'].forEach(k => { document.getElementById(`nb-${k}`).value = ''; });
  document.getElementById('landsCustomSize').value = '';
  document.querySelectorAll('.land-preset-btn').forEach((b, i) => b.classList.toggle('active', i === 1));
  landsRecalc();
}
