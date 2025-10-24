const express = require('express');
const path = require('path');
const yaml = require('js-yaml');
const { loadAllWireGuardConfigs, convertToClashProxy } = require('./wireguard-parser');
const { fetchAndMergeConfigs, appendWireGuardConfig } = require('./config-merger');

const app = express();
const PORT = process.env.PORT || 3000;

// 从环境变量读取配置
const CONFIG_URLS = process.env.CONFIG_URLS ? process.env.CONFIG_URLS.split(',') : [];
const CONF_DIR = process.env.CONF_DIR || path.join(__dirname, 'conf');
const WG_MTU = parseInt(process.env.WG_MTU || '1340');
const WG_DNS = process.env.WG_DNS ? process.env.WG_DNS.split(',') : ['8.8.8.8'];
const GROUP_NAME = process.env.WG_GROUP_NAME || '🏠 回家';

// 规则配置（从环境变量读取或使用默认值）
const DEFAULT_RULES = [
  'IP-CIDR,192.168.5.0/24,🏠 回家',
  'IP-CIDR,10.0.10.0/24,🏠 回家',
  'DOMAIN-KEYWORD,lybaby,🏠 回家'
];
const PREPEND_RULES = process.env.PREPEND_RULES 
  ? process.env.PREPEND_RULES.split(',') 
  : DEFAULT_RULES;

// 在启动时加载所有 WireGuard 配置
let wireguardConfigs = {};

/**
 * 重新排序配置对象的键，确保 proxies、proxy-groups、rules 在最后
 * 保持原配置中其他字段的原有顺序
 */
function reorderConfigKeys(config) {
  const ordered = {};
  const keyFields = ['proxies', 'proxy-groups', 'rules'];
  
  // 先添加所有非关键字段（保持原有顺序）
  Object.keys(config).forEach(key => {
    if (!keyFields.includes(key)) {
      ordered[key] = config[key];
    }
  });
  
  // 最后按顺序添加关键字段
  keyFields.forEach(key => {
    if (config.hasOwnProperty(key)) {
      ordered[key] = config[key];
    }
  });
  
  return ordered;
}

/**
 * 格式化订阅信息为响应头格式（使用原始字节数和时间戳）
 */
function formatSubscriptionHeader(info) {
  const parts = [];
  
  // 使用原始字节数，不是格式化后的字符串
  if (info.upload !== undefined) parts.push(`upload=${info.upload}`);
  if (info.download !== undefined) parts.push(`download=${info.download}`);
  if (info.total !== undefined) parts.push(`total=${info.total}`);
  if (info.expire !== undefined) parts.push(`expire=${info.expire}`);
  
  return parts.join('; ');
}

/**
 * 生成所有订阅源信息的 YAML 注释
 */
function generateAllSubscriptionComment(allSubscriptionInfos) {
  const lines = [];
  lines.push('# ========================================');
  lines.push('# 订阅信息');
  lines.push('# ========================================');
  
  allSubscriptionInfos.forEach((info, index) => {
    lines.push(`# 订阅源 ${index + 1}: ${info.url}`);
    
    if (info.uploadFormatted) lines.push(`#   上传流量: ${info.uploadFormatted}`);
    if (info.downloadFormatted) lines.push(`#   下载流量: ${info.downloadFormatted}`);
    if (info.usedFormatted) lines.push(`#   已用流量: ${info.usedFormatted}`);
    if (info.totalFormatted) lines.push(`#   总流量: ${info.totalFormatted}`);
    if (info.remainingFormatted) lines.push(`#   剩余流量: ${info.remainingFormatted}`);
    if (info.expireFormatted) lines.push(`#   到期时间: ${info.expireFormatted}`);
    
    if (index < allSubscriptionInfos.length - 1) {
      lines.push('#   ---');
    }
  });
  
  lines.push('# ========================================');
  lines.push('');
  
  return lines.join('\n');
}

function loadConfigs() {
  console.log('\n========================================');
  console.log('正在加载 WireGuard 配置...');
  console.log('配置目录:', CONF_DIR);
  console.log('========================================\n');
  
  wireguardConfigs = loadAllWireGuardConfigs(CONF_DIR);
  
  console.log('\n========================================');
  console.log(`已加载 ${Object.keys(wireguardConfigs).length} 个 WireGuard 配置`);
  console.log('配置列表:', Object.keys(wireguardConfigs).join(', '));
  console.log('========================================\n');
}

// 初始加载配置
loadConfigs();

// 定期重新加载配置（每10分钟）
setInterval(loadConfigs, 10 * 60 * 1000);

// 中间件：日志
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    configs: Object.keys(wireguardConfigs),
    configCount: Object.keys(wireguardConfigs).length,
    configUrls: CONFIG_URLS,
    mtu: WG_MTU,
    dns: WG_DNS
  });
});

// 重新加载配置端点
app.post('/reload', (req, res) => {
  try {
    loadConfigs();
    res.json({
      success: true,
      message: '配置已重新加载',
      configs: Object.keys(wireguardConfigs)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 主要配置端点
app.get('/:configName', async (req, res) => {
  try {
    const configName = req.params.configName;
    
    console.log(`\n请求配置: ${configName}`);
    
    // 检查配置是否存在
    if (!wireguardConfigs[configName]) {
      console.error(`配置不存在: ${configName}`);
      return res.status(404).json({
        error: '配置不存在',
        available: Object.keys(wireguardConfigs)
      });
    }
    
    // 从远程 URL 拉取并合并基础配置
    console.log('正在拉取基础配置...');
    const { config: baseConfig, subscriptionInfo, allSubscriptionInfos } = await fetchAndMergeConfigs(CONFIG_URLS);
    
    // 将 WireGuard 配置转换为 Clash 格式
    const wgConfig = wireguardConfigs[configName];
    const wgProxy = convertToClashProxy(wgConfig, 'WireGuard', WG_MTU, WG_DNS);
    
    console.log(`WireGuard 代理配置:`, JSON.stringify(wgProxy, null, 2));
    
    // 追加 WireGuard 配置
    let finalConfig = appendWireGuardConfig(
      baseConfig,
      wgProxy,
      GROUP_NAME,
      PREPEND_RULES
    );
    
    // 重新排序配置，确保基础配置在前
    finalConfig = reorderConfigKeys(finalConfig);
    
    // 设置订阅信息响应头（使用第一个订阅源）
    if (subscriptionInfo) {
      res.set('Subscription-Userinfo', formatSubscriptionHeader(subscriptionInfo));
      console.log('第一个订阅源信息:', subscriptionInfo);
    }
    
    // 根据 Accept 头返回相应格式
    const acceptHeader = req.get('Accept') || '';
    
    if (acceptHeader.includes('application/json')) {
      res.json(finalConfig);
    } else {
      // 默认返回 YAML，添加所有订阅源信息注释
      let yamlConfig = yaml.dump(finalConfig, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      
      // 在 YAML 开头添加所有订阅源信息注释
      if (allSubscriptionInfos.length > 0) {
        const infoComment = generateAllSubscriptionComment(allSubscriptionInfos);
        yamlConfig = infoComment + yamlConfig;
      }
      
      res.type('text/yaml').send(yamlConfig);
    }
    
    console.log(`✓ 成功返回配置: ${configName}\n`);
    
  } catch (error) {
    console.error('处理请求时出错:', error);
    res.status(500).json({
      error: '处理请求时出错',
      message: error.message
    });
  }
});

// 列出所有可用配置
app.get('/', (req, res) => {
  res.json({
    message: 'WireGuard 配置合并服务',
    usage: '访问 /:configName 获取对应的配置',
    available_configs: Object.keys(wireguardConfigs),
    endpoints: {
      health: '/health',
      reload: '/reload (POST)',
      config: '/:configName'
    },
    environment: {
      config_urls: CONFIG_URLS,
      conf_dir: CONF_DIR,
      mtu: WG_MTU,
      dns: WG_DNS,
      group_name: GROUP_NAME
    }
  });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log(`✓ 服务器已启动`);
  console.log(`✓ 监听端口: ${PORT}`);
  console.log(`✓ 可用配置: ${Object.keys(wireguardConfigs).length} 个`);
  console.log('\n环境变量配置:');
  console.log(`  - CONFIG_URLS: ${CONFIG_URLS.length > 0 ? CONFIG_URLS.join(', ') : '未配置'}`);
  console.log(`  - CONF_DIR: ${CONF_DIR}`);
  console.log(`  - WG_MTU: ${WG_MTU}`);
  console.log(`  - WG_DNS: ${WG_DNS.join(', ')}`);
  console.log(`  - WG_GROUP_NAME: ${GROUP_NAME}`);
  console.log('========================================\n');
});

// 优雅退出
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n收到 SIGINT 信号，正在关闭服务器...');
  process.exit(0);
});

