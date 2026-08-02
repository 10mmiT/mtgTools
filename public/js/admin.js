// ── Admin Panel ───────────────────────────────────────────────────────────────

async function initAdmin() {
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
    <td class="admin-req-date">${date}</td>
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
      <div class="admin-inline-form">
        <select id="req-role-${id}" class="admin-inline-ctl">
          <option value="player">Player</option>
          <option value="admin">Admin</option>
        </select>
        <select id="req-player-${id}" class="admin-inline-ctl">
          ${playerOpts}
        </select>
        <button class="btn-update" onclick="adminConfirmApprove(${id})">Confirm</button>
        <button class="btn-secondary btn-sm" onclick="adminLoadRequests()">Cancel</button>
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
  const playerLabel  = linkedPlayer ? esc(linkedPlayer.name) : '<span style="color:var(--text-muted)">—</span>';
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
      <select id="edit-role-${esc(username)}" class="admin-inline-ctl">
        ${roleOpts}
      </select>
    </td>
    <td>
      <select id="edit-player-${esc(username)}" class="admin-inline-ctl">
        ${playerOpts}
      </select>
    </td>
    <td class="admin-actions admin-actions-edit">
      <input type="password" id="edit-pw-${esc(username)}" class="admin-inline-ctl admin-inline-pw" placeholder="New password (optional)">
      <button class="btn-update" onclick="adminSaveUser('${jsAttr(username)}')">Save</button>
      <button class="btn-secondary btn-sm" onclick="adminLoadUsers()">Cancel</button>
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
