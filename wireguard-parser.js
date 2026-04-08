const fs = require('fs');
const path = require('path');
const ini = require('ini');

/**
 * 解析 WireGuard 配置文件
 * @param {string} filePath - 配置文件路径
 * @returns {object} 解析后的配置对象
 */
function parseWireGuardConfig(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const config = ini.parse(content);
  
  return config;
}

/**
 * 将 WireGuard 配置转换为 Clash 代理格式
 * @param {object} wgConfig - WireGuard 配置对象
 * @param {string} name - 代理名称
 * @param {number} mtu - MTU 值（从环境变量）
 * @param {array} dns - DNS 服务器列表（从环境变量）
 * @returns {object} Clash 代理配置
 */
function convertToClashProxy(wgConfig, name, mtu, dns) {
  const interfaceConfig = wgConfig.Interface;
  const peerConfig = wgConfig.Peer;
  
  // 解析 Endpoint (格式: server:port)
  const [server, port] = peerConfig.Endpoint.split(':');
  
  // 固定使用 0.0.0.0/0，不使用配置文件中的 AllowedIPs
  const allowedIPs = ['0.0.0.0/0'];
  
  // 解析 Address (格式: IP/CIDR)
  const address = interfaceConfig.Address.split('/')[0];
  
  return {
    name: name,
    type: 'wireguard',
    ip: address,
    'private-key': interfaceConfig.PrivateKey,
    peers: [
      {
        server: server,
        port: parseInt(port),
        'public-key': peerConfig.PublicKey,
        'pre-shared-key': peerConfig.PresharedKey,
        'allowed-ips': allowedIPs
      }
    ],
    udp: true,
    mtu: mtu,
    'remote-dns-resolve': true,
    dns: dns
  };
}

/**
 * 读取 conf 文件夹下所有 .conf 文件
 * @param {string} confDir - conf 文件夹路径
 * @returns {object} 文件名到配置对象的映射
 */
function loadAllWireGuardConfigs(confDir) {
  const configs = {};
  
  if (!fs.existsSync(confDir)) {
    console.warn(`配置目录不存在: ${confDir}`);
    return configs;
  }
  
  const files = fs.readdirSync(confDir);
  
  files.forEach(file => {
    if (path.extname(file) === '.conf') {
      const name = path.basename(file, '.conf');
      const filePath = path.join(confDir, file);
      
      try {
        configs[name] = parseWireGuardConfig(filePath);
        console.log(`已加载配置: ${name}`);
      } catch (error) {
        console.error(`解析配置文件失败 ${file}:`, error.message);
      }
    }
  });
  
  return configs;
}

module.exports = {
  parseWireGuardConfig,
  convertToClashProxy,
  loadAllWireGuardConfigs
};

