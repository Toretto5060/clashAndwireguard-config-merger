# 个人自用WireGuard 配置合并服务

这是一个 Docker 服务，用于从多个远程地址拉取 Clash 配置文件，合并后添加 WireGuard 配置，生成最终的 Clash 配置文件。

## 🌟 功能特性

- ✅ **登录认证保护** - Web界面需要登录访问，支持IP锁定防暴力破解
- ✅ **现代化 Web 管理界面** - 左右分栏布局，完美适配移动端
- ✅ **订阅源脱敏保护** - 自动隐藏订阅源地址中间部分，支持一键查看/隐藏
- ✅ **订阅源Token管理** - 安全的订阅链接生成和管理机制
- ✅ **自动清理机制** - 配置文件删除时，自动失效对应的订阅token
- ✅ **智能容错机制** - 订阅失效时返回空配置，保护现有配置继续可用
- ✅ 从多个 URL 拉取并合并 Clash 配置
- ✅ 自动解析 WireGuard 配置文件（`.conf` 格式）
- ✅ 将 WireGuard 配置转换为 Clash 格式
- ✅ 支持多个 WireGuard 配置文件
- ✅ 支持 YAML 和 JSON 输出格式
- ✅ 自动提取和显示订阅信息（流量、到期时间）
- ✅ 配置持久化存储
- ✅ 响应式设计，完美支持桌面和移动设备
- ✅ 移动端优化布局，转订阅源管理在上方

## 📁 目录结构

```
wireguard-config-merger/
├── Dockerfile              # Docker 镜像构建文件
├── docker-compose.yml      # Docker Compose 配置
├── package.json           # Node.js 依赖配置
├── index.js              # 主服务器文件
├── wireguard-parser.js   # WireGuard 配置解析器
├── config-merger.js      # 配置合并逻辑
├── config-manager.js     # 配置管理模块
├── public/               # Web 界面
│   └── index.html       # 配置管理页面
├── conf/                # WireGuard 配置文件目录
│   └── .gitkeep
├── data/                # 配置文件存储目录
│   └── .gitkeep
└── README.md           # 说明文档
```

## 🚀 快速开始

### 1. 准备 WireGuard 配置文件

将你的 WireGuard 配置文件放入 `conf/` 目录，例如：

```bash
conf/
├── my_config.conf
├── home_server.conf
└── office_vpn.conf
```

WireGuard 配置文件格式示例：

```ini
[Interface]
PrivateKey = your_private_key_here==
Address = 10.0.10.3/24
DNS = 8.8.8.8
MTU = 1340

[Peer]
PublicKey = peer_public_key_here==
PresharedKey = preshared_key_here==
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
```

### 2. 构建 Docker 镜像

```bash
# 使用构建脚本
chmod +x build.sh
./build.sh

# 或手动构建
docker buildx build --platform linux/amd64,linux/arm64 -t toretto5060/clashandwireguard-config-merger:latest --push .

docker buildx build --platform linux/amd64,linux/arm64 -t toretto5060/clashandwireguard-config-merger:v1.0.03 -t toretto5060/clashandwireguard-config-merger:latest --push .

```

```bash
feat: 新增登录功能
fix: 修复支付失败问题
docs: 更新README
```

### 3. 运行容器

#### 方式一：使用 docker run

**推荐（Linux 宿主机）：容器内 `wg set` 直接作用在宿主机 WireGuard 上** — 使用 **`--network=host`** 与宿主机共享网络命名空间，镜像内已含 `wireguard-tools`；再加 **`--cap-add=NET_ADMIN`** 否则 `wg set` 可能被内核拒绝。此时一般**不必**再设 `WG_PUBLIC_KEY`（可从 `wg show` 读到服务端公钥）。Web 端口用环境变量 **`PORT`**（例：`12333`），**不要**再写 `-p`（host 网络下端口映射无效）。

```bash
docker run -d \
  --name clashAndWireguard_config_manger \
  --network=host \
  --cap-add=NET_ADMIN \
  -e PORT=12333 \
  -e WEB_USERNAME=admin \
  -e WEB_PASSWORD=admin123 \
  -e WG_INTERFACE=WG \
  -e WG_SERVER=your.domain.com:51820 \
  -v /etc/wireguard/conf:/app/conf \
  -v /mnt/docker_lib/data:/app/data \
  -v /etc/wireguard/script:/app/script \
  --restart always \
  toretto5060/clashandwireguard-config-merger:latest
```

- **`WG_INTERFACE`**：与宿主机上 `wg show` 里接口名一致（如 `WG`、`wg0`）。
- 若**不能**使用 `host` 网络（例如仅生成 conf、再在路由器上手动 `wg set`），可改回端口映射并设置 **`WG_PUBLIC_KEY`**，见下方说明。

**备选：桥接网络 + 端口映射**（容器内**看不到**宿主机 `wg` 接口，新增客户端**不会**自动 `wg set`，仅写文件）：

```bash
docker run -d \
  --name clashAndWireguard_config_manger \
  -p 12333:3000 \
  -e WEB_USERNAME=admin \
  -e WEB_PASSWORD=admin123 \
  -e WG_PUBLIC_KEY=PASTE_WG_PUBLIC_KEY \
  -e WG_SERVER=your.domain.com:51820 \
  -v /etc/wireguard/conf:/app/conf \
  -v /mnt/docker_lib/data:/app/data \
  -v /etc/wireguard/script:/app/script \
  --restart always \
  toretto5060/clashandwireguard-config-merger:latest
```

**与三条 `-v` 的对应关系**：`script/add-client.sh`、`delete-client.sh` 默认 **`peers.list`** 在 **`/app/script/peers.list`**，客户端 **`.conf`** 在 **`/app/conf`**；可用 **`PEERS_FILE`**、**`CONF_DIR`** 覆盖。向 `conf` 写文件时不要对 **`/app/conf`** 使用 `:ro`。

`WG_PUBLIC_KEY` / `WG_SERVER`：在**桥接**模式下容器读不到宿主机 `wg`，「新增客户端」需设置 **`WG_PUBLIC_KEY`**（路由器 `wg show <接口> public-key`）；**`WG_SERVER`** 为客户端 `[Peer] Endpoint`。

在 **OpenWrt 上直接跑脚本**（不经过本容器）时，请设置 **`PEERS_FILE`**、**`CONF_DIR`** 为路由器路径。

#### 方式二：使用 docker-compose

```bash
docker-compose up -d
```

### 4. 访问 Web 管理界面

浏览器打开：`http://localhost:3000`（若使用 `--network=host` 且 `-e PORT=12333`，则改为 `http://localhost:12333`）

**首次登录：**
- 默认用户名：`admin`
- 默认密码：`admin123`
- ⚠️ **强烈建议修改默认密码**（通过环境变量 `WEB_USERNAME` 和 `WEB_PASSWORD`）

**安全特性：**
- 3小时内登录失败10次，自动锁定IP
- Session有效期24小时
- 锁定期间登录按钮禁用

在 Web 界面中配置：
- 📡 订阅源地址
- 🔌 WireGuard MTU
- 🌐 DNS 服务器
- 🏠 代理组名称
- 📋 路由规则

配置会自动保存到 `data/config.json`，重启容器后配置不会丢失。

## 📖 使用方法

### 登录认证

首次访问 `http://localhost:3000` 会自动跳转到登录页面。

**登录功能：**
- 🔐 需要输入用户名和密码
- 🛡️ 防暴力破解：3小时内失败10次自动锁定IP
- ⏰ Session有效期24小时
- 📊 实时显示剩余尝试次数
- 🔒 锁定状态下登录按钮自动禁用

**IP锁定机制：**
```
尝试次数统计：滚动3小时窗口
锁定条件：10次失败尝试
锁定时长：3小时
锁定效果：无法登录，显示剩余锁定时间
解锁方式：自动解锁（3小时后）
```

### Web 管理界面

登录成功后进入配置管理页面。

**界面布局：**

**桌面端布局：**
```
┌─────────────────────────────────────────────────────┐
│              🔐 WireGuard 配置管理中心               │
├──────────────────────┬──────────────────────────────┤
│   ⚙️ 订阅配置        │    🔗 转订阅源管理           │
├──────────────────────┼──────────────────────────────┤
│ • 订阅源地址         │ • 选择配置文件               │
│ • WireGuard MTU      │ • 生成订阅链接               │
│ • WireGuard DNS      │ • 已生成的订阅列表           │
│ • 代理组名称         │   - 复制链接                 │
│ • 路由规则           │   - 失效管理                 │
│                      │   - 使用统计                 │
│ [💾 保存] [🔄 重载]  │ [✨ 生成订阅链接]            │
└──────────────────────┴──────────────────────────────┘
```

**移动端布局：**
```
┌─────────────────────────────────────┐
│   🔐 WireGuard 配置管理中心          │
├─────────────────────────────────────┤
│   🔗 转订阅源管理                    │
│   • 选择配置文件                     │
│   • 生成订阅链接                     │
│   • 已生成的订阅列表                 │
├─────────────────────────────────────┤
│   ⚙️ 订阅配置                        │
│   • 订阅源地址                       │
│   • WireGuard MTU / DNS              │
│   • 代理组名称 / 路由规则            │
└─────────────────────────────────────┘
```

**左侧/下方 - 订阅配置：**
- 📡 **订阅源地址**：添加/删除多个 Clash 订阅源
  - 🔒 自动脱敏显示：保存后自动隐藏中间部分（如：`https://examp******nfig`）
  - 👁️ 显示/隐藏切换：点击小眼睛图标查看完整地址
  - ✏️ 编辑功能：显示完整地址后可直接编辑
- 🔌 **WireGuard MTU**：配置 MTU 值（1280-1420）
- 🌐 **DNS 服务器**：主 DNS 和备用 DNS
- 🏠 **代理组名称**：自定义代理组显示名称
- 📋 **路由规则**：自定义路由规则，每行一条

**右侧/上方 - 转订阅源管理：**
- 🔗 **生成订阅链接**：为指定配置文件生成安全的订阅Token
- 📊 **订阅列表**：查看所有已生成的订阅链接
  - 智能排序：有效订阅在上，失效订阅在下，同状态按创建时间排序
  - 状态标识：有效（绿色✓）、失效（红色✗，虚线边框，半透明）
  - 创建时间、使用次数、最后使用时间
  - 复制链接、失效订阅操作
- 🧹 **自动清理**：配置文件删除时，系统自动失效对应的订阅token

**响应式设计：**
- 📱 **移动端**：上下布局，转订阅源管理在上方，方便快速访问
- 💻 **桌面端**：左右分栏布局，操作更便捷，无滚动条
- 🎨 **界面优化**：
  - 紧凑型顶部标题，节省屏幕空间
  - 固定高度布局，避免全屏滚动
  - 更多空间留给配置和管理面板

### 生成订阅链接

1. 在右侧下拉框选择 WireGuard 配置文件
2. 点击 **✨ 生成订阅链接** 按钮
3. 复制生成的订阅URL，添加到 Clash 客户端

**订阅链接格式：**
```
http://localhost:3000/config/<配置名称>/<token>
```

例如：
```
http://localhost:3000/config/my_config/5df68e81
https://yourdomain.com:3000/config/home_server/abc123de
```

### 订阅链接特性

✅ **安全性**：每个配置只能生成一个有效token，需要先失效才能重新生成  
✅ **可追踪**：记录每个订阅的使用次数和最后使用时间  
✅ **容错性**：token失效后返回空配置模板，保护客户端已缓存的配置继续可用  
✅ **易管理**：支持一键复制链接和失效操作  
✅ **状态可视化**：
  - 有效订阅：绿色标签 "✓ 有效"
  - 失效订阅：红色标签 "✗ 已失效" + 虚线红框 + 半透明显示 + 删除线配置名
✅ **智能排序**：有效订阅在上方，失效订阅在下方，同状态按创建时间降序（新的在前）  
✅ **自动清理**：删除 WireGuard 配置文件后，在**服务启动**、**登录成功后**或管理页点击**重新加载**重新扫描 `conf` 时，会自动失效已不存在配置对应的订阅 token

**输出示例：**
```yaml
# ========================================
# 订阅信息
# ========================================
# 订阅源 1: https://example.com/config.yaml
#   上传流量: 3.17 GB
#   下载流量: 25.77 GB
#   已用流量: 28.94 GB
#   总流量: 255.49 GB
#   剩余流量: 226.55 GB
#   到期时间: 2026/7/4 12:14:53
# ========================================

port: 7890
socks-port: 7891
...
proxies:
  - name: WireGuard
    type: wireguard
    ...
```

## 🔌 API 端点

### 1. Web 管理界面 - `GET /`

访问配置管理页面（浏览器访问）。

### 2. 订阅配置 - `GET /config/:configName/:token`

通过token获取合并后的 Clash 配置文件。

**参数：**
- `configName`：WireGuard 配置文件名（不含 .conf 扩展名）
- `token`：通过 Web 界面生成的订阅token

**示例：**
```bash
curl http://localhost:3000/config/my_config/5df68e81
```

**响应：**
- ✅ Token有效：返回完整的合并配置（YAML格式）
- ⚠️ Token失效：返回空配置模板 + 说明注释（客户端缓存的配置仍可用）
- ⚠️ 配置不存在：返回空配置模板 + 错误说明

**容错机制：**
即使订阅源失效或出错，也会返回 200 状态码和空配置模板，不会影响 Clash 客户端的现有配置。

### 3. 健康检查 - `GET /health`

查看服务状态和可用配置列表。

**示例：**
```bash
curl http://localhost:3000/health
```

**响应：**
```json
{
  "status": "ok",
  "available_configs": ["my_config", "home_server"],
  "configs": ["my_config", "home_server"],
  "configCount": 2,
  "configUrls": ["https://example.com/config.yaml"],
  "mtu": 1340,
  "dns": ["8.8.8.8", "1.1.1.1"],
  "groupName": "🏠 Home"
}
```

### 4. 配置管理 API - `GET/POST /api/config`

获取或更新配置参数。

**获取配置：**
```bash
curl http://localhost:3000/api/config
```

**更新配置：**
```bash
curl -X POST http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "configUrls": ["https://example.com/config.yaml"],
    "wgMtu": 1340,
    "wgDns": ["8.8.8.8", "1.1.1.1"],
    "wgGroupName": "🏠 Home",
    "prependRules": [
      "IP-CIDR,192.168.0.0/16,🏠 Home",
      "IP-CIDR,10.0.0.0/8,🏠 Home"
    ]
  }'
```

### 5. Token管理 API

#### 创建Token - `POST /api/tokens`

为指定配置文件生成订阅token。

**请求体：**
```bash
curl -X POST http://localhost:3000/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"configName": "my_config"}'
```

**响应：**
```json
{
  "success": true,
  "token": "5df68e81",
  "configName": "my_config",
  "subscriptionUrl": "http://localhost:3000/config/my_config/5df68e81",
  "createdAt": 1698123456789
}
```

**注意：** 每个配置只能有一个有效token，需要先失效旧token才能生成新的。

#### 获取所有Token - `GET /api/tokens`

获取所有已生成的订阅token列表。

**示例：**
```bash
curl http://localhost:3000/api/tokens
```

**响应：**
```json
[
  {
    "token": "5df68e81",
    "configName": "my_config",
    "active": true,
    "createdAt": 1698123456789,
    "lastUsed": 1698234567890,
    "usageCount": 25,
    "subscriptionUrl": "http://localhost:3000/config/my_config/5df68e81"
  }
]
```

#### 失效Token - `DELETE /api/tokens/:token`

使指定token失效。

**示例：**
```bash
curl -X DELETE http://localhost:3000/api/tokens/5df68e81
```

### 6. 重新加载 - `POST /reload`

重新加载 WireGuard 配置文件和应用配置。

**示例：**
```bash
curl -X POST http://localhost:3000/reload
```

## ⚙️ 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `CONF_DIR` | WireGuard 配置目录 | `/app/conf` |
| `CONFIG_FILE` | 配置文件存储路径 | `/app/data/config.json` |
| `TOKEN_FILE` | Token数据存储路径 | `/app/data/tokens.json` |
| `WEB_USERNAME` | Web登录用户名 | `admin` |
| `WEB_PASSWORD` | Web登录密码 | `admin123` |

**注意：** 订阅源、MTU、DNS 等参数现在通过 Web 界面配置，不再使用环境变量。

**安全建议：**
⚠️ **请务必修改默认的登录用户名和密码！**

修改方式：
1. 修改 `docker-compose.yml` 中的环境变量
2. 或通过 `docker run` 命令传递环境变量

```bash
docker run -d \
  -e WEB_USERNAME=your_username \
  -e WEB_PASSWORD=your_strong_password \
  ...
```

**数据持久化：**
- `data/config.json` - 存储应用配置（订阅源、WireGuard参数、路由规则）
- `data/tokens.json` - 存储订阅token信息（token、使用统计等）
- `data/login-attempts.json` - 存储登录尝试记录（用于IP锁定）

三个文件都会在容器重启后保持不变（通过 volume 挂载）。

## 📋 配置说明

配置文件 `data/config.json` 格式：

```json
{
  "configUrls": [
    "https://example.com/config1.yaml",
    "https://example.com/config2.yaml"
  ],
  "wgMtu": 1340,
  "wgDns": ["8.8.8.8", "1.1.1.1"],
  "wgGroupName": "🏠 Home",
  "prependRules": [
    "IP-CIDR,192.168.0.0/16,🏠 Home",
    "IP-CIDR,10.0.0.0/8,🏠 Home",
    "DOMAIN-KEYWORD,local,🏠 Home"
  ]
}
```

## 🔄 配置转换说明

服务会自动将 WireGuard 配置转换为 Clash 格式：

**WireGuard 配置：**
```ini
[Interface]
PrivateKey = YourPrivateKeyHere1234567890ABCDEFG=
Address = 10.0.10.3/24

[Peer]
PublicKey = PeerPublicKeyHere1234567890ABCDEFG=
PresharedKey = PresharedKeyHere1234567890ABCDEFG=
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0
```

**转换为 Clash 格式：**
```yaml
proxies:
  - name: WireGuard
    type: wireguard
    ip: 10.0.10.3
    private-key: YourPrivateKeyHere1234567890ABCDEFG=
    peers:
      - server: vpn.example.com
        port: 51820
        public-key: PeerPublicKeyHere1234567890ABCDEFG=
        pre-shared-key: PresharedKeyHere1234567890ABCDEFG=
        allowed-ips:
          - 0.0.0.0/0
    udp: true
    mtu: 1340
    remote-dns-resolve: true
    dns:
      - 8.8.8.8

proxy-groups:
  - name: 🏠 Home
    type: select
    proxies:
      - WireGuard

rules:
  - IP-CIDR,192.168.0.0/16,🏠 Home
  - IP-CIDR,10.0.0.0/8,🏠 Home
  - DOMAIN-KEYWORD,local,🏠 Home
```

## 🛠️ 开发调试

### 本地运行（不使用 Docker）

```bash
# 安装依赖
npm install

# 创建数据目录
mkdir -p data conf

# 启动服务（开发模式）
npm run dev

# 或生产模式
npm start
```

### 查看日志

```bash
# Docker 日志
docker logs -f wireguard-config-merger

# Docker Compose 日志
docker-compose logs -f
```

## ❓ 常见问题

### 1. 配置文件不存在

**错误：** `404 配置不存在`

**解决：** 
- 确保 `conf/` 目录下有对应的 `.conf` 文件
- 访问 `/health` 端点查看可用配置列表
- 访问 `POST /reload` 重新加载配置

### 2. 远程配置拉取失败

**错误：** `拉取配置失败`

**解决：**
- 检查 Web 界面中的订阅源地址是否正确
- 确保远程地址可访问
- 查看容器日志了解详细错误

### 3. WireGuard 配置解析失败

**错误：** `解析配置文件失败`

**解决：**
- 检查 `.conf` 文件格式是否正确
- 确保必需字段（PrivateKey, PublicKey, Endpoint 等）都存在

### 4. 配置保存失败

**错误：** `保存配置失败`

**解决：**
- 确保 `data` 目录有写入权限
- 检查配置格式是否正确
- 查看容器日志了解详细错误

## 📊 订阅信息

服务会自动提取订阅源的流量和到期信息：

- **HTTP 响应头**：`Subscription-Userinfo` 包含流量和到期时间（供 Clash Verge 等客户端使用）
- **YAML 注释**：在配置文件顶部显示详细的订阅信息（供人类阅读）

支持多个订阅源时：
- HTTP 响应头使用第一个订阅源的数据
- YAML 注释显示所有订阅源的完整信息

## 📝 许可证

ISC

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
