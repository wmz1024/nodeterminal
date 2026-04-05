require('dotenv').config();
const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const rdp = require('node-rdpjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ftp = require('basic-ftp');
const { Readable, Writable } = require('stream');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true, maxPayload: 50 * 1024 * 1024 });
const vncWss = new WebSocket.Server({ noServer: true });
const rdpWss = new WebSocket.Server({ noServer: true });

// Route WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/vnc-proxy') {
    vncWss.handleUpgrade(req, socket, head, (ws) => vncWss.emit('connection', ws, req));
  } else if (url.pathname === '/rdp-proxy') {
    rdpWss.handleUpgrade(req, socket, head, (ws) => rdpWss.emit('connection', ws, req));
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
});

// ==================== VNC WebSocket Proxy ====================
vncWss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host');
  const port = parseInt(url.searchParams.get('port')) || 5900;

  if (!host) { ws.close(1008, 'Missing host'); return; }

  const tcp = net.createConnection({ host, port }, () => {
    // Connection established, noVNC RFB will start VNC handshake
  });

  tcp.on('data', (buf) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(buf);
    }
  });

  tcp.on('error', (err) => {
    try { ws.close(1011, err.message); } catch {}
  });

  tcp.on('close', () => {
    try { ws.close(); } catch {}
  });

  ws.on('message', (msg) => {
    if (tcp.writable) {
      // Ensure we write Buffer, not string
      tcp.write(Buffer.isBuffer(msg) ? msg : Buffer.from(msg));
    }
  });

  ws.on('close', () => {
    tcp.destroy();
  });
});

// ==================== RDP WebSocket Proxy ====================
rdpWss.on('connection', (ws) => {
  let rdpClient = null;

  function sendJSON(obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'infos') {
      if (rdpClient) { rdpClient.close(); }

      rdpClient = rdp.createClient({
        domain: data.domain || '',
        userName: data.username || '',
        password: data.password || '',
        enablePerf: true,
        autoLogin: true,
        screen: data.screen || { width: 1280, height: 720 },
        locale: data.locale || 'en',
        logLevel: 'ERROR'
      }).on('connect', () => {
        sendJSON({ type: 'rdp-connect' });
      }).on('bitmap', (bitmap) => {
        const bmp = {
          destTop: bitmap.destTop,
          destLeft: bitmap.destLeft,
          destBottom: bitmap.destBottom,
          destRight: bitmap.destRight,
          width: bitmap.width,
          height: bitmap.height,
          bitsPerPixel: bitmap.bitsPerPixel,
          isCompress: bitmap.isCompress,
          data: Buffer.isBuffer(bitmap.data) ? bitmap.data.toString('base64') : bitmap.data
        };
        sendJSON({ type: 'rdp-bitmap', data: bmp });
      }).on('close', () => {
        sendJSON({ type: 'rdp-close' });
      }).on('error', (err) => {
        sendJSON({ type: 'rdp-error', data: err.code || err.message || 'Unknown error' });
      }).connect(data.host, data.port || 3389);
    }

    if (data.type === 'mouse') {
      if (rdpClient) {
        const x = Math.max(0, Math.min(65535, data.x || 0));
        const y = Math.max(0, Math.min(65535, data.y || 0));
        rdpClient.sendPointerEvent(x, y, data.button, data.isPressed);
      }
    }

    if (data.type === 'wheel') {
      if (rdpClient) {
        const x = Math.max(0, Math.min(65535, data.x || 0));
        const y = Math.max(0, Math.min(65535, data.y || 0));
        rdpClient.sendWheelEvent(x, y, data.step, data.isNegative, data.isHorizontal);
      }
    }

    if (data.type === 'scancode') {
      if (rdpClient) rdpClient.sendKeyEventScancode(data.code, data.isPressed);
    }

    if (data.type === 'unicode') {
      if (rdpClient) rdpClient.sendKeyEventUnicode(data.code, data.isPressed);
    }
  });

  ws.on('close', () => {
    if (rdpClient) { rdpClient.close(); rdpClient = null; }
  });
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== FTP API ====================
async function createFtpClient(opts) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  const secure = opts.secure === 'true' ? true : opts.secure === 'implicit' ? 'implicit' : false;
  await client.access({
    host: opts.host,
    port: parseInt(opts.port) || 21,
    user: opts.username || 'anonymous',
    password: opts.password || '',
    secure,
    secureOptions: { rejectUnauthorized: false }
  });
  return client;
}

// List directory
app.post('/ftp/list', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    const list = await client.list(req.body.path || '/');
    res.json({ ok: true, data: list.map(f => ({
      name: f.name, size: f.size, type: f.type === 2 ? 'd' : 'f',
      date: f.rawModifiedAt || f.modifiedAt?.toISOString() || '',
      permissions: f.permissions || {}
    }))});
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Download file
app.post('/ftp/download', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    const remotePath = req.body.path;
    const filename = path.basename(remotePath);
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
    res.setHeader('Content-Type', 'application/octet-stream');
    await client.downloadTo(res, remotePath);
  } catch (e) {
    if (!res.headersSent) res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Upload file (base64 body)
app.post('/ftp/upload', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    const buf = Buffer.from(req.body.fileData, 'base64');
    const stream = new Readable();
    stream.push(buf);
    stream.push(null);
    await client.uploadFrom(stream, req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Delete file
app.post('/ftp/delete', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.remove(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Remove directory
app.post('/ftp/rmdir', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.removeDir(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Create directory
app.post('/ftp/mkdir', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.ensureDir(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// Rename
app.post('/ftp/rename', async (req, res) => {
  let client;
  try {
    client = await createFtpClient(req.body);
    await client.rename(req.body.oldPath, req.body.newPath);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    if (client) client.close();
  }
});

// ==================== User Auth & Sync ====================

const USERS_DIR = path.join(__dirname, 'users');
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

function userFile(username) {
  const safe = username.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safe) return null;
  return path.join(USERS_DIR, safe + '.json');
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function authUser(username, password) {
  const fp = userFile(username);
  if (!fp || !fs.existsSync(fp)) return null;
  let ud;
  try { ud = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
  // OIDC users: skip password check if user was created via OIDC and client sends '__oidc__'
  if (ud.oidc && password === '__oidc__') return { fp, ud };
  const { hash } = hashPassword(password, ud.salt);
  if (hash !== ud.hash) return null;
  return { fp, ud };
}

// Register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 32) return res.json({ error: '用户名长度 2-32 位' });
  if (password.length < 4) return res.json({ error: '密码至少 4 位' });
  if (!/^[a-zA-Z0-9_\-]+$/.test(username)) return res.json({ error: '用户名只能包含字母、数字、下划线和横线' });

  const fp = userFile(username);
  if (!fp) return res.json({ error: '无效用户名' });
  if (fs.existsSync(fp)) return res.json({ error: '用户名已存在' });

  const { salt, hash } = hashPassword(password);
  const userData = { username, salt, hash, servers: [], updatedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(userData, null, 2));
  res.json({ success: true });
});

// Login — returns cloud server list (id + name only, no encrypted data)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: '用户名和密码不能为空' });
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '用户名或密码错误' });
  const list = (auth.ud.servers || []).map(s => ({ id: s.id, name: s.name }));
  res.json({ success: true, servers: list });
});

// Upload servers (replace all cloud data)
app.post('/api/sync/upload', (req, res) => {
  const { username, password, servers } = req.body;
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '认证失败' });
  if (!Array.isArray(servers)) return res.json({ error: '数据格式错误' });
  auth.ud.servers = servers;
  auth.ud.updatedAt = new Date().toISOString();
  fs.writeFileSync(auth.fp, JSON.stringify(auth.ud, null, 2));
  res.json({ success: true });
});

// Download all servers (with encrypted data for client to decrypt)
app.post('/api/sync/download', (req, res) => {
  const { username, password } = req.body;
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '认证失败' });
  res.json({ success: true, servers: auth.ud.servers || [], updatedAt: auth.ud.updatedAt });
});

// List cloud servers (metadata without encrypted data)
app.post('/api/sync/list', (req, res) => {
  const { username, password } = req.body;
  const auth = authUser(username, password);
  if (!auth) return res.json({ error: '认证失败' });
  const list = (auth.ud.servers || []).map(s => ({ id: s.id, name: s.name, host: s.host, port: s.port, user: s.user }));
  res.json({ success: true, servers: list });
});

// ==================== OpenID Connect ====================
const OIDC_ENABLED = (process.env.OIDC_ENABLED || '').toLowerCase() === 'true';
const OIDC_ISSUER = process.env.OIDC_ISSUER || '';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || '';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI || '';
const OIDC_SCOPES = process.env.OIDC_SCOPES || 'openid profile email';
const OIDC_BUTTON_LABEL = process.env.OIDC_BUTTON_LABEL || 'OpenID 登录';

let oidcConfig = null; // cached discovery document
const oidcStates = new Map(); // state -> { created, encKey }

async function getOidcConfig() {
  if (oidcConfig) return oidcConfig;
  const url = OIDC_ISSUER.endsWith('/') ? OIDC_ISSUER + '.well-known/openid-configuration' : OIDC_ISSUER + '/.well-known/openid-configuration';
  const res = await fetch(url);
  if (!res.ok) throw new Error('OIDC discovery failed: ' + res.status);
  oidcConfig = await res.json();
  return oidcConfig;
}

// Public config endpoint — tells client whether OIDC is available
app.get('/api/config', (req, res) => {
  res.json({
    oidc: OIDC_ENABLED,
    oidcLabel: OIDC_BUTTON_LABEL
  });
});

// Start OIDC login flow
app.get('/api/oidc/auth', async (req, res) => {
  if (!OIDC_ENABLED) return res.status(404).json({ error: 'OIDC not enabled' });
  try {
    const cfg = await getOidcConfig();
    const state = crypto.randomBytes(24).toString('hex');
    const encKey = req.query.encKey || '';
    oidcStates.set(state, { created: Date.now(), encKey });
    // Clean old states (> 10 min)
    for (const [k, v] of oidcStates) { if (Date.now() - v.created > 600000) oidcStates.delete(k); }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OIDC_CLIENT_ID,
      redirect_uri: OIDC_REDIRECT_URI,
      scope: OIDC_SCOPES,
      state
    });
    res.redirect(cfg.authorization_endpoint + '?' + params.toString());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// OIDC callback — exchange code for tokens, auto-register/login
app.get('/api/oidc/callback', async (req, res) => {
  if (!OIDC_ENABLED) return res.status(404).json({ error: 'OIDC not enabled' });
  try {
    const { code, state } = req.query;
    if (!code || !state || !oidcStates.has(state)) return res.status(400).send('Invalid OIDC callback');
    const stateData = oidcStates.get(state);
    oidcStates.delete(state);

    const cfg = await getOidcConfig();
    // Exchange code for tokens
    const tokenRes = await fetch(cfg.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OIDC_REDIRECT_URI,
        client_id: OIDC_CLIENT_ID,
        client_secret: OIDC_CLIENT_SECRET
      }).toString()
    });
    if (!tokenRes.ok) throw new Error('Token exchange failed: ' + tokenRes.status);
    const tokens = await tokenRes.json();

    // Get userinfo
    const userRes = await fetch(cfg.userinfo_endpoint, {
      headers: { 'Authorization': 'Bearer ' + tokens.access_token }
    });
    if (!userRes.ok) throw new Error('Userinfo request failed');
    const userInfo = await userRes.json();

    // Derive username: prefer preferred_username, then sub
    let username = (userInfo.preferred_username || userInfo.email || userInfo.sub || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
    if (!username) throw new Error('Cannot determine username from OIDC');
    username = 'oidc_' + username;

    // Auto-register or login
    const fp = userFile(username);
    if (!fp) throw new Error('Invalid username');

    if (!fs.existsSync(fp)) {
      // Auto-register with a random password (user authenticates via OIDC)
      const randPwd = crypto.randomBytes(32).toString('hex');
      const { salt, hash } = hashPassword(randPwd);
      const userData = { username, salt, hash, oidc: true, oidcSub: userInfo.sub, servers: [], updatedAt: new Date().toISOString() };
      fs.writeFileSync(fp, JSON.stringify(userData, null, 2));
    }

    // Generate a one-time token for the client to pick up
    const token = crypto.randomBytes(32).toString('hex');
    oidcStates.set('token_' + token, { username, encKey: stateData.encKey, created: Date.now() });

    // Redirect back to app with token
    res.redirect('/?oidc_token=' + token);
  } catch (e) {
    res.status(500).send('OIDC login failed: ' + e.message);
  }
});

// Client claims the OIDC token to get session info
app.post('/api/oidc/claim', (req, res) => {
  const { token, encKey } = req.body;
  const key = 'token_' + token;
  if (!oidcStates.has(key)) return res.json({ error: 'Invalid or expired token' });
  const data = oidcStates.get(key);
  oidcStates.delete(key);
  if (Date.now() - data.created > 120000) return res.json({ error: 'Token expired' });
  res.json({ success: true, username: data.username });
});

function sendJSON(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ==================== WebSocket SSH + SFTP ====================

wss.on('connection', (ws) => {
  let sshClient = null;
  let stream = null;
  let sftp = null;
  let shellPid = null;

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      if (stream) stream.write(msg);
      return;
    }

    // ---- SFTP-only connection ----
    if (data.type === 'sftp-connect') {
      sshClient = new Client();
      const connOpts = {
        host: data.host,
        port: data.port || 22,
        username: data.username,
        readyTimeout: 10000,
      };
      if (data.privateKey) connOpts.privateKey = data.privateKey;
      else if (data.password) connOpts.password = data.password;

      sshClient.on('ready', () => {
        sendJSON(ws, { type: 'status', message: 'connected' });
        sshClient.sftp((err, s) => {
          if (err) { sendJSON(ws, { type: 'error', message: 'SFTP init failed: ' + err.message }); return; }
          sftp = s;
          sendJSON(ws, { type: 'sftp-ready' });
        });
      });
      sshClient.on('error', (err) => sendJSON(ws, { type: 'error', message: err.message }));
      sshClient.on('close', () => sendJSON(ws, { type: 'status', message: 'disconnected' }));
      sshClient.connect(connOpts);

    // ---- SSH Shell ----
    } else if (data.type === 'connect') {
      sshClient = new Client();
      const connOpts = {
        host: data.host,
        port: data.port || 22,
        username: data.username,
        readyTimeout: 10000,
      };
      if (data.privateKey) connOpts.privateKey = data.privateKey;
      else if (data.password) connOpts.password = data.password;

      sshClient.on('ready', () => {
        sendJSON(ws, { type: 'status', message: 'connected' });

        sshClient.shell(
          { term: 'xterm-256color', cols: data.cols || 80, rows: data.rows || 24 },
          (err, s) => {
            if (err) { sendJSON(ws, { type: 'error', message: err.message }); return; }
            stream = s;
            stream.on('data', (chunk) => { if (ws.readyState === WebSocket.OPEN) ws.send(chunk.toString('utf-8')); });
            stream.on('close', () => { sendJSON(ws, { type: 'status', message: 'disconnected' }); sshClient.end(); });
            stream.stderr.on('data', (chunk) => { if (ws.readyState === WebSocket.OPEN) ws.send(chunk.toString('utf-8')); });
          }
        );

        // Auto-init SFTP
        sshClient.sftp((err, s) => {
          if (!err) { sftp = s; sendJSON(ws, { type: 'sftp-ready' }); }
        });
      });

      sshClient.on('error', (err) => sendJSON(ws, { type: 'error', message: err.message }));
      sshClient.on('close', () => sendJSON(ws, { type: 'status', message: 'disconnected' }));
      sshClient.connect(connOpts);

    } else if (data.type === 'data') {
      if (stream) stream.write(data.data);

    } else if (data.type === 'resize') {
      if (stream) stream.setWindow(data.rows, data.cols, 0, 0);

    // ---- Get shell cwd via /proc ----
    } else if (data.type === 'sftp-pwd') {
      if (!sshClient) return;

      const execCmd = (cmd, cb) => {
        sshClient.exec(cmd, (err, ch) => {
          if (err) return cb(err, '');
          let out = '';
          ch.on('data', (d) => { out += d.toString(); });
          ch.stderr.on('data', () => {});
          ch.on('close', () => cb(null, out.trim()));
        });
      };

      if (shellPid) {
        // Fast path: cached shell PID
        execCmd('readlink /proc/' + shellPid + '/cwd 2>/dev/null || pwd', (err, path) => {
          if (err) { sendJSON(ws, { type: 'sftp-pwd-result', error: err.message }); return; }
          sendJSON(ws, { type: 'sftp-pwd-result', path: path || '/' });
        });
      } else {
        // Discover shell PID: scan /proc for sibling process that is a shell
        const discoverCmd = 'MP=$$; PP=$(awk \'/PPid/{print $2}\' /proc/$MP/status 2>/dev/null); '
          + 'if [ -n "$PP" ]; then '
          + 'for d in /proc/[0-9]*/; do '
          + 'P=${d#/proc/}; P=${P%/}; '
          + '[ "$P" = "$MP" ] && continue; '
          + '[ "$(awk \'/PPid/{print $2}\' ${d}status 2>/dev/null)" = "$PP" ] || continue; '
          + 'N=$(awk \'/Name/{print $2}\' ${d}status 2>/dev/null); '
          + 'case "$N" in bash|zsh|sh|dash|fish|ash|ksh|tcsh|csh) '
          + 'echo "NTPID:$P"; readlink ${d}cwd 2>/dev/null; exit 0;; esac; '
          + 'done; fi; pwd';
        execCmd(discoverCmd, (err, out) => {
          if (err) { sendJSON(ws, { type: 'sftp-pwd-result', error: err.message }); return; }
          const lines = out.split('\n');
          let path = lines[lines.length - 1] || '/';
          for (const line of lines) {
            const m = line.match(/^NTPID:(\d+)$/);
            if (m) { shellPid = m[1]; break; }
          }
          sendJSON(ws, { type: 'sftp-pwd-result', path });
        });
      }

    // ---- SFTP: List directory ----
    } else if (data.type === 'sftp-list') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-list-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      sftp.readdir(data.path || '/', (err, list) => {
        if (err) { sendJSON(ws, { type: 'sftp-list-result', reqId: data.reqId, error: err.message }); return; }
        const items = list.map(f => ({
          name: f.filename,
          size: f.attrs.size,
          mtime: f.attrs.mtime * 1000,
          isDir: (f.attrs.mode & 0o40000) !== 0,
          isLink: (f.attrs.mode & 0o120000) === 0o120000,
          mode: f.attrs.mode,
          uid: f.attrs.uid,
          gid: f.attrs.gid,
        }));
        sendJSON(ws, { type: 'sftp-list-result', reqId: data.reqId, path: data.path, items });
      });

    // ---- SFTP: Stat (for resolving symlinks etc) ----
    } else if (data.type === 'sftp-stat') {
      if (!sftp) return;
      sftp.stat(data.path, (err, stats) => {
        if (err) { sendJSON(ws, { type: 'sftp-stat-result', error: err.message }); return; }
        sendJSON(ws, { type: 'sftp-stat-result', path: data.path, isDir: (stats.mode & 0o40000) !== 0 });
      });

    // ---- SFTP: Download file ----
    } else if (data.type === 'sftp-download') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      sftp.stat(data.path, (err, stats) => {
        if (err) { sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: err.message }); return; }
        if (stats.size > 100 * 1024 * 1024) {
          sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: 'File too large (>100MB)' });
          return;
        }
        const chunks = [];
        const rs = sftp.createReadStream(data.path);
        rs.on('data', (chunk) => chunks.push(chunk));
        rs.on('end', () => {
          const buf = Buffer.concat(chunks);
          sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, name: path.basename(data.path), data: buf.toString('base64'), size: buf.length });
        });
        rs.on('error', (e) => { sendJSON(ws, { type: 'sftp-download-result', reqId: data.reqId, error: e.message }); });
      });

    // ---- SFTP: Upload file ----
    } else if (data.type === 'sftp-upload') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-upload-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      const buf = Buffer.from(data.data, 'base64');
      const remotePath = data.path.replace(/\/$/, '') + '/' + data.name;
      const wstream = sftp.createWriteStream(remotePath);
      wstream.on('close', () => {
        sendJSON(ws, { type: 'sftp-upload-result', reqId: data.reqId, success: true });
      });
      wstream.on('error', (e) => {
        sendJSON(ws, { type: 'sftp-upload-result', reqId: data.reqId, error: e.message });
      });
      wstream.end(buf);

    // ---- SFTP: Delete file ----
    } else if (data.type === 'sftp-delete') {
      if (!sftp) return;
      const doDelete = data.isDir
        ? (cb) => { sshClient.exec('rm -rf ' + JSON.stringify(data.path), (err, ch) => { if (err) return cb(err); ch.on('close', () => cb(null)); ch.resume(); }); }
        : (cb) => sftp.unlink(data.path, cb);
      doDelete((err) => {
        if (err) sendJSON(ws, { type: 'sftp-delete-result', reqId: data.reqId, error: err.message });
        else sendJSON(ws, { type: 'sftp-delete-result', reqId: data.reqId, success: true });
      });

    // ---- SFTP: Create directory ----
    } else if (data.type === 'sftp-mkdir') {
      if (!sftp) return;
      sftp.mkdir(data.path, (err) => {
        if (err) sendJSON(ws, { type: 'sftp-mkdir-result', reqId: data.reqId, error: err.message });
        else sendJSON(ws, { type: 'sftp-mkdir-result', reqId: data.reqId, success: true });
      });

    // ---- SFTP: Read text file ----
    } else if (data.type === 'sftp-read') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      sftp.stat(data.path, (err, stats) => {
        if (err) { sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: err.message }); return; }
        if (stats.size > 5 * 1024 * 1024) {
          sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: 'File too large for editor (>5MB)' });
          return;
        }
        const chunks = [];
        const rs = sftp.createReadStream(data.path);
        rs.on('data', (chunk) => chunks.push(chunk));
        rs.on('end', () => {
          const buf = Buffer.concat(chunks);
          sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, path: data.path, content: buf.toString('utf-8'), size: buf.length });
        });
        rs.on('error', (e) => { sendJSON(ws, { type: 'sftp-read-result', reqId: data.reqId, error: e.message }); });
      });

    // ---- SFTP: Write text file ----
    } else if (data.type === 'sftp-write') {
      if (!sftp) { sendJSON(ws, { type: 'sftp-write-result', reqId: data.reqId, error: 'SFTP not ready' }); return; }
      const buf = Buffer.from(data.content, 'utf-8');
      const wstream = sftp.createWriteStream(data.path);
      wstream.on('close', () => {
        sendJSON(ws, { type: 'sftp-write-result', reqId: data.reqId, success: true });
      });
      wstream.on('error', (e) => {
        sendJSON(ws, { type: 'sftp-write-result', reqId: data.reqId, error: e.message });
      });
      wstream.end(buf);

    // ---- SFTP: Rename ----
    } else if (data.type === 'sftp-rename') {
      if (!sftp) return;
      sftp.rename(data.oldPath, data.newPath, (err) => {
        if (err) sendJSON(ws, { type: 'sftp-rename-result', reqId: data.reqId, error: err.message });
        else sendJSON(ws, { type: 'sftp-rename-result', reqId: data.reqId, success: true });
      });
    }
  });

  ws.on('close', () => {
    if (stream) stream.close();
    if (sshClient) sshClient.end();
    sftp = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`NodeTerminal running at http://localhost:${PORT}`);
});
