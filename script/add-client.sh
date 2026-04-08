#!/bin/sh
# 路径默认对齐容器内三条挂载：客户端 conf → /app/conf，脚本与 peers.list → /app/script
# 路由器上直接运行时请设置 PEERS_FILE、CONF_DIR（例如 /etc/wireguard/script/peers.list 与 /etc/wireguard/conf）
WG_INTERFACE="${WG_INTERFACE:-WG}"
WG_SERVER="${WG_SERVER:-xxx.xxx.xxx:333333}"
WG_PUBLIC_KEY="${WG_PUBLIC_KEY:-}"
PEERS_FILE="${PEERS_FILE:-/app/script/peers.list}"
CONF_DIR="${CONF_DIR:-/app/conf}"

NAME="$1"
if [ -z "$NAME" ]; then
  echo "❗ 用法: $0 <客户端名称>"
  exit 1
fi

mkdir -p "$(dirname "$PEERS_FILE")"
mkdir -p "$CONF_DIR"
umask 077

CLIENT_CONF="$CONF_DIR/${NAME}.conf"

if [ -f "$CLIENT_CONF" ]; then
    echo "📱 配置已存在: $CLIENT_CONF"
    exit 0
fi

# 获取服务器公钥：优先环境变量（适合 Docker 等无 wg 接口场景）
if [ -n "$WG_PUBLIC_KEY" ]; then
    SERVER_PUBKEY=$(echo "$WG_PUBLIC_KEY" | tr -d ' \n\r\t')
else
    SERVER_PUBKEY=$(wg show "$WG_INTERFACE" public-key 2>/dev/null)
fi
if [ -z "$SERVER_PUBKEY" ]; then
    echo "❌ 无法获取服务器公钥。"
    echo "   请在环境中设置 WG_PUBLIC_KEY=<路由器 wg 接口的 public-key>，或在已启动 wg 的接口上运行本脚本。"
    exit 1
fi

# 遍历 peers.list 已占用 IP 的最后一段数字
USED_LAST=$(awk '{split($NF,a,"."); print a[4]}' "$PEERS_FILE" 2>/dev/null)

# 分配 IP
for i in $(seq 2 254); do
    if ! echo "$USED_LAST" | grep -q "^$i$"; then
        CLIENT_IP="10.0.10.$i"
        break
    fi
done

if [ -z "$CLIENT_IP" ]; then
    echo "❌ 无可用 IP"
    exit 1
fi

# 生成「本客户端」密钥对（与服务端 WG_PUBLIC_KEY 无关：那是路由器公钥，写在下面 [Peer]）
# CLIENT_PRIV → [Interface] PrivateKey；CLIENT_PUB → 路由器上 wg set peer <CLIENT_PUB> 用
CLIENT_PRIV=$(wg genkey)
CLIENT_PUB=$(echo "$CLIENT_PRIV" | wg pubkey)
PRESHARED=$(wg genpsk)

# 生成客户端配置文件
cat > "$CLIENT_CONF" <<EOF2
[Interface]
PrivateKey = $CLIENT_PRIV
Address = ${CLIENT_IP}/24
DNS = 192.168.5.27
MTU = 1340

[Peer]
PublicKey = $SERVER_PUBKEY
PresharedKey = $PRESHARED
Endpoint = $WG_SERVER
#全流量
#AllowedIPs = 0.0.0.0/0, ::/0
# 配置全流量，兼容安卓
#AllowedIPs = 0.0.0.0/1, 128.0.0.0/1, ::/0
# 配置内网、vpn  走wireguard 流量
AllowedIPs = 10.0.10.0/24, 192.168.5.0/24

PersistentKeepalive = 25
EOF2

# 将 peer 加到服务器接口：容器使用 --network=host 时与宿主机同一网络命名空间，wg 即操作宿主机接口；另需 cap NET_ADMIN
if command -v wg >/dev/null 2>&1 && wg show "$WG_INTERFACE" >/dev/null 2>&1; then
    TMP_PSK=$(mktemp)
    echo "$PRESHARED" > "$TMP_PSK"
    if wg set "$WG_INTERFACE" peer "$CLIENT_PUB" preshared-key "$TMP_PSK" allowed-ips "${CLIENT_IP}/32"; then
        rm -f "$TMP_PSK"
        echo "📡 已添加到接口: $WG_INTERFACE（宿主机已许可该 peer）"
    else
        rm -f "$TMP_PSK"
        echo "⚠️ wg set 失败：请为容器增加权限 --cap-add=NET_ADMIN，并确认使用 --network=host。conf 已写入 $CLIENT_CONF ，可登录宿主机按其中 [Peer] 手动执行 wg set。"
    fi
else
    echo "⚠️ 未检测到接口 $WG_INTERFACE。若要在容器内完成「宿主机许可」，请用 --network=host 启动，且 -e WG_INTERFACE 与宿主机 wg 接口名一致；并设置 WG_PUBLIC_KEY。否则仅生成本地 conf / peers.list。"
fi

# 添加新客户端到 peers.list（名字、PubKey、IP），末尾追加
TMP_PEERS=$(mktemp)
[ -f "$PEERS_FILE" ] && cat "$PEERS_FILE" >> "$TMP_PEERS"

# 检查是否已经存在（通过 PubKey 判断）
grep -q "$CLIENT_PUB" "$TMP_PEERS" 2>/dev/null || echo "0. $NAME $CLIENT_PUB $CLIENT_IP" >> "$TMP_PEERS"

# 重新排序序号，只修改第一列数字
awk '{sub(/^[0-9]+\./, NR"."); print}' "$TMP_PEERS" > "$PEERS_FILE"
rm -f "$TMP_PEERS"

echo "✅ 客户端配置已生成: $CLIENT_CONF"
echo "🔑 分配IP: ${CLIENT_IP}"
