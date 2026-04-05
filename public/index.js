// ===== State =====
const STORAGE_KEY = 'ssh_servers';
const SESSION_KEY = 'nt_session';
const PAGE_SIZE = 9;
let servers = [];
let currentPage = 1;
let editingServerId = null;
let serverType = 'ssh'; // 'ssh' or 'sftp'
let session = null; // { username, password, encKey }
let loginTab = 'login';
let cloudServerIds = new Set(); // IDs of servers synced to cloud
let cloudServerMeta = []; // full metadata [{id, name, host, port, user}] from cloud

// ===== LocalStorage =====
function loadServers() {
  try { servers = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { servers = []; }
  render();
}

function persistServers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

// ===== Toast =====
function toast(msg, type) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ===== Session =====
function loadSession() {
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { session = null; }
  updateAccountUI();
}

function saveSession() {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
  updateAccountUI();
}

function updateAccountUI() {
  const area = document.getElementById('accountArea');
  const btn = document.getElementById('loginBtn');
  if (session) {
    area.style.display = 'flex';
    btn.style.display = 'none';
    document.getElementById('accountAvatar').textContent = session.username.charAt(0).toUpperCase();
    document.getElementById('accountName').textContent = session.username;
  } else {
    area.style.display = 'none';
    btn.style.display = '';
  }
}

// ===== Login Modal =====
function showLoginModal() {
  switchLoginTab('login');
  document.getElementById('authUser').value = '';
  document.getElementById('authPass').value = '';
  document.getElementById('authEncKey').value = '';
  document.getElementById('loginOverlay').classList.add('show');
  setTimeout(() => document.getElementById('authUser').focus(), 200);
}

function hideLoginModal() {
  document.getElementById('loginOverlay').classList.remove('show');
}

function switchLoginTab(tab) {
  loginTab = tab;
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginModalTitle').textContent = tab === 'login' ? '登录' : '注册';
  document.getElementById('authSubmitBtn').textContent = tab === 'login' ? '登录' : '注册';
}

async function authSubmit() {
  const username = document.getElementById('authUser').value.trim();
  const password = document.getElementById('authPass').value;
  const encKey = document.getElementById('authEncKey').value;
  if (!username || !password) { toast('请填写用户名和密码', 'error'); return; }
  if (!encKey) { toast('请填写加密密码', 'error'); return; }

  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  btn.textContent = '处理中...';

  try {
    const endpoint = loginTab === 'register' ? '/api/register' : '/api/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) { toast(data.error, 'error'); return; }

    session = { username, password, encKey };
    saveSession();
    hideLoginModal();
    toast(loginTab === 'register' ? '注册成功' : '登录成功', 'success');
    refreshCloudIds();
  } catch (e) {
    toast('网络错误: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = loginTab === 'login' ? '登录' : '注册';
  }
}

function logout() {
  session = null;
  cloudServerIds = new Set();
  cloudServerMeta = [];
  saveSession();
  render();
  renderCloudOnly();
  toast('已退出登录');
}

async function refreshCloudIds() {
  if (!session) return;
  try {
    const data = await apiPost('/api/sync/list', { username: session.username, password: session.password });
    if (data.success && data.servers) {
      cloudServerIds = new Set(data.servers.map(s => s.id));
      cloudServerMeta = data.servers;
      render();
      renderCloudOnly();
    }
  } catch {}
}

function syncIdsFromCache() {
  cloudServerIds = new Set(cloudServers.map(s => s.id));
  cloudServerMeta = cloudServers.map(s => ({ id: s.id, name: s.name, host: s.host, port: s.port, user: s.user }));
  render();
  renderCloudOnly();
}

function renderCloudOnly() {
  const section = document.getElementById('cloudSection');
  const grid = document.getElementById('cloudGrid');
  if (!session || cloudServerMeta.length === 0) {
    section.style.display = 'none';
    return;
  }
  const localIds = new Set(servers.map(s => s.id));
  const unsynced = cloudServerMeta.filter(s => !localIds.has(s.id));
  if (unsynced.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  document.getElementById('cloudCount').textContent = unsynced.length + ' 台服务器';
  grid.innerHTML = unsynced.map(s => `
    <div class="server-card fade-in" style="border-color: var(--border-light)">
      <div class="card-header">
        <div class="card-icon" style="opacity:0.6">
          <svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
          </svg>
        </div>
      </div>
      <div class="card-name">${esc(s.name)}</div>
      <div class="card-info">
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <code>${s.host ? esc(s.host + ':' + (s.port || 22)) : '未知'}</code>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${esc(s.user || 'root')}</span>
        </div>
      </div>
      <div class="card-footer">
        <button class="btn btn-outline btn-sm" onclick="syncDownloadById('${s.id}')" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          下载到本地
        </button>
      </div>
    </div>
  `).join('');
}

// ===== Client-side AES-GCM Encryption =====
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(plaintext, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  // Pack: salt(16) + iv(12) + ciphertext
  const buf = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  buf.set(salt, 0);
  buf.set(iv, salt.length);
  buf.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return btoa(String.fromCharCode(...buf));
}

async function decryptData(base64, password) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ciphertext = raw.slice(28);
  const key = await deriveKey(password, salt);
  const dec = new TextDecoder();
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return dec.decode(plainBuf);
}

// ===== Sync Modal =====
let cloudServers = []; // cached cloud list [{id, name, data(encrypted)}]
const SYNC_PAGE_SIZE = 8;
let syncLocalPage = 1;
let syncCloudPage = 1;
let syncUniqueOnly = false;

async function apiPost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

function showSyncModal() {
  if (!session) { toast('请先登录', 'error'); return; }
  syncLocalPage = 1;
  syncCloudPage = 1;
  document.getElementById('syncUniqueOnly').checked = syncUniqueOnly;
  document.getElementById('syncOverlay').classList.add('show');
  renderSyncLocal();
  fetchCloudList();
}

function hideSyncModal() {
  document.getElementById('syncOverlay').classList.remove('show');
}

function onSyncFilterChange() {
  syncUniqueOnly = document.getElementById('syncUniqueOnly').checked;
  syncLocalPage = 1;
  syncCloudPage = 1;
  renderSyncLocal();
  renderSyncCloud();
}

function getSyncFiltered(items, otherItems, idKey) {
  if (!syncUniqueOnly) return items;
  const otherIds = new Set(otherItems.map(s => s.id));
  return items.filter(s => !otherIds.has(s[idKey || 'id']));
}

function renderSyncPager(pagerId, currentPage, totalPages, onPageFn) {
  const pager = document.getElementById(pagerId);
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  const prevDisabled = currentPage <= 1 ? ' disabled' : '';
  const nextDisabled = currentPage >= totalPages ? ' disabled' : '';
  pager.innerHTML =
    '<button class="sync-pager-btn"' + prevDisabled + ' onclick="' + onPageFn + '(' + (currentPage - 1) + ')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>' +
    '</button>' +
    '<span class="sync-pager-info">' + currentPage + ' / ' + totalPages + '</span>' +
    '<button class="sync-pager-btn"' + nextDisabled + ' onclick="' + onPageFn + '(' + (currentPage + 1) + ')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>' +
    '</button>';
}

function goSyncLocalPage(p) { syncLocalPage = p; renderSyncLocal(); }
function goSyncCloudPage(p) { syncCloudPage = p; renderSyncCloud(); }

const svgServer = '<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="3" width="20" height="7" rx="2"/><circle cx="6" cy="6.5" r="1"/></svg>';

function renderSyncLocal() {
  const list = document.getElementById('syncLocalList');
  const filtered = getSyncFiltered(servers, cloudServers, 'id');
  document.getElementById('syncLocalCount').textContent = filtered.length + (filtered.length !== servers.length ? '/' + servers.length : '');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="sync-empty">' + (syncUniqueOnly ? '没有仅本地的项' : '本地暂无服务器') + '</div>';
    document.getElementById('syncLocalPager').innerHTML = '';
    return;
  }
  const totalPages = Math.ceil(filtered.length / SYNC_PAGE_SIZE);
  if (syncLocalPage > totalPages) syncLocalPage = totalPages;
  const start = (syncLocalPage - 1) * SYNC_PAGE_SIZE;
  const page = filtered.slice(start, start + SYNC_PAGE_SIZE);
  list.innerHTML = page.map(s =>
    '<div class="sync-item">' +
      '<div class="sync-item-icon">' + svgServer + '</div>' +
      '<div class="sync-item-info">' +
        '<span class="sync-item-name">' + esc(s.name) + '</span>' +
        '<span class="sync-item-meta">' + esc((s.username || 'root') + '@' + (s.host || '') + ':' + (s.port || 22)) + '</span>' +
      '</div>' +
      '<div class="sync-item-actions">' +
        '<button class="sync-item-btn upload" onclick="syncUploadOne(\'' + s.id + '\')" title="上传此项到云端">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>'
  ).join('');
  renderSyncPager('syncLocalPager', syncLocalPage, totalPages, 'goSyncLocalPage');
}

async function fetchCloudList() {
  const list = document.getElementById('syncCloudList');
  list.innerHTML = '<div class="sync-empty">加载中...</div>';
  document.getElementById('syncCloudPager').innerHTML = '';
  try {
    const data = await apiPost('/api/sync/download', { username: session.username, password: session.password });
    if (data.error) { list.innerHTML = '<div class="sync-empty">' + esc(data.error) + '</div>'; return; }
    cloudServers = data.servers || [];
    renderSyncCloud();
  } catch (e) {
    list.innerHTML = '<div class="sync-empty">加载失败</div>';
  }
}

function renderSyncCloud() {
  const list = document.getElementById('syncCloudList');
  const filtered = getSyncFiltered(cloudServers, servers, 'id');
  document.getElementById('syncCloudCount').textContent = filtered.length + (filtered.length !== cloudServers.length ? '/' + cloudServers.length : '');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="sync-empty">' + (syncUniqueOnly ? '没有仅云端的项' : '云端暂无数据') + '</div>';
    document.getElementById('syncCloudPager').innerHTML = '';
    return;
  }
  const totalPages = Math.ceil(filtered.length / SYNC_PAGE_SIZE);
  if (syncCloudPage > totalPages) syncCloudPage = totalPages;
  const start = (syncCloudPage - 1) * SYNC_PAGE_SIZE;
  const page = filtered.slice(start, start + SYNC_PAGE_SIZE);
  list.innerHTML = page.map(s => {
    const meta = s.host ? esc((s.user || 'root') + '@' + s.host + ':' + (s.port || 22)) : '重新上传以显示详情';
    return '<div class="sync-item">' +
      '<div class="sync-item-icon">' + svgServer + '</div>' +
      '<div class="sync-item-info">' +
        '<span class="sync-item-name">' + esc(s.name) + '</span>' +
        '<span class="sync-item-meta">' + meta + '</span>' +
      '</div>' +
      '<div class="sync-item-actions">' +
        '<button class="sync-item-btn download" onclick="syncDownloadOne(\'' + s.id + '\')" title="下载此项到本地">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        '</button>' +
        '<button class="sync-item-btn danger" onclick="syncDeleteCloud(\'' + s.id + '\')" title="从云端删除">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
  renderSyncPager('syncCloudPager', syncCloudPage, totalPages, 'goSyncCloudPage');
}

// Encrypt a single server object → { id, name, data }
async function encryptServer(server) {
  const plaintext = JSON.stringify(server);
  const encrypted = await encryptData(plaintext, session.encKey);
  return { id: server.id, name: server.name, host: server.host, port: server.port, user: server.username, data: encrypted };
}

// Decrypt a single cloud item → server object
async function decryptServer(item) {
  const plaintext = await decryptData(item.data, session.encKey);
  return JSON.parse(plaintext);
}

// Download single cloud server by ID (from cloud-only card)
async function syncDownloadById(id) {
  if (!session) { toast('请先登录', 'error'); return; }
  try {
    const data = await apiPost('/api/sync/download', { username: session.username, password: session.password });
    if (data.error) { toast('下载失败: ' + data.error, 'error'); return; }
    const item = (data.servers || []).find(s => s.id === id);
    if (!item) { toast('云端未找到该服务器', 'error'); return; }
    const server = await decryptServer(item);
    const idx = servers.findIndex(s => s.id === server.id);
    if (idx !== -1) servers[idx] = server;
    else servers.push(server);
    persistServers();
    render();
    renderCloudOnly();
    toast('已下载: ' + server.name, 'success');
  } catch (e) {
    toast('解密失败，请检查加密密码', 'error');
  }
}

// Upload single server
async function syncUploadOne(id) {
  const server = servers.find(s => s.id === id);
  if (!server) return;
  try {
    const enc = await encryptServer(server);
    // Merge into cloud list
    const idx = cloudServers.findIndex(s => s.id === id);
    if (idx !== -1) cloudServers[idx] = enc;
    else cloudServers.push(enc);
    const data = await apiPost('/api/sync/upload', { username: session.username, password: session.password, servers: cloudServers });
    if (data.error) { toast('上传失败: ' + data.error, 'error'); return; }
    toast('已上传: ' + server.name, 'success');
    renderSyncCloud();
    syncIdsFromCache();
  } catch (e) {
    toast('上传失败: ' + e.message, 'error');
  }
}

// Download single server
async function syncDownloadOne(id) {
  const item = cloudServers.find(s => s.id === id);
  if (!item) return;
  try {
    const server = await decryptServer(item);
    const idx = servers.findIndex(s => s.id === server.id);
    if (idx !== -1) servers[idx] = server;
    else servers.push(server);
    persistServers();
    render();
    renderSyncLocal();
    renderCloudOnly();
    toast('已下载: ' + server.name, 'success');
  } catch (e) {
    toast('解密失败，请检查加密密码', 'error');
  }
}

// Delete single from cloud
async function syncDeleteCloud(id) {
  const item = cloudServers.find(s => s.id === id);
  if (!item || !confirm('确定从云端删除 "' + item.name + '"？')) return;
  cloudServers = cloudServers.filter(s => s.id !== id);
  try {
    const data = await apiPost('/api/sync/upload', { username: session.username, password: session.password, servers: cloudServers });
    if (data.error) { toast('删除失败: ' + data.error, 'error'); return; }
    toast('已从云端删除: ' + item.name, 'success');
    renderSyncCloud();
    syncIdsFromCache();
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

// Upload all local to cloud
async function syncUploadAll() {
  if (servers.length === 0) { toast('本地无数据可上传', 'error'); return; }
  if (!confirm('将全部 ' + servers.length + ' 台本地服务器上传到云端（覆盖同ID项）？')) return;
  try {
    const encrypted = await Promise.all(servers.map(s => encryptServer(s)));
    // Merge: update existing by id, add new ones
    for (const enc of encrypted) {
      const idx = cloudServers.findIndex(s => s.id === enc.id);
      if (idx !== -1) cloudServers[idx] = enc;
      else cloudServers.push(enc);
    }
    const data = await apiPost('/api/sync/upload', { username: session.username, password: session.password, servers: cloudServers });
    if (data.error) { toast('上传失败: ' + data.error, 'error'); return; }
    toast('已上传 ' + servers.length + ' 台服务器到云端', 'success');
    renderSyncCloud();
    syncIdsFromCache();
  } catch (e) {
    toast('上传失败: ' + e.message, 'error');
  }
}

// Download all cloud to local
async function syncDownloadAll() {
  if (cloudServers.length === 0) { toast('云端无数据可下载', 'error'); return; }
  if (!confirm('将全部 ' + cloudServers.length + ' 台云端服务器下载到本地（覆盖同ID项）？')) return;
  try {
    let count = 0;
    for (const item of cloudServers) {
      try {
        const server = await decryptServer(item);
        const idx = servers.findIndex(s => s.id === server.id);
        if (idx !== -1) servers[idx] = server;
        else servers.push(server);
        count++;
      } catch { /* skip items that fail to decrypt */ }
    }
    if (count === 0) { toast('解密失败，请检查加密密码', 'error'); return; }
    persistServers();
    render();
    renderSyncLocal();
    renderCloudOnly();
    toast('已下载 ' + count + ' 台服务器到本地', 'success');
  } catch (e) {
    toast('下载失败: ' + e.message, 'error');
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ===== Open Terminal in New Window =====
function openTerminal(id) {
  window.open('/terminal.html?id=' + encodeURIComponent(id), '_blank');
}

function openSftp(id) {
  window.open('/sftp.html?id=' + encodeURIComponent(id), '_blank');
}

function openVnc(id) {
  window.open('/vnc.html?id=' + encodeURIComponent(id), '_blank');
}

function openRdp(id) {
  window.open('/rdp.html?id=' + encodeURIComponent(id), '_blank');
}

function openFtp(id) {
  window.open('/ftp.html?id=' + encodeURIComponent(id), '_blank');
}

function quickConnect() {
  const raw = document.getElementById('quickHost').value.trim();
  const pwd = document.getElementById('quickPwd').value;
  if (!raw) return;

  let user = 'root', host = '', port = 22, parts = raw;
  if (parts.includes('@')) { [user, parts] = parts.split('@'); }
  if (parts.includes(':')) { const [h, p] = parts.split(':'); host = h; port = parseInt(p) || 22; }
  else { host = parts; }
  if (!host) return;

  const url = '/terminal.html?host=' + encodeURIComponent(host)
    + '&port=' + port
    + '&user=' + encodeURIComponent(user)
    + '&pass=' + encodeURIComponent(pwd);
  window.open(url, '_blank');
}

// ===== Search =====
function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ===== Search Modal =====
let globalSearchQuery = '';
let searchTab = 'all';

function showSearchModal() {
  document.getElementById('searchOverlay').classList.add('show');
  document.getElementById('globalSearchInput').value = '';
  globalSearchQuery = '';
  document.getElementById('globalSearchClear').style.display = 'none';
  searchTab = 'all';
  updateSearchTabs();
  renderSearchResults();
  setTimeout(() => document.getElementById('globalSearchInput').focus(), 100);
}

function hideSearchModal() {
  document.getElementById('searchOverlay').classList.remove('show');
}

function switchSearchTab(tab) {
  searchTab = tab;
  updateSearchTabs();
  renderSearchResults();
}

function updateSearchTabs() {
  ['All', 'Local', 'Cloud'].forEach(t => {
    const btn = document.getElementById('sTab' + t);
    btn.classList.toggle('active', searchTab === t.toLowerCase());
  });
}

function onGlobalSearch() {
  globalSearchQuery = document.getElementById('globalSearchInput').value.trim();
  document.getElementById('globalSearchClear').style.display = globalSearchQuery ? '' : 'none';
  renderSearchResults();
}

function clearGlobalSearch() {
  document.getElementById('globalSearchInput').value = '';
  globalSearchQuery = '';
  document.getElementById('globalSearchClear').style.display = 'none';
  renderSearchResults();
  document.getElementById('globalSearchInput').focus();
}

function getSearchItems() {
  const localItems = servers.map(s => ({
    id: s.id, name: s.name, host: s.host, port: s.port,
    user: s.username || 'root', source: 'local', type: s.type || 'ssh'
  }));
  const localIds = new Set(servers.map(s => s.id));
  const cloudItems = cloudServerMeta
    .filter(s => !localIds.has(s.id))
    .map(s => ({
      id: s.id, name: s.name, host: s.host, port: s.port,
      user: s.user || 'root', source: 'cloud'
    }));

  let all = [...localItems, ...cloudItems];

  if (globalSearchQuery) {
    all = all.filter(s => {
      const fields = [s.name || '', s.host || '', s.user || '', String(s.port || 22)].join(' ');
      return fuzzyMatch(globalSearchQuery, fields);
    });
  }

  const localFiltered = all.filter(s => s.source === 'local');
  const cloudFiltered = all.filter(s => s.source === 'cloud');

  document.getElementById('sCountAll').textContent = all.length;
  document.getElementById('sCountLocal').textContent = localFiltered.length;
  document.getElementById('sCountCloud').textContent = cloudFiltered.length;

  if (searchTab === 'local') return localFiltered;
  if (searchTab === 'cloud') return cloudFiltered;
  return all;
}

function renderSearchResults() {
  const container = document.getElementById('searchResults');
  const items = getSearchItems();

  if (items.length === 0) {
    container.innerHTML = '<div class="search-no-results">' +
      (globalSearchQuery ? '未找到匹配的服务器' : (searchTab === 'cloud' ? '云端暂无数据' : '暂无服务器')) +
      '</div>';
    return;
  }

  container.innerHTML = items.map(s => {
    const meta = s.host ? esc((s.user || 'root') + '@' + s.host + ':' + (s.port || 22)) : '';
    const badge = s.source === 'local'
      ? '<span class="source-badge local">本地</span>'
      : '<span class="source-badge cloud">云端</span>';
    let actions;
    if (s.source === 'cloud') {
      actions = '<button class="btn btn-outline btn-sm" onclick="syncDownloadById(\'' + s.id + '\');hideSearchModal()" style="padding:5px 12px;font-size:11px">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          '下载</button>';
    } else if (s.type === 'ftp') {
      actions = '<button class="btn btn-connect btn-sm" onclick="openFtp(\'' + s.id + '\');hideSearchModal()" style="padding:5px 12px;font-size:11px">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 13 12 17"/><polyline points="9 15 12 12 15 15"/></svg>' +
          '文件</button>';
    } else if (s.type === 'rdp') {
      actions = '<button class="btn btn-connect btn-sm" onclick="openRdp(\'' + s.id + '\');hideSearchModal()" style="padding:5px 12px;font-size:11px">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>' +
          '桌面</button>';
    } else if (s.type === 'vnc') {
      actions = '<button class="btn btn-connect btn-sm" onclick="openVnc(\'' + s.id + '\');hideSearchModal()" style="padding:5px 12px;font-size:11px">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
          '桌面</button>';
    } else if (s.type === 'sftp') {
      actions = '<button class="btn btn-connect btn-sm" onclick="openSftp(\'' + s.id + '\');hideSearchModal()" style="padding:5px 12px;font-size:11px">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
          '文件</button>';
    } else {
      actions = '<button class="btn btn-connect btn-sm" onclick="openTerminal(\'' + s.id + '\');hideSearchModal()" style="padding:5px 12px;font-size:11px">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 15L11.5 10.5L7 6"/><path d="M13 18h6"/></svg>' +
          '连接</button>';
    }
    return '<div class="search-result-item">' +
      '<div class="sync-item-icon">' + svgServer + '</div>' +
      '<div class="search-result-info">' +
        '<div class="search-result-name">' + esc(s.name) + ' ' + badge + '</div>' +
        (meta ? '<div class="search-result-meta">' + meta + '</div>' : '') +
      '</div>' +
      '<div class="search-result-actions">' + actions + '</div>' +
    '</div>';
  }).join('');
}

// ===== Render =====
function render() {
  renderGrid();
  renderPagination();
  document.getElementById('serverCount').textContent = servers.length + ' 台服务器';
}

function renderGrid() {
  const grid = document.getElementById('serverGrid');
  if (servers.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
          <rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/>
          <circle cx="6" cy="6.5" r="1"/><circle cx="6" cy="17.5" r="1"/>
        </svg>
        <h3>暂无服务器</h3>
        <p>点击右上角「添加服务器」按钮<br>或使用快速连接开始</p>
      </div>`;
    return;
  }

  const totalPages = Math.ceil(servers.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageServers = servers.slice(start, start + PAGE_SIZE);

  grid.innerHTML = pageServers.map(s => {
    const t = s.type || 'ssh';
    let cardIcon, typeBadge = '', footerBtns, infoRows;
    const svgServerIcon = `<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round">
            <rect x="2" y="3" width="20" height="7" rx="2"/><circle cx="6" cy="6.5" r="1"/>
            <line x1="14" y1="6.5" x2="18" y2="6.5"/>
            <rect x="2" y="14" width="20" height="7" rx="2"/><circle cx="6" cy="17.5" r="1"/>
            <line x1="14" y1="17.5" x2="18" y2="17.5"/></svg>`;
    const svgFolderIcon = `<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const svgMonitorIcon = `<svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

    if (t === 'ftp') {
      cardIcon = svgFolderIcon;
      typeBadge = '<span style="font-size:10px;font-weight:600;color:#66bb6a;background:rgba(102,187,106,0.12);padding:1px 6px;border-radius:4px;margin-left:6px">FTP</span>';
      footerBtns = `<button class="btn btn-connect btn-sm" onclick="openFtp('${s.id}')" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 13 12 17"/><polyline points="9 15 12 12 15 15"/></svg>
          打开文件</button>`;
      infoRows = `
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <code>${esc(s.host)}:${s.port}</code>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${esc(s.username || 'anonymous')}</span>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>${s.secure === 'true' || s.secure === 'implicit' ? 'FTPS' : 'FTP'}</span>
        </div>`;
    } else if (t === 'rdp') {
      cardIcon = svgMonitorIcon;
      typeBadge = '<span style="font-size:10px;font-weight:600;color:#4fc3f7;background:rgba(79,195,247,0.12);padding:1px 6px;border-radius:4px;margin-left:6px">RDP</span>';
      footerBtns = `<button class="btn btn-connect btn-sm" onclick="openRdp('${s.id}')" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
          远程桌面</button>`;
      infoRows = `
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <code>${esc(s.host)}:${s.port}</code>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${esc(s.username || 'Administrator')}</span>
        </div>`;
    } else if (t === 'vnc') {
      cardIcon = svgMonitorIcon;
      typeBadge = '<span style="font-size:10px;font-weight:600;color:var(--warning);background:rgba(255,217,61,0.12);padding:1px 6px;border-radius:4px;margin-left:6px">VNC</span>';
      footerBtns = `<button class="btn btn-connect btn-sm" onclick="openVnc('${s.id}')" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          远程桌面</button>`;
      infoRows = `
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <code>${esc(s.host)}:${s.port}</code>
        </div>`;
    } else if (t === 'sftp') {
      cardIcon = svgFolderIcon;
      typeBadge = '<span style="font-size:10px;font-weight:600;color:var(--accent-light);background:rgba(108,92,231,0.12);padding:1px 6px;border-radius:4px;margin-left:6px">SFTP</span>';
      footerBtns = `<button class="btn btn-connect btn-sm" onclick="openSftp('${s.id}')" style="flex:1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          打开文件</button>`;
      infoRows = `
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <code>${esc(s.host)}:${s.port}</code>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${esc(s.username || 'root')}</span>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>${s.privateKey ? '密钥认证' : '密码认证'}</span>
        </div>`;
    } else {
      cardIcon = svgServerIcon;
      footerBtns = `<button class="btn btn-connect btn-sm" onclick="openTerminal('${s.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 15L11.5 10.5L7 6"/><path d="M13 18h6"/></svg>
          终端</button>
        <button class="btn btn-outline btn-sm" onclick="openSftp('${s.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          文件</button>`;
      infoRows = `
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <code>${esc(s.host)}:${s.port}</code>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>${esc(s.username || 'root')}</span>
        </div>
        <div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>${s.privateKey ? '密钥认证' : '密码认证'}</span>
        </div>`;
    }
    const syncRow = session ? `<div class="card-info-row">
          <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
          <span class="sync-status ${cloudServerIds.has(s.id) ? 'synced' : 'unsynced'}">${cloudServerIds.has(s.id) ? '已同步' : '未同步'}</span>
        </div>` : '';
    return `
    <div class="server-card fade-in">
      <div class="card-header">
        <div class="card-icon">${cardIcon}</div>
        <div class="card-actions">
          <button class="icon-btn" onclick="editServer('${s.id}')" title="编辑">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" onclick="deleteServer('${s.id}')" title="删除">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="card-name">${esc(s.name)}${typeBadge}</div>
      <div class="card-info">${infoRows}${syncRow}</div>
      <div class="card-footer">${footerBtns}</div>
    </div>`;
  }).join('');
}

function renderPagination() {
  const el = document.getElementById('pagination');
  const totalPages = Math.ceil(servers.length / PAGE_SIZE);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  html += `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
  </button>`;

  const range = getPageRange(currentPage, totalPages);
  for (const p of range) {
    if (p === '...') {
      html += `<span class="page-info">...</span>`;
    } else {
      html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
    }
  }

  html += `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
  </button>`;

  el.innerHTML = html;
}

function getPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 4, '...', total];
  if (current >= total - 2) return [1, '...', total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

function goPage(page) {
  const totalPages = Math.ceil(servers.length / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Modal =====
function showModal(editId) {
  editingServerId = editId || null;
  document.getElementById('modalTitle').textContent = editId ? '编辑服务器' : '添加服务器';

  const sidebarBtns = document.querySelectorAll('#typeSidebar .modal-sidebar-item');
  // Clear all fields
  document.getElementById('formName').value = '';
  document.getElementById('formHost').value = '';
  document.getElementById('formPort').value = 22;
  document.getElementById('formUser').value = '';
  document.getElementById('formPassword').value = '';
  document.getElementById('formKey').value = '';
  document.getElementById('formVncName').value = '';
  document.getElementById('formVncHost').value = '';
  document.getElementById('formVncPort').value = 5900;
  document.getElementById('formVncPassword').value = '';
  document.getElementById('formRdpName').value = '';
  document.getElementById('formRdpHost').value = '';
  document.getElementById('formRdpPort').value = 3389;
  document.getElementById('formRdpUser').value = '';
  document.getElementById('formRdpPassword').value = '';
  document.getElementById('formRdpDomain').value = '';
  document.getElementById('formFtpName').value = '';
  document.getElementById('formFtpHost').value = '';
  document.getElementById('formFtpPort').value = 21;
  document.getElementById('formFtpUser').value = '';
  document.getElementById('formFtpPassword').value = '';
  document.getElementById('formFtpSecure').value = 'false';

  if (editId) {
    const s = servers.find(x => x.id === editId);
    if (s) {
      const t = s.type || 'ssh';
      const idx = {ssh:0, sftp:1, vnc:2, rdp:3, ftp:4}[t] || 0;
      setServerType(t, sidebarBtns[idx]);
      if (t === 'ftp') {
        document.getElementById('formFtpName').value = s.name || '';
        document.getElementById('formFtpHost').value = s.host || '';
        document.getElementById('formFtpPort').value = s.port || 21;
        document.getElementById('formFtpUser').value = s.username || '';
        document.getElementById('formFtpPassword').value = s.password || '';
        document.getElementById('formFtpSecure').value = s.secure || 'false';
      } else if (t === 'rdp') {
        document.getElementById('formRdpName').value = s.name || '';
        document.getElementById('formRdpHost').value = s.host || '';
        document.getElementById('formRdpPort').value = s.port || 3389;
        document.getElementById('formRdpUser').value = s.username || '';
        document.getElementById('formRdpPassword').value = s.password || '';
        document.getElementById('formRdpDomain').value = s.domain || '';
      } else if (t === 'vnc') {
        document.getElementById('formVncName').value = s.name || '';
        document.getElementById('formVncHost').value = s.host || '';
        document.getElementById('formVncPort').value = s.port || 5900;
        document.getElementById('formVncPassword').value = s.password || '';
      } else {
        document.getElementById('formName').value = s.name || '';
        document.getElementById('formHost').value = s.host || '';
        document.getElementById('formPort').value = s.port || 22;
        document.getElementById('formUser').value = s.username || '';
        document.getElementById('formPassword').value = s.password || '';
        document.getElementById('formKey').value = s.privateKey || '';
        if (s.privateKey) {
          setAuthType('key', document.querySelectorAll('.auth-toggle button')[1]);
        } else {
          setAuthType('password', document.querySelectorAll('.auth-toggle button')[0]);
        }
      }
    }
  } else {
    setServerType('ssh', sidebarBtns[0]);
    setAuthType('password', document.querySelectorAll('.auth-toggle button')[0]);
  }
  document.getElementById('modalOverlay').classList.add('show');
}

function hideModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  editingServerId = null;
}

function setServerType(type, btn) {
  serverType = type;
  document.querySelectorAll('#typeSidebar .modal-sidebar-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('sshFields').style.display = (type === 'ssh' || type === 'sftp') ? '' : 'none';
  document.getElementById('vncFields').style.display = type === 'vnc' ? '' : 'none';
  document.getElementById('rdpFields').style.display = type === 'rdp' ? '' : 'none';
  document.getElementById('ftpFields').style.display = type === 'ftp' ? '' : 'none';
}

function setAuthType(type, btn) {
  document.querySelectorAll('.auth-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('authPassword').style.display = type === 'password' ? '' : 'none';
  document.getElementById('authKey').style.display = type === 'key' ? '' : 'none';
}

function saveServer() {
  let payload;
  if (serverType === 'ftp') {
    payload = {
      type: 'ftp',
      name: document.getElementById('formFtpName').value.trim(),
      host: document.getElementById('formFtpHost').value.trim(),
      port: parseInt(document.getElementById('formFtpPort').value) || 21,
      username: document.getElementById('formFtpUser').value.trim() || 'anonymous',
      password: document.getElementById('formFtpPassword').value,
      secure: document.getElementById('formFtpSecure').value,
    };
  } else if (serverType === 'rdp') {
    payload = {
      type: 'rdp',
      name: document.getElementById('formRdpName').value.trim(),
      host: document.getElementById('formRdpHost').value.trim(),
      port: parseInt(document.getElementById('formRdpPort').value) || 3389,
      username: document.getElementById('formRdpUser').value.trim() || 'Administrator',
      password: document.getElementById('formRdpPassword').value,
      domain: document.getElementById('formRdpDomain').value.trim(),
    };
  } else if (serverType === 'vnc') {
    payload = {
      type: 'vnc',
      name: document.getElementById('formVncName').value.trim(),
      host: document.getElementById('formVncHost').value.trim(),
      port: parseInt(document.getElementById('formVncPort').value) || 5900,
      password: document.getElementById('formVncPassword').value,
    };
  } else {
    payload = {
      type: serverType,
      name: document.getElementById('formName').value.trim(),
      host: document.getElementById('formHost').value.trim(),
      port: parseInt(document.getElementById('formPort').value) || 22,
      username: document.getElementById('formUser').value.trim() || 'root',
      password: document.getElementById('formPassword').value,
      privateKey: document.getElementById('formKey').value,
    };
  }
  if (!payload.host) { alert('请输入主机地址'); return; }
  if (!payload.name) payload.name = payload.host;

  if (editingServerId) {
    const idx = servers.findIndex(s => s.id === editingServerId);
    if (idx !== -1) servers[idx] = { ...servers[idx], ...payload };
  } else {
    servers.push({ id: genId(), ...payload, createdAt: new Date().toISOString() });
  }
  persistServers();
  hideModal();
  render();
  renderCloudOnly();
}

function editServer(id) { showModal(id); }

function deleteServer(id) {
  if (!confirm('确定删除此服务器记录？')) return;
  servers = servers.filter(s => s.id !== id);
  persistServers();
  render();
  renderCloudOnly();
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Enter key on quick connect
document.getElementById('quickHost').addEventListener('keydown', e => { if (e.key === 'Enter') quickConnect(); });
document.getElementById('quickPwd').addEventListener('keydown', e => { if (e.key === 'Enter') quickConnect(); });

// Close modal on overlay click / Escape
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) hideModal(); });
document.getElementById('loginOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) hideLoginModal(); });
document.getElementById('syncOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) hideSyncModal(); });
document.getElementById('searchOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) hideSearchModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('searchOverlay').classList.contains('show')) hideSearchModal();
    else if (document.getElementById('syncOverlay').classList.contains('show')) hideSyncModal();
    else if (document.getElementById('loginOverlay').classList.contains('show')) hideLoginModal();
    else hideModal();
  }
});

// Enter key on auth fields
document.getElementById('authUser').addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });
document.getElementById('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });
document.getElementById('authEncKey').addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });

// ===== OIDC =====
async function initOidc() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.oidc) {
      document.getElementById('oidcSection').style.display = '';
      document.getElementById('oidcBtnLabel').textContent = cfg.oidcLabel || 'OpenID 登录';
    }
  } catch {}
}

function oidcLogin() {
  const encKey = document.getElementById('authEncKey').value;
  if (!encKey) { toast('请先填写加密密码再进行 OpenID 登录', 'error'); return; }
  // Save encKey temporarily so we can recover it after redirect
  sessionStorage.setItem('nt_oidc_enckey', encKey);
  window.location.href = '/api/oidc/auth?encKey=' + encodeURIComponent(encKey);
}

async function claimOidcToken() {
  const params = new URLSearchParams(location.search);
  const token = params.get('oidc_token');
  if (!token) return;
  // Clean URL
  history.replaceState(null, '', '/');

  const encKey = sessionStorage.getItem('nt_oidc_enckey') || '';
  sessionStorage.removeItem('nt_oidc_enckey');

  if (!encKey) {
    toast('加密密码丢失，请重新登录', 'error');
    return;
  }

  try {
    const res = await fetch('/api/oidc/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (data.error) { toast('OIDC 登录失败: ' + data.error, 'error'); return; }

    // OIDC users don't have a normal password — use token as password placeholder for sync APIs
    // We store username + a dummy password (the server auto-registered with random pwd)
    session = { username: data.username, password: '__oidc__', encKey, oidc: true };
    saveSession();
    toast('OpenID 登录成功', 'success');
  } catch (e) {
    toast('OIDC 登录失败: ' + e.message, 'error');
  }
}

// Init
claimOidcToken().then(() => {
  loadSession();
  loadServers();
  refreshCloudIds();
  initOidc();
});
