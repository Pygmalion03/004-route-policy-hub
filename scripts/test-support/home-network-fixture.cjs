// Synthetic test material only. Addresses are documentation ranges, never real nodes.
const draft = {
  version: 1, updatedAt: null,
  lanCidr: '192.168.50.0/24', nasIp: '192.168.50.2', routerIp: '192.168.50.1',
  lanInterface: 'eth0', laVpsId: 'la', sgVpsId: 'sg', sgDirectFallback: false,
  claude: { tailscaleIp: '100.100.10.20', user: 'developer', workspace: '/home/developer/projects' },
  devices: [
    { name: 'Mac', ip: '192.168.50.10', mac: '02:00:00:00:00:10', profile: 'fixed-la' },
    { name: 'iPhone', ip: '192.168.50.11', mac: '02:00:00:00:00:11', profile: 'fixed-la' },
    { name: 'Windows', ip: '192.168.50.12', mac: '02:00:00:00:00:12', profile: 'split-sg' },
    { name: 'Android', ip: '192.168.50.13', mac: '02:00:00:00:00:13', profile: 'split-sg' },
    { name: 'TV', ip: '', mac: '', profile: 'router-direct' },
  ],
};
const vpsNodes = [
  { id: 'la', name: 'Los Angeles (test)', node: { name: 'LA', type: 'hysteria2', server: '192.0.2.10', port: 443, password: 'fixture-la', sni: 'la.example.test' } },
  { id: 'sg', name: 'Singapore (test)', node: { name: 'SG', type: 'hysteria2', server: '192.0.2.20', port: 443, password: 'fixture-sg', sni: 'sg.example.test' } },
];
const policy = { version: 1, updatedAt: '2026-11-16T00:00:00Z', policies: [
  { id: 'direct', name: 'Direct fixture', kind: 'website', enabled: true, action: 'DIRECT', matchers: [{ type: 'DOMAIN-SUFFIX', value: 'example.cn' }, { type: 'PROCESS-NAME', value: 'UURemote' }] },
  { id: 'proxy', name: 'Proxy fixture', kind: 'website', enabled: true, action: 'PROXY', matchers: [{ type: 'DOMAIN-SUFFIX', value: 'example.org' }] },
] };
module.exports = { draft, vpsNodes, policy };
