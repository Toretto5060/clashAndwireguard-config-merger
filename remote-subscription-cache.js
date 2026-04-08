const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE =
  process.env.REMOTE_SUB_CACHE_FILE ||
  path.join(__dirname, 'data', 'remote-subscription-cache.json');

function urlsKey(urls) {
  const arr = (urls || []).filter(Boolean).map(String).sort();
  return crypto.createHash('sha256').update(JSON.stringify(arr)).digest('hex').slice(0, 32);
}

function loadRaw() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.warn('读取远程订阅缓存失败:', e.message);
  }
  return { entries: {} };
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/**
 * 读取与当前订阅 URL 列表匹配的上次成功拉取的远程合并结果
 */
function readStaleRemoteCache(urls) {
  const key = urlsKey(urls);
  const data = loadRaw();
  const e = data.entries && data.entries[key];
  if (!e || !e.config) {
    return null;
  }
  try {
    return {
      config: deepClone(e.config),
      allSubscriptionInfos: deepClone(e.allSubscriptionInfos || []),
      subscriptionInfo: e.subscriptionInfo ? deepClone(e.subscriptionInfo) : null,
      dataUpdatedAt: typeof e.dataUpdatedAt === 'number' ? e.dataUpdatedAt : null
    };
  } catch (err) {
    return null;
  }
}

/**
 * 在远程拉取全部成功合并后写入缓存。
 * 必须仅为 fetchAndMergeConfigs 的合并结果（不含本服务注入的 WireGuard / 左侧路由规则），
 * 否则订阅端点每次会在已含注入内容的底稿上再追加，造成重复节点与重复规则。
 */
function writeRemoteCacheSuccess(urls, payload) {
  try {
    const key = urlsKey(urls);
    const data = loadRaw();
    if (!data.entries) data.entries = {};
    data.entries[key] = {
      config: deepClone(payload.config),
      allSubscriptionInfos: deepClone(payload.allSubscriptionInfos || []),
      subscriptionInfo: payload.subscriptionInfo ? deepClone(payload.subscriptionInfo) : null,
      dataUpdatedAt: payload.dataUpdatedAt
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('写入远程订阅缓存失败:', e.message);
  }
}

module.exports = {
  urlsKey,
  readStaleRemoteCache,
  writeRemoteCacheSuccess
};
