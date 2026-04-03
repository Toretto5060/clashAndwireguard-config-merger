const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 配置文件路径
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, 'data', 'config.json');

function newProfileId() {
  return crypto.randomUUID ? crypto.randomUUID() : `wg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeWgProfile(p, index) {
  const dns = Array.isArray(p.wgDns) && p.wgDns.length > 0
    ? p.wgDns.map(d => (typeof d === 'string' ? d.trim() : '')).filter(Boolean)
    : ['8.8.8.8'];
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newProfileId(),
    configName: typeof p.configName === 'string' ? p.configName.trim() : '',
    wgGroupName: (p.wgGroupName != null && String(p.wgGroupName).trim() !== '')
      ? String(p.wgGroupName).trim()
      : '🏠 Home',
    wgMtu: typeof p.wgMtu === 'number' && !Number.isNaN(p.wgMtu) ? p.wgMtu : 1340,
    wgDns: dns.length ? dns : ['8.8.8.8'],
    includeDirect: p.includeDirect !== false
  };
}

/**
 * 旧版单组字段 -> wgProfiles
 */
function migrateConfig(raw) {
  const urls = Array.isArray(raw.configUrls) ? raw.configUrls : [];
  const rules = Array.isArray(raw.prependRules) ? raw.prependRules : [
    'IP-CIDR,192.168.0.0/16,🏠 Home',
    'IP-CIDR,10.0.0.0/8,🏠 Home',
    'DOMAIN-KEYWORD,local,🏠 Home'
  ];

  if (Array.isArray(raw.wgProfiles) && raw.wgProfiles.length > 0) {
    return {
      configUrls: urls,
      prependRules: rules,
      wgProfiles: raw.wgProfiles.map((p, i) => normalizeWgProfile(p, i))
    };
  }

  return {
    configUrls: urls,
    prependRules: rules,
    wgProfiles: [
      normalizeWgProfile({
        id: 'wg-migrated',
        configName: '',
        wgGroupName: raw.wgGroupName,
        wgMtu: raw.wgMtu,
        wgDns: raw.wgDns,
        includeDirect: true
      }, 0)
    ]
  };
}

// 默认配置
const DEFAULT_CONFIG = migrateConfig({
  configUrls: [],
  prependRules: [
    'IP-CIDR,192.168.0.0/16,🏠 Home',
    'IP-CIDR,10.0.0.0/8,🏠 Home',
    'DOMAIN-KEYWORD,local,🏠 Home'
  ],
  wgProfiles: [
    {
      id: 'wg-default-1',
      configName: '',
      wgGroupName: '🏠 Home',
      wgMtu: 1340,
      wgDns: ['8.8.8.8'],
      includeDirect: true
    }
  ]
});

/**
 * 确保配置文件目录存在
 */
function ensureConfigDir() {
  const configDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`创建配置目录: ${configDir}`);
  }
}

/**
 * 读取配置文件
 * @returns {object} 配置对象
 */
function loadConfig() {
  try {
    ensureConfigDir();
    
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const raw = JSON.parse(data);
      const legacy = !Array.isArray(raw.wgProfiles) || raw.wgProfiles.length === 0;
      const config = migrateConfig(raw);
      console.log('已加载配置文件');
      if (legacy) {
        saveConfig(config);
      }
      return config;
    } else {
      console.log('配置文件不存在，使用默认配置');
      saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  } catch (error) {
    console.error('读取配置文件失败:', error.message);
    return DEFAULT_CONFIG;
  }
}

/**
 * 保存配置文件
 * @param {object} config - 配置对象
 * @returns {boolean} 是否保存成功
 */
function saveConfig(config) {
  try {
    ensureConfigDir();
    
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_FILE, data, 'utf-8');
    console.log('配置已保存');
    return true;
  } catch (error) {
    console.error('保存配置文件失败:', error.message);
    return false;
  }
}

/**
 * 验证配置
 * @param {object} config - 配置对象
 * @returns {object} { valid: boolean, errors: [] }
 */
function validateConfig(config) {
  const errors = [];

  if (!Array.isArray(config.configUrls)) {
    errors.push('configUrls 必须是数组');
  }

  if (!Array.isArray(config.prependRules)) {
    errors.push('prependRules 必须是数组');
  }

  if (!Array.isArray(config.wgProfiles) || config.wgProfiles.length === 0) {
    errors.push('wgProfiles 必须至少包含一组 WireGuard 配置');
  } else {
    const names = new Set();
    const confNames = new Set();

    config.wgProfiles.forEach((p, i) => {
      const prefix = `wgProfiles[${i}]`;
      if (typeof p.wgGroupName !== 'string' || p.wgGroupName.trim() === '') {
        errors.push(`${prefix}.wgGroupName 不能为空`);
      } else {
        const gn = p.wgGroupName.trim();
        if (names.has(gn)) {
          errors.push(`代理组名称重复: ${gn}`);
        }
        names.add(gn);
      }
      if (typeof p.wgMtu !== 'number' || p.wgMtu < 1 || p.wgMtu > 1500) {
        errors.push(`${prefix}.wgMtu 必须是 1-1500 之间的数字`);
      }
      if (!Array.isArray(p.wgDns) || p.wgDns.length === 0) {
        errors.push(`${prefix}.wgDns 必须是非空数组`);
      } else {
        const dnsOk = p.wgDns.some(d => typeof d === 'string' && d.trim() !== '');
        if (!dnsOk) {
          errors.push(`${prefix}.wgDns 至少填写一个 DNS`);
        }
      }
      if (p.includeDirect != null && typeof p.includeDirect !== 'boolean') {
        errors.push(`${prefix}.includeDirect 必须是布尔值`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  validateConfig,
  DEFAULT_CONFIG,
  migrateConfig,
  normalizeWgProfile,
  newProfileId
};

