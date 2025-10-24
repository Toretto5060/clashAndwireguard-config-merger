# 个人自用WireGuard 配置合并服务

这是一个 Docker 服务，用于从多个远程地址拉取 Clash 配置文件，合并后添加 WireGuard 配置，生成最终的 Clash 配置文件。

## 🌟 功能特性

- ✅ **Web 管理界面** - 通过浏览器配置所有参数，无需修改环境变量
- ✅ 从多个 URL 拉取并合并 Clash 配置
- ✅ 自动解析 WireGuard 配置文件（`.conf` 格式）
- ✅ 将 WireGuard 配置转换为 Clash 格式
- ✅ 支持多个 WireGuard 配置文件，通过路径名访问
- ✅ 支持 YAML 和 JSON 输出格式
- ✅ 自动提取和显示订阅信息（流量、到期时间）
- ✅ 配置持久化存储

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
docker build -t wireguard-config-merger .
```

### 3. 运行容器

#### 方式一：使用 docker run

```bash
docker run -d \
  --name wireguard-config-merger \
  -p 3000:3000 \
  -v $(pwd)/conf:/app/conf:ro \
  -v $(pwd)/data:/app/data \
  wireguard-config-merger
```

#### 方式二：使用 docker-compose

```bash
docker-compose up -d
```

### 4. 访问 Web 管理界面

浏览器打开：`http://localhost:3000`

在 Web 界面中配置：
- 📡 订阅源地址
- 🔌 WireGuard MTU
- 🌐 DNS 服务器
- 🏠 代理组名称
- 📋 路由规则

配置会自动保存到 `data/config.json`，重启容器后配置不会丢失。

## 📖 使用方法

### Web 管理界面

访问 `http://localhost:3000` 进入配置管理页面：

![Web 界面](https://via.placeholder.com/800x450?text=Web+Config+Interface)

**功能说明：**
- **订阅源管理**：添加/删除多个 Clash 订阅地址
- **参数配置**：MTU、DNS、代理组名称等
- **规则配置**：自定义路由规则
- **实时保存**：点击保存后立即生效

### 获取配置

访问 `http://localhost:3000/<配置名称>` 即可获取合并后的配置文件。

例如，如果你有 `conf/my_config.conf` 文件，访问：

```bash
# 获取 YAML 格式（默认）
curl http://localhost:3000/my_config

# 获取 JSON 格式
curl -H "Accept: application/json" http://localhost:3000/my_config
```

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

访问配置管理页面。

### 2. 获取配置 - `GET /:configName`

根据配置名称返回合并后的 Clash 配置。

**示例：**
```bash
curl http://localhost:3000/my_config
```

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

### 5. 重新加载 - `POST /reload`

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

**注意：** 订阅源、MTU、DNS 等参数现在通过 Web 界面配置，不再使用环境变量。

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
