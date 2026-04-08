#!/bin/bash

# 构建脚本

echo "========================================="
echo "构建 WireGuard 配置合并服务 Docker 镜像"
echo "========================================="

# 镜像名称和标签
IMAGE_NAME="wireguard-config-merger"
IMAGE_TAG="latest"

# 构建镜像
echo ""
echo "正在构建镜像: ${IMAGE_NAME}:${IMAGE_TAG}"
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "✓ 镜像构建成功！"
    echo "========================================="
    echo ""
    echo "镜像信息："
    docker images | grep ${IMAGE_NAME}
    echo ""
    echo "运行容器示例："
    echo "docker run -d \\"
    echo "  --name wireguard-config-merger \\"
    echo "  -p 3000:3000 \\"
    echo "  -v \$(pwd)/conf:/app/conf:ro \\"
    echo "  -v \$(pwd)/data:/app/data \\"
    echo "  ${IMAGE_NAME}:${IMAGE_TAG}"
    echo ""
    echo "访问 http://localhost:3000 进入Web管理界面"
    echo ""
    echo "或使用 docker-compose："
    echo "docker-compose up -d"
    echo ""
else
    echo ""
    echo "========================================="
    echo "✗ 镜像构建失败！"
    echo "========================================="
    exit 1
fi

