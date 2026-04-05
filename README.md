# NodeTerminal

基于 Node.js 的 Web 远程连接管理器，支持 SSH 终端、SFTP 文件管理、VNC/RDP 远程桌面和 FTP 文件传输，所有操作均在浏览器中完成。

## 功能展示

### SSH&SFTP

![o7iVkBTDrQghIzaeH7HsRaXr4YqbKRl0.webp](https://cdn.nodeimage.com/i/o7iVkBTDrQghIzaeH7HsRaXr4YqbKRl0.webp)

### VNC

![NxGRs6fs4rbETlxpFdFaKTgb0PAAYLjw.webp](https://cdn.nodeimage.com/i/NxGRs6fs4rbETlxpFdFaKTgb0PAAYLjw.webp)

### RDP

![3I9zo3QfmaRoC4kqD7mvJ0Ms51LFZigR.webp](https://cdn.nodeimage.com/i/3I9zo3QfmaRoC4kqD7mvJ0Ms51LFZigR.webp)

### SFTP/FTP

![j2SQe90Hxg0xhV3x1KUESzgSw30fEFJL.webp](https://cdn.nodeimage.com/i/j2SQe90Hxg0xhV3x1KUESzgSw30fEFJL.webp)

## 功能特点

### 多协议支持
- **SSH 终端** — 基于 xterm.js 的全功能 Web 终端，支持密码和密钥认证，同时支持目录跟随自动SFTP。
- **SFTP 文件管理** — 在线浏览、上传、下载、编辑远程文件，支持拖拽上传
- **VNC 远程桌面** — 基于 noVNC 的浏览器内 VNC 客户端
- **RDP 远程桌面** — 基于 mstsc.js / node-rdpjs 的浏览器内 Windows 远程桌面
- **FTP 文件传输** — 支持 FTP / FTPS (Explicit TLS / Implicit TLS) 的文件浏览和传输

### 服务器管理
- **卡片式管理界面** — 可视化管理所有服务器连接
- **快速连接** — 顶部快捷栏支持 `user@host:port` 格式快速连接
- **全局搜索** — 按名称、IP、用户名搜索服务器
- **分页浏览** — 服务器列表自动分页

### 云同步
- **端到端加密** — 使用 AES-GCM 在客户端加密，服务器无法查看连接信息
- **用户注册/登录** — 内置账号系统
- **OpenID Connect** — 支持 OIDC 第三方登录（可通过 `.env` 开关）
- **同步管理面板** — 可视化对比本地/云端数据，支持分页和去重过滤
- **单项操作** — 支持逐条上传、下载、删除云端数据

### 其他
- **深色主题** — 精心设计的暗色 UI
- **响应式布局** — 适配桌面和移动设备
- **中文界面** — 全中文本地化

## 部署

### 环境要求

- **Node.js** >= 18
- **pnpm**（推荐）或 npm

### 安装步骤

```bash
# 克隆项目
git clone <repo-url>
cd nodeterminal

# 安装依赖
pnpm install

# 复制环境变量配置
cp .env.example .env

# 启动服务
pnpm start
```

服务默认运行在 `http://localhost:3000`。

### 环境变量

编辑 `.env` 文件配置 OpenID Connect 登录（可选）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OIDC_ENABLED` | 是否启用 OpenID Connect 登录 | `false` |
| `OIDC_ISSUER` | OIDC 提供商地址 | — |
| `OIDC_CLIENT_ID` | 客户端 ID | — |
| `OIDC_CLIENT_SECRET` | 客户端密钥 | — |
| `OIDC_REDIRECT_URI` | 回调地址 | `http://localhost:3000/api/oidc/callback` |
| `OIDC_SCOPES` | 请求的 scope | `openid profile email` |
| `OIDC_BUTTON_LABEL` | 登录按钮文字 | `OpenID 登录` |

### 反向代理 (Nginx)

NodeTerminal 使用 WebSocket，Nginx 配置需要包含：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

## 项目结构

```
nodeterminal/
├── server.js          # 主服务端（Express + WebSocket）
├── .env               # 环境变量配置
├── package.json
├── users/             # 用户数据目录（自动创建）
└── public/
    ├── index.html      # 主页面（服务器管理）
    ├── index.js        # 主页面逻辑
    ├── terminal.html   # SSH 终端页面
    ├── terminal.js     # 终端逻辑
    ├── sftp.html       # SFTP 文件管理页面
    ├── sftp.js         # SFTP 逻辑
    ├── vnc.html        # VNC 远程桌面页面
    ├── rdp.html        # RDP 远程桌面页面
    ├── ftp.html        # FTP 文件管理页面
    ├── novnc/          # noVNC 客户端库
    ├── rdpjs/          # mstsc.js 客户端库
    └── vendor/         # 前端依赖（xterm.js 等）
```

## 许可证

MIT
