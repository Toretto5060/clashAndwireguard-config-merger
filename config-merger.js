const axios = require('axios');
const yaml = require('js-yaml');

/**
 * 从 URL 拉取配置文件
 * @param {string} url - 配置文件 URL
 * @returns {Promise<object>} 配置对象和订阅信息
 */
async function fetchConfig(url) {
  try {
    console.log(`正在从 ${url} 拉取配置...`);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // 尝试解析为 YAML
    let config;
    try {
      config = yaml.load(response.data);
    } catch (e) {
      // 如果不是 YAML，尝试作为 JSON
      config = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }
    
    // 提取订阅信息
    const subscriptionInfo = extractSubscriptionInfo(response.headers);
    
    console.log(`成功拉取配置: ${url}`);
    if (subscriptionInfo) {
      console.log('订阅信息:', subscriptionInfo);
    }
    
    return { config, subscriptionInfo };
  } catch (error) {
    console.error(`拉取配置失败 ${url}:`, error.message);
    return null;
  }
}

/**
 * 从响应头提取订阅信息
 * @param {object} headers - HTTP 响应头
 * @returns {object|null} 订阅信息
 */
function extractSubscriptionInfo(headers) {
  const userInfo = headers['subscription-userinfo'];
  if (!userInfo) {
    return null;
  }
  
  const info = {};
  const parts = userInfo.split(';').map(p => p.trim());
  
  parts.forEach(part => {
    const [key, value] = part.split('=');
    if (key && value) {
      info[key.trim()] = parseInt(value.trim());
    }
  });
  
  // 保留原始字节数和时间戳，同时添加格式化信息用于显示
  const result = {
    raw: info // 保留原始数据
  };
  
  // 计算已用流量（用于显示）
  if (info.upload !== undefined && info.download !== undefined) {
    const uploadGB = (info.upload / (1024 * 1024 * 1024)).toFixed(2);
    const downloadGB = (info.download / (1024 * 1024 * 1024)).toFixed(2);
    const used = info.upload + info.download;
    const usedGB = (used / (1024 * 1024 * 1024)).toFixed(2);
    
    result.upload = info.upload;
    result.download = info.download;
    result.used = used; // 原始字节数
    result.uploadFormatted = `${uploadGB} GB`;
    result.downloadFormatted = `${downloadGB} GB`;
    result.usedFormatted = `${usedGB} GB`;
  }
  
  if (info.total !== undefined) {
    const totalGB = (info.total / (1024 * 1024 * 1024)).toFixed(2);
    result.total = info.total; // 原始字节数
    result.totalFormatted = `${totalGB} GB`;
    
    // 计算剩余
    if (info.upload !== undefined && info.download !== undefined) {
      const remainingBytes = info.total - info.upload - info.download;
      const remainingGB = (remainingBytes / (1024 * 1024 * 1024)).toFixed(2);
      result.remaining = remainingBytes;
      result.remainingFormatted = `${remainingGB} GB`;
    }
  }
  
  if (info.expire !== undefined) {
    const expireDate = new Date(info.expire * 1000);
    result.expire = info.expire; // 原始时间戳
    result.expireFormatted = expireDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }
  
  return Object.keys(result.raw).length > 0 ? result : null;
}

/**
 * 从多个 URL 拉取并合并配置
 * @param {array} urls - 配置文件 URL 数组
 * @returns {Promise<object>} 合并后的配置对象和订阅信息
 */
async function fetchAndMergeConfigs(urls) {
  const configs = [];
  const allSubscriptionInfos = [];
  
  for (const url of urls) {
    const result = await fetchConfig(url);
    if (result) {
      configs.push(result.config);
      if (result.subscriptionInfo) {
        // 添加订阅地址信息
        result.subscriptionInfo.url = url;
        allSubscriptionInfos.push(result.subscriptionInfo);
      }
    }
  }
  
  if (configs.length === 0) {
    console.warn('没有成功拉取任何配置');
    return {
      config: createEmptyConfig(),
      subscriptionInfo: null,
      allSubscriptionInfos: [],
      remoteFetchOk: false
    };
  }

  // 合并配置
  const mergedConfig = mergeConfigs(configs);

  // 第一个订阅源用于响应头
  const firstSubscriptionInfo = allSubscriptionInfos.length > 0 ? allSubscriptionInfos[0] : null;

  return {
    config: mergedConfig,
    subscriptionInfo: firstSubscriptionInfo,
    allSubscriptionInfos: allSubscriptionInfos,
    remoteFetchOk: true
  };
}

/**
 * 合并多个配置对象
 * @param {array} configs - 配置对象数组
 * @returns {object} 合并后的配置
 */
function mergeConfigs(configs) {
  const merged = {
    proxies: [],
    'proxy-groups': [],
    rules: []
  };
  
  configs.forEach(config => {
    if (config.proxies && Array.isArray(config.proxies)) {
      merged.proxies.push(...config.proxies);
    }
    
    if (config['proxy-groups'] && Array.isArray(config['proxy-groups'])) {
      merged['proxy-groups'].push(...config['proxy-groups']);
    }
    
    if (config.rules && Array.isArray(config.rules)) {
      merged.rules.push(...config.rules);
    }
    
    // 合并其他字段（如 dns, tun 等）
    Object.keys(config).forEach(key => {
      if (!['proxies', 'proxy-groups', 'rules'].includes(key) && !merged[key]) {
        merged[key] = config[key];
      }
    });
  });
  
  return merged;
}

/**
 * 创建空配置
 * @returns {object} 空配置对象
 */
function createEmptyConfig() {
  return {
    proxies: [],
    'proxy-groups': [],
    rules: []
  };
}

/**
 * 追加 WireGuard 配置到合并的配置中
 * @param {object} config - 基础配置
 * @param {object} wgProxy - WireGuard 代理配置
 * @param {string} groupName - 代理组名称
 * @param {array} rules - 规则数组
 * @returns {object} 追加后的配置
 */
function appendWireGuardConfig(config, wgProxy, groupName, rules) {
  // 深拷贝配置，避免修改原对象
  const newConfig = JSON.parse(JSON.stringify(config));
  
  // 添加代理节点
  if (!newConfig.proxies) {
    newConfig.proxies = [];
  }
  newConfig.proxies.push(wgProxy);
  
  // 添加代理组（添加到开头）
  if (!newConfig['proxy-groups']) {
    newConfig['proxy-groups'] = [];
  }
  
  const wgGroup = {
    name: groupName,
    type: 'select',
    proxies: [wgProxy.name]
  };
  newConfig['proxy-groups'].unshift(wgGroup);
  
  // 在规则开头添加规则
  if (!newConfig.rules) {
    newConfig.rules = [];
  }
  newConfig.rules.unshift(...rules);
  
  // // 确保 tun 配置存在
  // if (!newConfig.tun) {
  //   newConfig.tun = {
  //     enable: false,
  //     stack: 'gvisor',
  //     'auto-route': true,
  //     'strict-route': false,
  //     'auto-detect-interface': true,
  //     'dns-hijack': ['any:53']
  //   };
  // }
  
  return newConfig;
}

/**
 * 追加多组 WireGuard：每组一个代理节点 + 一个 select 代理组；规则共用 prependRules
 * @param {object[]} items - { wgProxy, groupName, includeDirect }
 */
function appendMultipleWireGuardProfiles(config, items, prependRules) {
  const newConfig = JSON.parse(JSON.stringify(config));
  const DIRECT_LABEL = '直连';

  if (!newConfig.proxies) newConfig.proxies = [];
  if (!newConfig['proxy-groups']) newConfig['proxy-groups'] = [];
  if (!newConfig.rules) newConfig.rules = [];

  // 用中文“直连”展示，但底层仍通过 DIRECT 实现
  const directAliasGroupExists = newConfig['proxy-groups'].some(g => g && g.name === DIRECT_LABEL);
  if (!directAliasGroupExists) {
    newConfig['proxy-groups'].push({
      name: DIRECT_LABEL,
      type: 'select',
      proxies: ['DIRECT']
    });
  }

  for (const item of items) {
    const { wgProxy, groupName, includeDirect } = item;
    newConfig.proxies.push(wgProxy);

    // 若基础配置中已存在同名代理组，则向其追加 WireGuard 节点，避免创建重复组导致 Clash 回环检测
    const existingGroup = newConfig['proxy-groups'].find(g => g && g.name === groupName);
    if (existingGroup) {
      if (!Array.isArray(existingGroup.proxies)) {
        existingGroup.proxies = [];
      }
      // 固定顺序：DIRECT 在前，WG 在后
      if (includeDirect && !existingGroup.proxies.includes(DIRECT_LABEL)) {
        existingGroup.proxies.unshift(DIRECT_LABEL);
      }
      if (!existingGroup.proxies.includes(wgProxy.name)) {
        existingGroup.proxies.push(wgProxy.name);
      }
      const directIndex = existingGroup.proxies.indexOf(DIRECT_LABEL);
      const wgIndex = existingGroup.proxies.indexOf(wgProxy.name);
      if (directIndex !== -1 && wgIndex !== -1 && directIndex > wgIndex) {
        existingGroup.proxies.splice(directIndex, 1);
        const newWgIndex = existingGroup.proxies.indexOf(wgProxy.name);
        existingGroup.proxies.splice(newWgIndex, 0, DIRECT_LABEL);
      }
    } else {
      const proxies = includeDirect ? [DIRECT_LABEL, wgProxy.name] : [wgProxy.name];
      newConfig['proxy-groups'].unshift({
        name: groupName,
        type: 'select',
        proxies
      });
    }
  }
  newConfig.rules.unshift(...prependRules);

  return newConfig;
}

module.exports = {
  fetchConfig,
  fetchAndMergeConfigs,
  mergeConfigs,
  createEmptyConfig,
  appendWireGuardConfig,
  appendMultipleWireGuardProfiles
};

