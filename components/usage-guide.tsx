import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

const questions = [
  {
    title: '平时怎么切换机场和地区？',
    answer: 'Clash 保持启用日常订阅，先在「出口模式」选择固定 Webshare、VPS 直出或机场直出。使用 Webshare 时，再在「前置线路」选择机场或自建 VPS；机场的地区和具体 VPS 节点在对应组里选。网站维护参数，实际选择在 Clash 查看。',
  },
  {
    title: '不用机场，只用 VPS 可以吗？',
    answer: '可以，先在 VPS 部署代理服务并完成真实请求验证，再把节点链接加入连接配置。VPS 直出无需机场或 Webshare；VPS 加 Webshare 则在固定出口模式下，把前置线路改为自建 VPS。只买好主机、拿到 SSH 登录信息，还没有可用的代理节点。',
  },
  {
    title: '选了日本或韩国，Webshare 也会换地区吗？',
    answer: '在固定 Webshare 模式下不会，地区或 VPS 只改变前置路径。选择 VPS 直出时，最终出口改为 VPS；选择机场直出时，最终出口改为所选机场节点。这些都需要你手动切换，不会在故障时自动发生。',
  },
  {
    title: '换 Webshare IP 后要改什么？',
    answer: '在官网分别查看 Direct 和 Backbone 的当前参数，再到「连接配置」编辑对应的地址、协议、端口和用户名；密码变化时一起填写。不同模式的参数要按官网分别填写。保存后，在 Clash 的订阅页刷新「日常 · 域名管理 · Webshare」，再确认实际出口与目标服务访问。',
  },
  {
    title: '保存后多久生效？',
    answer: '连接参数保存到 NAS 后，需要 Clash 再下载订阅才生效。当前这台 Mac 设置为每天自动下载，改参数后请手动刷新。机场节点缓存在下载订阅时检查，距上次更新不足一小时会复用缓存。分流规则由 Clash 约每五分钟获取一次；“已保存”不代表客户端已经应用。',
  },
  {
    title: '机场提示更新失败，还能用吗？',
    answer: '有已保存的节点时会继续使用它们，但不代表以后一直可用。先到机场官网确认订阅地址和套餐；把有效的新订阅填到连接配置，服务器成功下载后才替换原节点。订阅下载失败和节点连接失败是两件事。',
  },
  {
    title: '网站在 Cloudflare，还是 NAS？',
    answer: '页面、配置和规则数据运行并保存在你的 NAS；Cloudflare 提供域名、HTTPS、Tunnel 和本人登录保护。NAS 停机时网站不能更新配置，Clash 已下载的配置仍留在本机。当前只做电脑配置，NAS 旁路由另行安排。',
  },
  {
    title: 'IP 风险评分高，要马上换吗？',
    answer: '先确认检测到的是当前所选模式的最终出口，再结合目标服务实际访问、连续请求耗时和超时情况判断。评分和 ASN 都不能替代使用测试；网页没有持续监测你的出口，也不会自动换 IP。换后用同样的方法比较，再决定保留哪一个。',
  },
  {
    title: '连接中断时会自动直连吗？',
    answer: '默认流量和 AI 专用端口跟随你手动选择的「出口模式」，初始为 Webshare；各模式都没有配置直连或其他出口作为故障备用。所选线路不可用时请求会失败。你添加的直连规则、本地网络和管理域名按各自规则访问；退出 Clash 或切换到别的订阅后的行为，不由网站控制。',
  },
];

export function UsageGuide() {
  return <section className="rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="usage-heading">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="usage-heading" className="text-lg font-semibold">之前的问题，一处说清楚</h2>
      <Link href="/connections" className="text-sm text-primary hover:underline">去维护连接参数 →</Link>
    </div>
    <div className="divide-y divide-border">
      {questions.map(({ title, answer }) => <details key={title} className="group py-1">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">{title}<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
        <p className="pb-4 pr-6 text-sm leading-7 text-muted-foreground">{answer}</p>
      </details>)}
    </div>
  </section>;
}
