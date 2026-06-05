// ── Auth state ─────────────────────────────────────────────────────────────────
// currentUser is set by authInit() at startup and used throughout the app.
// null = not yet loaded (never shown to user); populated = {username, role, playerId}
let currentUser = null;

async function authInit() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    currentUser = await res.json();
  } catch {
    window.location.href = '/login';
    return;
  }
  _authUpdateHeader();
}

function _authUpdateHeader() {
  if (!currentUser) return;
  const badge          = document.getElementById('userBadge');
  const logoutBtn      = document.getElementById('logoutBtn');
  const adminBtn       = document.getElementById('tab-btn-admin');
  const changePwBtn    = document.getElementById('changePwBtn');
  const addPlayerBar   = document.getElementById('addPlayerBar');
  const wantAddPlayer  = document.getElementById('wantAddPlayerBar');
  const isAdmin        = currentUser.role === 'admin';
  const isOpenMode     = currentUser.username === 'guest';

  if (badge) {
    badge.textContent = currentUser.username;
    badge.style.display = '';
    badge.classList.toggle('user-badge-admin', isAdmin);
  }
  const mobAdminBtn   = document.getElementById('mob-tab-admin');
  const mobNavUser    = document.getElementById('mobNavUser');
  const mobChangePw   = document.getElementById('mob-changepw-btn');
  const mobLogout     = document.getElementById('mob-logout-btn');
  if (logoutBtn)    logoutBtn.style.display    = '';
  if (adminBtn)     adminBtn.style.display     = isAdmin ? '' : 'none';
  if (mobAdminBtn)  mobAdminBtn.style.display  = isAdmin ? '' : 'none';
  if (changePwBtn)  changePwBtn.style.display  = isOpenMode ? 'none' : '';
  if (mobNavUser)   mobNavUser.textContent      = currentUser.username;
  if (mobChangePw)  mobChangePw.style.display   = isOpenMode ? 'none' : '';
  if (mobLogout)    mobLogout.style.display      = '';
  if (addPlayerBar)  addPlayerBar.style.display  = isAdmin ? '' : 'none';
  if (wantAddPlayer) wantAddPlayer.style.display = isAdmin ? '' : 'none';
}

function openChangePassword() {
  const modal = document.getElementById('changePwModal');
  if (!modal) return;
  document.getElementById('cpCurrentPw').value  = '';
  document.getElementById('cpNewPw').value      = '';
  document.getElementById('cpConfirmPw').value  = '';
  const err = document.getElementById('cpError');
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('cpCurrentPw').focus(), 50);
}

function closeChangePassword() {
  const modal = document.getElementById('changePwModal');
  if (modal) modal.style.display = 'none';
}

async function submitChangePassword() {
  const currentPw = document.getElementById('cpCurrentPw').value;
  const newPw     = document.getElementById('cpNewPw').value.trim();
  const confirmPw = document.getElementById('cpConfirmPw').value.trim();
  const errEl     = document.getElementById('cpError');
  const btn       = document.getElementById('cpSubmitBtn');

  function showErr(msg) { errEl.textContent = msg; errEl.style.display = ''; }
  errEl.style.display = 'none';

  if (!currentPw || !newPw)   return showErr('All fields are required.');
  if (newPw.length < 6)        return showErr('New password must be at least 6 characters.');
  if (newPw !== confirmPw)     return showErr('Passwords do not match.');

  btn.disabled = true;
  try {
    const res  = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) return showErr(data.error || 'Failed to change password.');
    closeChangePassword();
    _showWantToast('Password changed successfully');
  } catch {
    showErr('Network error. Please try again.');
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// Returns true if the logged-in user owns the given playerId (or is admin)
function isMyPlayer(playerId) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  return currentUser.playerId === playerId;
}

// ── Quick "add to my wants" (from search/set browser) ─────────────────────────
async function quickAddToMyWants(cardName, btn) {
  if (!currentUser?.playerId) {
    alert('Your account is not linked to a player yet. Ask an admin to link it in the Admin panel.');
    return;
  }
  try {
    btn.disabled = true;
    const res = await fetch(`/api/players/${encodeURIComponent(currentUser.playerId)}/wants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardName }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    // Update local state so re-renders show correct state
    const player = state.players.find(p => p.id === currentUser.playerId);
    if (player) {
      if (!player.wantList) player.wantList = [];
      if (!player.wantList.includes(cardName)) player.wantList.push(cardName);
    }
    btn.textContent = '✓';
    btn.classList.add('want-quick-added');
    _showWantToast(cardName);
  } catch (e) {
    btn.disabled = false;
    alert(`Could not add to wants: ${e.message}`);
  }
}

// HTML snippet for the want button — returns '' if user has no linked player
function wantBtnHtml(cardName) {
  if (!currentUser?.playerId) return '';
  const player  = state.players.find(p => p.id === currentUser.playerId);
  const already = player?.wantList?.includes(cardName) || false;
  return `<button class="want-quick-btn${already ? ' want-quick-added' : ''}"
    onclick="quickAddToMyWants('${jsAttr(cardName)}', this)"
    title="${already ? 'Already on your want list' : 'Add to my wants'}"
    ${already ? 'disabled' : ''}>
    ${already ? '✓' : '+'}
  </button>`;
}

function _showWantToast(cardName) {
  let toast = document.getElementById('wantToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'wantToast';
    toast.className = 'want-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = `✓  Added "${cardName}" to your wants`;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 2800);
}
