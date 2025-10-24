const express = require('express');
const path = require('path');
const yaml = require('js-yaml');
const { loadAllWireGuardConfigs, convertToClashProxy } = require('./wireguard-parser');
const { fetchAndMergeConfigs, appendWireGuardConfig } = require('./config-merger');
const { loadConfig, saveConfig, validateConfig } = require('./config-manager');

const app = express();
const PORT = process.env.PORT || 3000;
const CONF_DIR = process.env.CONF_DIR || path.join(__dirname, 'conf');

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 从配置文件加载配置
let appConfig = loadConfig();

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

// 配置管理API - 获取配置
app.get('/api/config', (req, res) => {
  res.json(appConfig);
});

// 配置管理API - 保存配置
app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    
    // 验证配置
    const validation = validateConfig(newConfig);
    if (!validation.valid) {
      return res.status(400).json({
        error: '配置验证失败',
        details: validation.errors
      });
    }
    
    // 保存配置
    if (saveConfig(newConfig)) {
      appConfig = newConfig;
      console.log('配置已更新');
      res.json({
        success: true,
        message: '配置保存成功'
      });
    } else {
      res.status(500).json({
        error: '保存配置失败'
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    configs: Object.keys(wireguardConfigs),
    configCount: Object.keys(wireguardConfigs).length,
    configUrls: appConfig.configUrls,
    mtu: appConfig.wgMtu,
    dns: appConfig.wgDns,
    groupName: appConfig.wgGroupName
  });
});

// 重新加载配置端点
app.post('/reload', (req, res) => {
  try {
    loadConfigs();
    appConfig = loadConfig(); // 重新加载应用配置
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
    const { config: baseConfig, subscriptionInfo, allSubscriptionInfos } = await fetchAndMergeConfigs(appConfig.configUrls);
    
    // 将 WireGuard 配置转换为 Clash 格式
    const wgConfig = wireguardConfigs[configName];
    const wgProxy = convertToClashProxy(wgConfig, 'WireGuard', appConfig.wgMtu, appConfig.wgDns);
    
    console.log(`WireGuard 代理配置:`, JSON.stringify(wgProxy, null, 2));
    
    // 追加 WireGuard 配置
    let finalConfig = appendWireGuardConfig(
      baseConfig,
      wgProxy,
      appConfig.wgGroupName,
      appConfig.prependRules
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

// 根路径重定向到配置页面
app.get('/', (req, res) => {
  // 如果是API请求，返回JSON
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      message: 'WireGuard 配置合并服务',
      usage: '访问 /:configName 获取对应的配置',
      available_configs: Object.keys(wireguardConfigs),
      endpoints: {
        webui: '/ (Web界面)',
        health: '/health',
        reload: '/reload (POST)',
        configApi: '/api/config (GET/POST)',
        config: '/:configName'
      },
      config: {
        config_urls: appConfig.configUrls,
        conf_dir: CONF_DIR,
        mtu: appConfig.wgMtu,
        dns: appConfig.wgDns,
        group_name: appConfig.wgGroupName
      }
    });
  }
  
  // 默认返回HTML配置页面
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log(`✓ 服务器已启动`);
  console.log(`✓ 监听端口: ${PORT}`);
  console.log(`✓ 可用配置: ${Object.keys(wireguardConfigs).length} 个`);
  console.log(`✓ Web管理界面: http://localhost:${PORT}`);
  console.log('\n当前配置:');
  console.log(`  - 订阅源: ${appConfig.configUrls.length > 0 ? appConfig.configUrls.length + ' 个' : '未配置'}`);
  console.log(`  - CONF_DIR: ${CONF_DIR}`);
  console.log(`  - WG_MTU: ${appConfig.wgMtu}`);
  console.log(`  - WG_DNS: ${appConfig.wgDns.join(', ')}`);
  console.log(`  - WG_GROUP_NAME: ${appConfig.wgGroupName}`);
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

