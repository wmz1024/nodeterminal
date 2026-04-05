# NodeTerminal

基于 Node.js 的 Web 远程连接管理器，支持 SSH 终端、SFTP 文件管理、VNC/RDP 远程桌面和 FTP 文件传输，所有操作均在浏览器中完成。

Github: https://github.com/wmz1024/nodeterminal

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
- **暗色/亮色主题** — 支持一键切换，偏好自动保存到本地
- **响应式布局** — 适配桌面和移动设备
- **中文界面** — 全中文本地化
- **iframe 嵌入** — 提供 `embed.html` 中间页，可通过 URL 参数直接嵌入到第三方系统

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

## Docker 部署

镜像已发布至 Docker Hub：[wmz1024/nodeterminal](https://hub.docker.com/r/wmz1024/nodeterminal)，**无需本地构建**，直接拉取运行即可。

### 使用 Docker Compose（推荐）

你只需要一个 `docker-compose.yml` 文件，内容如下：

```yaml
services:
  nodeterminal:
    image: wmz1024/nodeterminal:latest
    container_name: nodeterminal
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./users:/app/users
      - ./.env:/app/.env:ro
    environment:
      - NODE_ENV=production
```

```bash
wget https://raw.githubusercontent.com/wmz1024/nodeterminal/main/.env.example -O .env
# 按需编辑 .env

# 拉取并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

### 直接使用 Docker

```bash
docker run -d \
  --name nodeterminal \
  --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/users:/app/users \
  -v $(pwd)/.env:/app/.env:ro \
  wmz1024/nodeterminal:latest
```

### 更新镜像

```bash
docker compose down
docker compose pull
docker compose up -d
```

### 挂载说明

| 宿主机路径 | 容器路径 | 说明 |
|-----------|---------|------|
| `./users/` | `/app/users/` | 用户账号数据（持久化） |
| `./.env` | `/app/.env` | 环境变量配置（只读挂载） |

### 本地构建（开发者）

仅在需要修改源码后自行构建时使用：

```bash
git clone https://github.com/wmz1024/nodeterminal.git
cd nodeterminal
docker build -t wmz1024/nodeterminal .
```

## iframe 嵌入 (embed.html)

`embed.html` 是一个中间件页面，通过 URL 查询参数接收连接信息，自动路由到对应的功能页面（SSH、SFTP、VNC、RDP、FTP）。适合将 NodeTerminal 嵌入到其他系统的 iframe 中使用。

### 基本格式

```
/embed.html?type=<类型>&host=<地址>&port=<端口>&user=<用户名>&pass=<密码>
```

### 参数说明

| 参数 | 说明 | 必填 |
|------|------|------|
| `type` | 连接类型：`ssh` / `sftp` / `vnc` / `rdp` / `ftp` | 是 |
| `host` | 服务器地址 | 是 |
| `port` | 端口号（各协议有默认值） | 否 |
| `user` | 用户名 | 否 |
| `pass` | 密码 | 否 |
| `key` | SSH 私钥内容（SSH/SFTP） | 否 |
| `secure` | FTP 加密模式：`false` / `true` / `implicit` | 否 |

### 各类型示例

```bash
# SSH 终端
/embed.html?type=ssh&host=192.168.1.1&port=22&user=root&pass=123456

# SFTP 文件管理
/embed.html?type=sftp&host=192.168.1.1&user=root&pass=123456

# VNC 远程桌面
/embed.html?type=vnc&host=192.168.1.1&port=5900&pass=vncpass

# RDP 远程桌面
/embed.html?type=rdp&host=192.168.1.1&port=3389&user=Administrator&pass=123456

# FTP 文件传输（FTPS）
/embed.html?type=ftp&host=192.168.1.1&port=21&user=ftpuser&pass=123456&secure=true
```

### 在 iframe 中使用

```html
<iframe
  src="https://your-nodeterminal.com/embed.html?type=ssh&host=10.0.0.1&user=root&pass=xxx"
  width="100%"
  height="600"
  style="border: none;"
  allow="clipboard-read; clipboard-write"
  allowfullscreen>
</iframe>
```

> **安全提示**：URL 中包含明文密码，建议仅在内网或受信环境中使用，或通过后端动态生成带有临时凭据的嵌入链接。

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
    ├── embed.html      # iframe 嵌入中间件
    ├── novnc/          # noVNC 客户端库
    ├── rdpjs/          # mstsc.js 客户端库
    └── vendor/         # 前端依赖（xterm.js 等）
```

## 许可证

MIT
