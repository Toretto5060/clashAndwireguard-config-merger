# 个人自用WireGuard 配置合并服务
这是一个 Docker 服务，用于从多个远程地址拉取 Clash 配置文件，合并后添加 WireGuard 配置，生成最终的 Clash 配置文件。

## 功能特性

- ✅ 从多个 URL 拉取并合并 Clash 配置
- ✅ 自动解析 WireGuard 配置文件（`.conf` 格式）
- ✅ 将 WireGuard 配置转换为 Clash 格式
- ✅ 支持多个 WireGuard 配置文件，通过路径名访问
- ✅ 支持自定义 MTU、DNS 等参数
- ✅ 支持 YAML 和 JSON 输出格式
- ✅ 自动添加代理组和路由规则

## 目录结构

```
wireguard-config-merger/
├── Dockerfile              # Docker 镜像构建文件
├── docker-compose.yml      # Docker Compose 配置
├── package.json           # Node.js 依赖配置
├── index.js              # 主服务器文件
├── wireguard-parser.js   # WireGuard 配置解析器
├── config-merger.js      # 配置合并逻辑
├── .env.example          # 环境变量示例
├── conf/                 # WireGuard 配置文件目录
│   ├── my_config.conf   # 示例配置
│   └── .gitkeep
└── README.md            # 说明文档
```

## 快速开始

### 1. 准备配置文件

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

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
PORT=3000
CONFIG_URLS=https://example.com/config1.yaml,https://example.com/config2.yaml
WG_MTU=1340
WG_DNS=8.8.8.8,1.1.1.1
WG_GROUP_NAME=🏠 Home
```

### 3. 构建 Docker 镜像

```bash
docker build -t wireguard-config-merger .
```

### 4. 运行容器

#### 方式一：使用 docker run

```bash
docker run -d \
  --name wireguard-config-merger \
  -p 3000:3000 \
  -e CONFIG_URLS="https://example.com/config1.yaml,https://example.com/config2.yaml" \
  -e WG_MTU=1340 \
  -e WG_DNS="8.8.8.8,1.1.1.1" \
  -e WG_GROUP_NAME="🏠 Home" \
  -v $(pwd)/conf:/app/conf:ro \
  wireguard-config-merger
```

#### 方式二：使用 docker-compose

修改 `docker-compose.yml` 中的环境变量，然后运行：

```bash
docker-compose up -d
```

## 使用方法

### 获取配置

访问 `http://localhost:3000/<配置名称>` 即可获取合并后的配置文件。

例如，如果你有 `conf/my_config.conf` 文件，访问：

```bash
# 获取 YAML 格式（默认）
curl http://localhost:3000/my_config

# 获取 JSON 格式
curl -H "Accept: application/json" http://localhost:3000/my_config
```

### API 端点

#### 1. 获取配置 - `GET /:configName`

根据配置名称返回合并后的 Clash 配置。

**示例：**
```bash
curl http://localhost:3000/my_config
```

#### 2. 健康检查 - `GET /health`

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
  "mtu": 1340,
  "dns": ["8.8.8.8", "1.1.1.1"]
}
```

#### 3. 重新加载配置 - `POST /reload`

重新加载所有 WireGuard 配置文件（无需重启容器）。

**示例：**
```bash
curl -X POST http://localhost:3000/reload
```

#### 4. 列出配置 - `GET /`

查看服务信息和所有可用配置。

**示例：**
```bash
curl http://localhost:3000/
```

## 环境变量说明

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| `PORT` | 服务监听端口 | `3000` | `3000` |
| `CONFIG_URLS` | 远程配置地址（逗号分隔） | `[]` | `https://example.com/config1.yaml,https://example.com/config2.yaml` |
| `CONF_DIR` | WireGuard 配置目录 | `/app/conf` | `/app/conf` |
| `WG_MTU` | WireGuard MTU 值 | `1340` | `1340` |
| `WG_DNS` | DNS 服务器（逗号分隔） | `8.8.8.8` | `8.8.8.8,1.1.1.1` |
| `WG_GROUP_NAME` | 代理组名称 | `🏠 Home` | `🏠 Home` |
| `PREPEND_RULES` | 前置规则（逗号分隔） | 见下方 | `IP-CIDR,192.168.0.0/16,🏠 Home` |

**默认规则：**
```
IP-CIDR,192.168.0.0/16,🏠 Home
IP-CIDR,10.0.0.0/8,🏠 Home
DOMAIN-KEYWORD,local,🏠 Home
```

## 配置转换说明

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

## 开发调试

### 本地运行（不使用 Docker）

```bash
# 安装依赖
npm install

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

## 常见问题

### 1. 配置文件不存在

**错误：** `404 配置不存在`

**解决：** 
- 确保 `conf/` 目录下有对应的 `.conf` 文件
- 访问 `/health` 端点查看可用配置列表
- 访问 `POST /reload` 重新加载配置

### 2. 远程配置拉取失败

**错误：** `拉取配置失败`

**解决：**
- 检查 `CONFIG_URLS` 环境变量是否正确
- 确保远程地址可访问
- 查看容器日志了解详细错误

### 3. WireGuard 配置解析失败

**错误：** `解析配置文件失败`

**解决：**
- 检查 `.conf` 文件格式是否正确
- 确保必需字段（PrivateKey, PublicKey, Endpoint 等）都存在

## 许可证

ISC

## 贡献

欢迎提交 Issue 和 Pull Request！



