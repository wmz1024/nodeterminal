// ===== State =====
const STORAGE_KEY = 'ssh_servers';
const SETTINGS_KEY = 'nt_settings';
let ws = null, term = null, fitAddon = null;
let sftpReady = false, currentPath = null, fileItems = [];
let filePanelVisible = false;
let reqIdCounter = 0;
const pendingReqs = {};

// ===== Settings =====
let settings = { autoFollow: false, showHidden: true, autoOpen: false };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY))); } catch {}
  document.getElementById('settingAutoFollow').checked = settings.autoFollow;
  document.getElementById('settingShowHidden').checked = settings.showHidden;
  document.getElementById('settingAutoOpen').checked = settings.autoOpen;
}
function saveSetting(key, val) {
  settings[key] = val;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function showSettings() { document.getElementById('settingsOverlay').classList.add('show'); }
function hideSettings() { document.getElementById('settingsOverlay').classList.remove('show'); }

// ===== Toast =====
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ===== Connection Info =====
const params = new URLSearchParams(location.search);
const serverId = params.get('id');
let connInfo = null;
if (serverId) {
  try {
    const servers = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const s = servers.find(x => x.id === serverId);
    if (s) connInfo = { host: s.host, port: s.port, username: s.username, password: s.password, privateKey: s.privateKey, name: s.name };
  } catch {}
}
if (!connInfo && params.get('host')) {
  connInfo = { host: params.get('host'), port: parseInt(params.get('port') || '22'), username: params.get('user') || 'root', password: params.get('pass') || '', privateKey: params.get('key') || '', name: (params.get('user') || 'root') + '@' + params.get('host') };
}
if (!connInfo) {
  document.getElementById('topbarLabel').textContent = '缺少连接参数';
  document.getElementById('connStatusText').textContent = '错误';
} else {
  document.title = connInfo.name + ' - NodeTerminal';
  document.getElementById('topbarLabel').textContent = (connInfo.username || 'root') + '@' + connInfo.host + ':' + (connInfo.port || 22);
}

// ===== Terminal =====
function initTerminal() {
  const isMobile = window.innerWidth <= 768;
  term = new Terminal({
    cursorBlink: true,
    fontSize: isMobile ? 12 : 14,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Consolas', monospace",
    theme: {
      background: '#05060f', foreground: '#c8cddf', cursor: '#a29bfe', cursorAccent: '#05060f',
      selectionBackground: 'rgba(108, 92, 231, 0.3)', selectionForeground: '#eef0ff',
      black: '#1c2038', brightBlack: '#444a6b', red: '#ff6b6b', brightRed: '#ff8787',
      green: '#00e676', brightGreen: '#69f0ae', yellow: '#ffd93d', brightYellow: '#ffe066',
      blue: '#6c5ce7', brightBlue: '#a29bfe', magenta: '#d63384', brightMagenta: '#e685b5',
      cyan: '#00bcd4', brightCyan: '#4dd0e1', white: '#c8cddf', brightWhite: '#eef0ff',
    },
    allowProposedApi: true, scrollback: 5000,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(document.getElementById('terminal'));
  setTimeout(() => fitAddon.fit(), 50);
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }));
      scheduleAutoFollow();
    }
  });
}

// ===== Resize =====
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (fitAddon && term) {
      fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }
  }, 100);
});

// ===== WebSocket =====
function startConnection() {
  if (!connInfo) return;
  initTerminal();
  term.writeln('\x1b[38;2;108;92;231m\u25CF 正在连接 ' + connInfo.username + '@' + connInfo.host + ':' + connInfo.port + ' ...\x1b[0m');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'connect', host: connInfo.host, port: parseInt(connInfo.port),
      username: connInfo.username, password: connInfo.password || '',
      privateKey: connInfo.privateKey || '', cols: term.cols, rows: term.rows,
    }));
  };
  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { term.write(event.data); return; }

    if (data.type === 'status') {
      if (data.message === 'connected') setConnected(true);
      else if (data.message === 'disconnected') {
        setConnected(false);
        term.writeln('\r\n\x1b[38;2;255;217;61m\u25CF 连接已断开\x1b[0m');
      }
    } else if (data.type === 'error') {
      term.writeln('\r\n\x1b[38;2;255;107;107m\u25CF 错误: ' + data.message + '\x1b[0m');
      setConnected(false);
    } else if (data.type === 'sftp-ready') {
      sftpReady = true;
      document.getElementById('fpStatusText').textContent = 'SFTP 就绪';
      if (settings.autoOpen) { showFilePanel(); }
      // Sync to shell's current directory instead of root
      ws.send(JSON.stringify({ type: 'sftp-pwd' }));
    } else if (data.type === 'sftp-pwd-result') {
      if (!data.error && data.path) { navigateTo(data.path); }
    } else if (data.reqId && pendingReqs[data.reqId]) {
      pendingReqs[data.reqId](data);
      delete pendingReqs[data.reqId];
    } else if (data.type === 'sftp-list-result') {
      handleListResult(data);
    }
  };
  ws.onclose = () => setConnected(false);
  ws.onerror = () => {
    term.writeln('\r\n\x1b[38;2;255;107;107m\u25CF WebSocket 连接失败\x1b[0m');
    setConnected(false);
  };
}

function wsSend(obj, cb) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const id = ++reqIdCounter + '';
  obj.reqId = id;
  if (cb) pendingReqs[id] = cb;
  ws.send(JSON.stringify(obj));
}

function disconnect() {
  if (ws) { ws.close(); ws = null; }
  setConnected(false);
  if (term) term.writeln('\r\n\x1b[38;2;255;217;61m\u25CF 已手动断开\x1b[0m');
}

function setConnected(status) {
  const badge = document.getElementById('connBadge');
  const text = document.getElementById('connStatusText');
  const btn = document.getElementById('disconnectBtn');
  badge.className = status ? 'conn-badge connected' : 'conn-badge';
  text.textContent = status ? '已连接' : '未连接';
  btn.style.display = status ? '' : 'none';
  if (!status) { sftpReady = false; }
}

// ===== File Panel Toggle =====
function toggleFilePanel() {
  filePanelVisible ? hideFilePanel() : showFilePanel();
}
function showFilePanel() {
  filePanelVisible = true;
  const fp = document.getElementById('filePanel');
  const isMobile = window.innerWidth <= 768;
  fp.classList.remove('hidden');
  if (isMobile) fp.classList.add('mobile-open');
  document.getElementById('btnFiles').classList.add('active');
  setTimeout(() => { if (fitAddon && term) fitAddon.fit(); }, 280);
}
function hideFilePanel() {
  filePanelVisible = false;
  const fp = document.getElementById('filePanel');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) fp.classList.remove('mobile-open');
  fp.classList.add('hidden');
  document.getElementById('btnFiles').classList.remove('active');
  setTimeout(() => { if (fitAddon && term) fitAddon.fit(); }, 280);
}

// ===== Auto Follow =====
let autoFollowTimer = null;
function scheduleAutoFollow() {
  if (!settings.autoFollow || !sftpReady || !filePanelVisible) return;
  clearTimeout(autoFollowTimer);
  autoFollowTimer = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sftp-pwd' }));
    }
  }, 800);
}

function syncTerminalDir() {
  if (!sftpReady) { toast('SFTP 未就绪', 'error'); return; }
  ws.send(JSON.stringify({ type: 'sftp-pwd' }));
  toast('正在同步终端目录...');
}

// ===== SFTP Operations =====
function listDir(dirPath) {
  if (!sftpReady) return;
  document.getElementById('fpList').innerHTML = '<div class="fp-loading">加载中</div><div class="fp-dropzone" id="fpDropzone">拖拽文件到此上传</div>';
  setupDropZone();
  wsSend({ type: 'sftp-list', path: dirPath }, (data) => handleListResult(data));
}

function handleListResult(data) {
  if (data.error) {
    document.getElementById('fpList').innerHTML = '<div class="fp-empty" style="color:var(--danger)">错误: ' + esc(data.error) + '</div><div class="fp-dropzone" id="fpDropzone">拖拽文件到此上传</div>';
    setupDropZone();
    return;
  }
  currentPath = data.path || '/';
  fileItems = data.items || [];

  // Filter hidden files
  let items = fileItems;
  if (!settings.showHidden) items = items.filter(f => !f.name.startsWith('.'));

  // Sort: dirs first, then by name
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  renderBreadcrumb();
  renderFileList(items);
  document.getElementById('fpStatusText').textContent = currentPath;
  document.getElementById('fpItemCount').textContent = items.length + ' 项';
}

function navigateTo(dirPath) {
  if (dirPath === currentPath) return;
  listDir(dirPath);
}

function renderBreadcrumb() {
  const el = document.getElementById('fpBreadcrumb');
  const parts = currentPath.split('/').filter(Boolean);
  let html = '<span class="fp-crumb' + (parts.length === 0 ? ' current' : '') + '" onclick="navigateTo(\'/\')">/</span>';
  let path = '';
  parts.forEach((p, i) => {
    path += '/' + p;
    const isLast = i === parts.length - 1;
    const cp = path;
    html += '<span class="fp-sep">/</span>';
    html += '<span class="fp-crumb' + (isLast ? ' current' : '') + '" onclick="navigateTo(\'' + esc(cp) + '\')">' + esc(p) + '</span>';
  });
  el.innerHTML = html;
  el.scrollLeft = el.scrollWidth;
}

function renderFileList(items) {
  const list = document.getElementById('fpList');
  if (items.length === 0) {
    list.innerHTML = '<div class="fp-empty">空目录</div><div class="fp-dropzone" id="fpDropzone">拖拽文件到此上传</div>';
    setupDropZone();
    return;
  }

  const svgFolder = '<svg viewBox="0 0 24 24" fill="none" stroke="#a29bfe" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const svgFile = '<svg viewBox="0 0 24 24" fill="none" stroke="#6b7194" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  const svgLink = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffd93d" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  list.innerHTML = items.map(f => {
    const fullPath = currentPath.replace(/\/$/, '') + '/' + f.name;
    const icon = f.isLink ? svgLink : (f.isDir ? svgFolder : svgFile);
    const click = f.isDir ? 'navigateTo(\'' + esc(fullPath) + '\')' : '';
    const isText = !f.isDir && isTextFile(f.name);
    const dblclick = !f.isDir ? (isText ? 'editorOpen(\'' + esc(fullPath) + '\')' : 'downloadFile(\'' + esc(fullPath) + '\')') : '';

    return '<div class="fp-item" onclick="' + click + '" ondblclick="' + dblclick + '">' +
      '<div class="fp-icon">' + icon + '</div>' +
      '<span class="fp-name' + (f.isDir ? ' dir' : '') + '">' + esc(f.name) + '</span>' +
      '<span class="fp-meta">' + (f.isDir ? '' : formatSize(f.size)) + '</span>' +
      '<div class="fp-item-actions">' +
        (isText ? '<button class="fp-btn" onclick="event.stopPropagation();editorOpen(\'' + esc(fullPath) + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' : '') +
        (!f.isDir ? '<button class="fp-btn" onclick="event.stopPropagation();downloadFile(\'' + esc(fullPath) + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>' : '') +
        '<button class="fp-btn" onclick="event.stopPropagation();renameItem(\'' + esc(fullPath) + '\',\'' + esc(f.name) + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
        '<button class="fp-btn danger" onclick="event.stopPropagation();deleteItem(\'' + esc(fullPath) + '\',' + f.isDir + ',\'' + esc(f.name) + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
      '</div>' +
    '</div>';
  }).join('') + '<div class="fp-dropzone" id="fpDropzone">拖拽文件到此上传</div>';

  setupDropZone();
}

// ===== SFTP Actions =====
function downloadFile(remotePath) {
  toast('正在下载 ' + remotePath.split('/').pop() + '...');
  wsSend({ type: 'sftp-download', path: remotePath }, (data) => {
    if (data.error) { toast('下载失败: ' + data.error, 'error'); return; }
    const blob = new Blob([Uint8Array.from(atob(data.data), c => c.charCodeAt(0))]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('下载完成: ' + data.name, 'success');
  });
}

function deleteItem(remotePath, isDir, name) {
  if (!confirm('确认删除 "' + name + '"？' + (isDir ? '（将递归删除目录）' : ''))) return;
  wsSend({ type: 'sftp-delete', path: remotePath, isDir }, (data) => {
    if (data.error) { toast('删除失败: ' + data.error, 'error'); return; }
    toast('已删除: ' + name, 'success');
    refreshDir();
  });
}

function renameItem(oldPath, oldName) {
  const newName = prompt('重命名', oldName);
  if (!newName || newName === oldName) return;
  const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
  const newPath = dir + '/' + newName;
  wsSend({ type: 'sftp-rename', oldPath, newPath }, (data) => {
    if (data.error) { toast('重命名失败: ' + data.error, 'error'); return; }
    toast('已重命名: ' + newName, 'success');
    refreshDir();
  });
}

function promptMkdir() {
  const name = prompt('新文件夹名称');
  if (!name) return;
  const dirPath = currentPath.replace(/\/$/, '') + '/' + name;
  wsSend({ type: 'sftp-mkdir', path: dirPath }, (data) => {
    if (data.error) { toast('创建失败: ' + data.error, 'error'); return; }
    toast('已创建: ' + name, 'success');
    refreshDir();
  });
}

function triggerUpload() { document.getElementById('uploadInput').click(); }

function handleUpload(files) {
  if (!files || files.length === 0) return;
  Array.from(files).forEach(file => {
    if (file.size > 50 * 1024 * 1024) { toast('文件过大(>50MB): ' + file.name, 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = btoa(new Uint8Array(reader.result).reduce((s, b) => s + String.fromCharCode(b), ''));
      toast('正在上传 ' + file.name + '...');
      wsSend({ type: 'sftp-upload', path: currentPath, name: file.name, data: base64 }, (data) => {
        if (data.error) { toast('上传失败: ' + data.error, 'error'); return; }
        toast('上传完成: ' + file.name, 'success');
        refreshDir();
      });
    };
    reader.readAsArrayBuffer(file);
  });
  document.getElementById('uploadInput').value = '';
}

function refreshDir() { listDir(currentPath); }

// ===== Drag & Drop =====
function setupDropZone() {
  const list = document.getElementById('fpList');
  const dz = document.getElementById('fpDropzone');
  if (!list || !dz) return;

  list.ondragover = (e) => { e.preventDefault(); dz.classList.add('active'); };
  list.ondragleave = (e) => {
    if (!list.contains(e.relatedTarget)) dz.classList.remove('active');
  };
  list.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('active');
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };
}

// ===== Utilities =====
function formatSize(bytes) {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' K';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' M';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' G';
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ===== Text File Detection (blacklist binary) =====
const BINARY_EXTENSIONS = new Set([
  'png','jpg','jpeg','gif','bmp','ico','webp','tiff','tif','heic','heif','avif',
  'mp3','mp4','avi','mkv','mov','wmv','flv','webm','m4a','m4v','ogg','wav','flac','aac','wma',
  'zip','tar','gz','bz2','xz','7z','rar','zst','lz4','cab','iso','dmg',
  'exe','dll','so','dylib','bin','dat','o','a','lib','obj','class','pyc','pyo',
  'pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp',
  'ttf','otf','woff','woff2','eot',
  'sqlite','db','mdb','accdb',
  'psd','ai','sketch','fig','xd',
  'swf','swc',
  'deb','rpm','apk','ipa','msi','appimage','snap',
  'img','vmdk','vdi','qcow2',
  'key','p12','pfx','cer','der','jks',
]);
function isTextFile(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) return !BINARY_EXTENSIONS.has(lower.substring(dotIdx + 1));
  return true;
}

// ===== Editor State =====
let editorFilePath = null;
let editorOrigContent = '';
let editorDirty = false;

function editorOpen(remotePath) {
  if (!sftpReady) { toast('SFTP 未就绪', 'error'); return; }
  editorFilePath = remotePath;
  editorDirty = false;
  const fileName = remotePath.split('/').pop();
  document.getElementById('editorFileLabel').textContent = fileName;
  document.getElementById('editorDirty').style.display = 'none';
  document.getElementById('editorSaveBtn').disabled = true;
  document.getElementById('editorSize').textContent = '';
  document.getElementById('editorCursor').textContent = '行 1, 列 1';
  document.getElementById('editorLoading').style.display = 'flex';
  document.getElementById('editorTextarea').style.display = 'none';
  document.getElementById('editorTextarea').value = '';
  document.getElementById('editorOverlay').classList.add('show');

  wsSend({ type: 'sftp-read', path: remotePath }, (data) => {
    document.getElementById('editorLoading').style.display = 'none';
    if (data.error) {
      toast('打开失败: ' + data.error, 'error');
      editorCloseImmediate();
      return;
    }
    editorOrigContent = data.content;
    const ta = document.getElementById('editorTextarea');
    ta.value = data.content;
    ta.style.display = 'block';
    ta.focus();
    document.getElementById('editorSize').textContent = formatSize(data.size);
  });
}

function editorSave() {
  if (!editorFilePath || !editorDirty) return;
  const content = document.getElementById('editorTextarea').value;
  const btn = document.getElementById('editorSaveBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';
  wsSend({ type: 'sftp-write', path: editorFilePath, content }, (data) => {
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 保存';
    if (data.error) {
      toast('保存失败: ' + data.error, 'error');
      btn.disabled = false;
      return;
    }
    editorOrigContent = content;
    editorDirty = false;
    document.getElementById('editorDirty').style.display = 'none';
    btn.disabled = true;
    toast('已保存: ' + editorFilePath.split('/').pop(), 'success');
  });
}

function editorClose() {
  if (editorDirty) {
    if (!confirm('文件未保存，确定关闭？')) return;
  }
  editorCloseImmediate();
}

function editorCloseImmediate() {
  document.getElementById('editorOverlay').classList.remove('show');
  editorFilePath = null;
  editorOrigContent = '';
  editorDirty = false;
}

function editorUpdateDirty() {
  const content = document.getElementById('editorTextarea').value;
  const dirty = content !== editorOrigContent;
  if (dirty !== editorDirty) {
    editorDirty = dirty;
    document.getElementById('editorDirty').style.display = dirty ? 'inline' : 'none';
    document.getElementById('editorSaveBtn').disabled = !dirty;
  }
}

function editorUpdateCursor() {
  const ta = document.getElementById('editorTextarea');
  const pos = ta.selectionStart;
  const text = ta.value.substring(0, pos);
  const line = text.split('\n').length;
  const col = pos - text.lastIndexOf('\n');
  document.getElementById('editorCursor').textContent = '行 ' + line + ', 列 ' + col;
}

// Editor textarea events
(function() {
  const ta = document.getElementById('editorTextarea');
  ta.addEventListener('input', () => { editorUpdateDirty(); editorUpdateCursor(); });
  ta.addEventListener('click', editorUpdateCursor);
  ta.addEventListener('keyup', editorUpdateCursor);
  ta.addEventListener('keydown', (e) => {
    // Tab key inserts tab character
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + '\t' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      editorUpdateDirty();
    }
    // Ctrl+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      editorSave();
    }
  });
})();

// ===== Keyboard shortcuts =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.getElementById('editorOverlay').classList.contains('show')) {
      editorClose();
    } else {
      hideSettings();
    }
  }
});

document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideSettings();
});

document.getElementById('editorOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) editorClose();
});

// ===== Init =====
loadSettings();
if (connInfo) startConnection();
