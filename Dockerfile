FROM node:18-alpine

# add-client.sh / delete-client.sh 需在容器内调用 wg，与宿主机共享网络命名空间时可操作宿主机上的 WireGuard 接口
RUN apk add --no-cache wireguard-tools 

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制应用代码
COPY . .

# 创建数据目录与脚本目录
RUN mkdir -p /app/data /app/script && chmod +x /app/script/*.sh 2>/dev/null || true

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]

