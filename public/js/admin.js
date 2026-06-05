// ── Admin Panel ───────────────────────────────────────────────────────────────
let _adminInited = false;

async function initAdmin() {
  if (!_adminInited) {
    _adminInited = true;
  }
  await Promise.all([adminLoadUsers(), adminLoadRequests()]);
}

async function adminLoadRequests() {
  const tbody = document.getElementById('adminRequestsBody');
  const badge = document.getElementById('adminReqBadge');
  if (!tbody) return;
  try {
    const res  = await fetch('/api/admin/account-requests');
    const reqs = await res.json();
    if (badge) {
      badge.textContent    = reqs.length;
      badge.style.display  = reqs.length ? '' : 'none';
    }
    if (!reqs.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No pending requests.</td></tr>';
      return;
    }
    tbody.innerHTML = reqs.map(r => _adminRequestRow(r)).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
  }
}

function _adminRequestRow(r) {
  const date = new Date(r.requested_at + 'Z').toLocaleDateString();
  return `<tr id="admin-req-row-${r.id}">
    <td class="td-name">${esc(r.username)}</td>
    <td style="font-size:.8rem;color:var(--muted)">${date}</td>
    <td class="admin-actions">
      <button class="btn-update" onclick="adminExpandApprove(${r.id},'${jsAttr(r.username)}')">Approve</button>
      <button class="btn-remove" onclick="adminDenyRequest(${r.id},'${jsAttr(r.username)}')">Deny</button>
    </td>
  </tr>`;
}

function adminExpandApprove(id, username) {
  const row = document.getElementById(`admin-req-row-${id}`);
  if (!row) return;
  const playerOpts = [
    '<option value="">— No linked player —</option>',
    ...state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`),
  ].join('');
  row.innerHTML = `
    <td class="td-name">${esc(username)}</td>
    <td colspan="2">
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
        <select id="req-role-${id}" style="font-size:.8rem;padding:.28rem .4rem;background:var(--card-2);color:var(--text);border:1.5px solid var(--border);border-radius:6px;font-family:inherit">
          <option value="player">Player</option>
          <option value="admin">Admin</option>
        </select>
        <select id="req-player-${id}" style="font-size:.8rem;padding:.28rem .4rem;background:var(--card-2);color:var(--text);border:1.5px solid var(--border);border-radius:6px;font-family:inherit;max-width:160px">
          ${playerOpts}
        </select>
        <button class="btn-update" onclick="adminConfirmApprove(${id})">Confirm</button>
        <button class="btn-secondary" style="padding:.25rem .6rem;font-size:.75rem" onclick="adminLoadRequests()">Cancel</button>
      </div>
    </td>`;
}

async function adminConfirmApprove(id) {
  const role     = document.getElementById(`req-role-${id}`)?.value || 'player';
  const playerId = document.getElementById(`req-player-${id}`)?.value || null;
  try {
    const res = await fetch(`/api/admin/account-requests/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, playerId: playerId || null }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    await Promise.all([adminLoadRequests(), adminLoadUsers()]);
  } catch (e) { alert(`Error: ${e.message}`); }
}

async function adminDenyRequest(id, username) {
  if (!confirm(`Deny account request from "${username}"?`)) return;
  try {
    const res = await fetch(`/api/admin/account-requests/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    await adminLoadRequests();
  } catch (e) { alert(`Error: ${e.message}`); }
}

async function adminLoadUsers() {
  const container = document.getElementById('adminUsersBody');
  if (!container) return;
  container.innerHTML = '<tr><td colspan="4" class="empty-state">Loading…</td></tr>';
  try {
    const res   = await fetch('/api/admin/users');
    const users = await res.json();
    if (!users.length) {
      container.innerHTML = '<tr><td colspan="4" class="empty-state">No users yet.</td></tr>';
      return;
    }
    container.innerHTML = users.map(u => _adminUserRow(u)).join('');
  } catch (e) {
    container.innerHTML = `<tr><td colspan="4" class="empty-state" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
  }
}

function _adminUserRow(u) {
  const linkedPlayer = state.players.find(p => p.id === u.player_id);
  const playerLabel  = linkedPlayer ? esc(linkedPlayer.name) : '<span style="color:var(--muted)">—</span>';
  const roleBadge    = u.role === 'admin'
    ? `<span class="badge badge-admin">Admin</span>`
    : `<span class="badge badge-player">Player</span>`;
  const isAdmin = u.username === 'admin';
  return `<tr id="admin-user-row-${esc(u.username)}">
    <td class="td-name">${esc(u.username)}</td>
    <td>${roleBadge}</td>
    <td>${playerLabel}</td>
    <td class="admin-actions">
      <button class="btn-update" onclick="adminEditUser('${jsAttr(u.username)}')">Edit</button>
      ${!isAdmin ? `<button class="btn-remove" onclick="adminDeleteUser('${jsAttr(u.username)}')">Delete</button>` : ''}
    </td>
  </tr>`;
}

async function adminDeleteUser(username) {
  if (!confirm(`Delete user "${username}"? They will be signed out immediately.`)) return;
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    await adminLoadUsers();
  } catch (e) { alert(`Error: ${e.message}`); }
}

function adminEditUser(username) {
  const row = document.getElementById(`admin-user-row-${username}`);
  if (!row) return;
  const user        = { username };
  const linkedPlayer = state.players.find(p => {
    const allUsers = Array.from(document.querySelectorAll('#adminUsersBody tr')).map(r => r.id.replace('admin-user-row-', ''));
    return false; // We'll read from the API data instead via inline form
  });

  const playerOpts = [
    `<option value="">— No linked player —</option>`,
    ...state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`),
  ].join('');

  const roleOpts = `
    <option value="player">Player</option>
    <option value="admin">Admin</option>`;

  row.innerHTML = `
    <td class="td-name">${esc(username)}</td>
    <td>
      <select id="edit-role-${esc(username)}" style="font-size:.8rem;padding:.25rem .4rem;background:var(--card-2);color:var(--text);border:1.5px solid var(--border);border-radius:6px;font-family:inherit">
        ${roleOpts}
      </select>
    </td>
    <td>
      <select id="edit-player-${esc(username)}" style="font-size:.8rem;padding:.25rem .4rem;background:var(--card-2);color:var(--text);border:1.5px solid var(--border);border-radius:6px;font-family:inherit;max-width:160px">
        ${playerOpts}
      </select>
    </td>
    <td class="admin-actions" style="white-space:nowrap;display:flex;gap:.35rem;flex-wrap:wrap">
      <input type="password" id="edit-pw-${esc(username)}" placeholder="New password (optional)" style="font-size:.78rem;padding:.28rem .5rem;width:175px;background:var(--card-2);color:var(--text);border:1.5px solid var(--border);border-radius:6px;font-family:inherit;outline:none">
      <button class="btn-update" onclick="adminSaveUser('${jsAttr(username)}')">Save</button>
      <button class="btn-secondary" style="padding:.25rem .6rem;font-size:.75rem" onclick="adminLoadUsers()">Cancel</button>
    </td>`;

  // Pre-populate values by re-fetching users list
  fetch('/api/admin/users').then(r => r.json()).then(users => {
    const u = users.find(x => x.username === username);
    if (!u) return;
    const roleEl   = document.getElementById(`edit-role-${username}`);
    const playerEl = document.getElementById(`edit-player-${username}`);
    if (roleEl)   roleEl.value   = u.role;
    if (playerEl) playerEl.value = u.player_id || '';
  });
}

async function adminSaveUser(username) {
  const role     = document.getElementById(`edit-role-${username}`)?.value;
  const playerId = document.getElementById(`edit-player-${username}`)?.value || null;
  const password = document.getElementById(`edit-pw-${username}`)?.value || '';
  const body     = { role, playerId };
  if (password.trim()) body.password = password.trim();
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    await adminLoadUsers();
  } catch (e) { alert(`Error: ${e.message}`); }
}

async function adminCreateUser(e) {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role     = document.getElementById('newRole').value;
  const playerId = document.getElementById('newPlayerId').value || null;
  const errEl    = document.getElementById('adminCreateError');
  errEl.style.display = 'none';
  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role, playerId }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newRole').value     = 'player';
    document.getElementById('newPlayerId').value = '';
    await adminLoadUsers();
  } catch (err) {
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
  }
}

function adminRenderPlayerOpts() {
  const sel = document.getElementById('newPlayerId');
  if (!sel) return;
  sel.innerHTML = [
    '<option value="">— No linked player —</option>',
    ...state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`),
  ].join('');
}
