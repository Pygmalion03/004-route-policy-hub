// Route Policy Hub: this Mac defaults to proxy; remote desktop stays direct.
function main(config) {
  const directProcesses = [
    'UURemote', 'UURemoteDaemon', 'UURemoteService', 'UURemoteServer',
    'Hihonornote', 'HnOfficeCenter', 'HnMirror', 'HonorConnect Helper',
    'HonorConnect Helper (GPU)', 'HonorConnect Helper (Renderer)',
    'HonorConnect Helper (Plugin)', 'HonorConnect Login Helper',
    'Tailscale', 'io.tailscale.ipn.macsys.network-extension',
  ].map(name => `PROCESS-NAME,${name},DIRECT`);
  config.mode = 'rule';
  config['find-process-mode'] = 'always';
  config.rules = [...directProcesses, ...(config.rules || []).filter(rule =>
    !/^RULE-SET,china-(domains|ips),/.test(rule) && !directProcesses.includes(rule)
  )];
  const dnsPolicy = config.dns?.['nameserver-policy'];
  if (dnsPolicy) {
    delete dnsPolicy['rule-set:hub-direct'];
    delete dnsPolicy['rule-set:hub-proxy'];
    delete dnsPolicy['rule-set:china-domains'];
  }
  return config;
}
