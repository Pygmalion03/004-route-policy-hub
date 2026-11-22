export type HomeProfile = 'fixed-la' | 'split-sg' | 'router-direct';
export type HomeDraft = {
  version: 1;
  updatedAt: string | null;
  lanCidr: string;
  nasIp: string;
  routerIp: string;
  lanInterface: string;
  laVpsId: string;
  sgVpsId: string;
  sgDirectFallback: boolean;
  claude: { tailscaleIp: string; user: string; workspace: string };
  devices: { name: string; ip: string; mac: string; profile: HomeProfile }[];
};
export const homeProfiles = [
  { value: 'fixed-la', label: 'LA 固定出口', detail: '公网全部经 LA；LA 或 NAS 不可用时停止公网连接。必要局域网保留。' },
  { value: 'split-sg', label: 'SG 分流', detail: '直连规则走家庭宽带，其他经 SG；可选择 SG 故障时直连保底。NAS 故障需手动恢复网关。' },
  { value: 'router-direct', label: '中兴路由器直连', detail: '使用原网关与家庭宽带，不经过 NAS，不受两条 VPS 线路影响。' },
] as const;
export function emptyHomeDraft(): HomeDraft {
  return {
    version: 1, updatedAt: null, lanCidr: '', nasIp: '', routerIp: '', lanInterface: '',
    laVpsId: '', sgVpsId: '', sgDirectFallback: false,
    claude: { tailscaleIp: '', user: '', workspace: '' },
    devices: [
      { name: 'Mac', ip: '', mac: '', profile: 'fixed-la' },
      { name: 'iPhone', ip: '', mac: '', profile: 'fixed-la' },
      { name: 'Windows', ip: '', mac: '', profile: 'split-sg' },
      { name: '安卓', ip: '', mac: '', profile: 'split-sg' },
    ],
  };
}
export function simulateHomeRoute(
  draft: HomeDraft, profile: HomeProfile, destination: 'lan' | 'public',
  health: { nas: boolean; la: boolean; sg: boolean }, match: 'direct' | 'proxy' | 'default' = 'default',
) {
  if (destination === 'lan') return { exit: 'lan', manualGatewayChange: false };
  if (profile === 'router-direct') return { exit: 'broadband', manualGatewayChange: false };
  if (!health.nas) return { exit: 'blocked', manualGatewayChange: profile === 'split-sg' };
  if (profile === 'fixed-la') return { exit: health.la ? 'la' : 'blocked', manualGatewayChange: false };
  return { exit: match === 'direct' || (!health.sg && draft.sgDirectFallback) ? 'broadband' : health.sg ? 'sg' : 'blocked', manualGatewayChange: false };
}
