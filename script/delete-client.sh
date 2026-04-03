#!/bin/sh
# 默认路径按容器映射设计：/app/script/peers.list、/app/conf
# 在路由器本机直接运行时，可通过 PEERS_FILE、CONF_DIR 覆盖为 /etc/wireguard/script/peers.list、/etc/wireguard/conf
WG_INTERFACE="${WG_INTERFACE:-WG}"
PEERS_FILE="${PEERS_FILE:-/app/script/peers.list}"
CONF_DIR="${CONF_DIR:-/app/conf}"

NAME="$1"
if [ -z "$NAME" ]; then
  echo "❗ 用法: $0 <客户端名称>"
  exit 1
fi

if [ ! -f "$PEERS_FILE" ]; then
  echo "❌ peers.list 文件不存在: $PEERS_FILE"
  exit 1
fi

LINE=$(awk -v n="$NAME" '$2==n {print; exit}' "$PEERS_FILE")
if [ -z "$LINE" ]; then
  echo "❌ 未找到客户端: $NAME"
  exit 1
fi

PUB=$(echo "$LINE" | awk '{print $3}')

if [ -n "$PUB" ]; then
  wg set "$WG_INTERFACE" peer "$PUB" remove 2>/dev/null || true
fi

CONF_FILE="$CONF_DIR/${NAME}.conf"
if [ -f "$CONF_FILE" ]; then
  rm -f "$CONF_FILE"
fi

awk -v n="$NAME" '$2!=n {print}' "$PEERS_FILE" > "${PEERS_FILE}.tmp"
mv "${PEERS_FILE}.tmp" "$PEERS_FILE"

NUM=1
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  NAME2=$(echo "$line" | awk '{print $2}')
  PUB2=$(echo "$line" | awk '{print $3}')
  IP2=$(echo "$line" | awk '{print $4}')
  if [ -n "$IP2" ]; then
    echo "${NUM}. ${NAME2} ${PUB2} ${IP2}"
  else
    echo "${NUM}. ${NAME2} ${PUB2}"
  fi
  NUM=$((NUM+1))
done < "$PEERS_FILE" > "${PEERS_FILE}.tmp"
mv "${PEERS_FILE}.tmp" "$PEERS_FILE"

echo "✅ 客户端 $NAME 已删除，序号已重新整理。"
