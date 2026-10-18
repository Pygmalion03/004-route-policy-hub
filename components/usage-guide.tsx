import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

const questions = [
  { title: '日常怎么切换？', answer: 'Clash 保持启用日常订阅，在「使用方案」选择机场＋Webshare、VPS＋Webshare、只用 VPS 或只用机场。需要机场时，到「机场节点」选择带机场名称的地区节点；只有一台 VPS 时不需要再选。网页的卡片是使用说明，不会遥控本机切换。' },
  { title: '换地区，固定 IP 会跟着变吗？', answer: '两个 Webshare 方案的最终出口都是 Webshare，切换机场地区不会改变它。只用机场时，出口是所选机场节点；只用 VPS 时，出口是 VPS。' },
  { title: '更换后怎样直接用？', answer: '到「日常网络」选择要更换的连接，填入新参数并保存发布；然后到 Clash 订阅页刷新「日常网络 · 网站管理」。订阅地址不变，不需要重新导入。后续刷新会保留有效的方案和节点选择，原节点被移除时需重新选择。' },
  { title: '网站显示已发布，就是电脑能用了？', answer: '不是。已发布表示 NAS 已保存并提供新订阅；Clash 需刷新后应用，实际出口与目标服务需从本机测试。网站没有连接本机 Clash，不会把发布状态显示成实测通过。AI 接口的 401 也不代表账号登录或生成成功。' },
  { title: 'Direct 和 Backbone 还要每天选吗？', answer: '不用。在更换 Webshare 时，按官网复制对应方式的参数，选定本次使用的接入方式。发布后两个 Webshare 方案共用此选择，日常只选使用方案即可。' },
  { title: '机场订阅更新失败怎么办？', answer: '已缓存的节点继续保留。到机场官网复制有效的新 Clash / Mihomo 订阅，在原机场条目替换地址。新地址下载失败时不会替换旧配置；读取成功也不等于每个节点实际可用。' },
  { title: '断线会自动换出口吗？', answer: '各方案没有设置其他出口或直连作为故障备用，所选线路失败时请求失败。现有 AI 端口 17897 跟随日常方案。Claude 专用端口 17997 独立固定出口，不使用国内直连清单；请通过专用启动器运行 Claude Code，代理不可用或出口不符时停止启动。普通启动的程序不受启动器限制。' },
  { title: '网站和配置放在哪里？', answer: '应用与数据在你的 NAS；Cloudflare 提供域名、HTTPS、Tunnel 和本人登录保护。NAS 停机时无法更新，Clash 已下载的配置仍留在本机。国内直连规则约五分钟获取更新；连接参数更换后请立即刷新订阅。' },
];

export function UsageGuide() {
  return <section className="rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="usage-heading">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="usage-heading" className="text-lg font-semibold">使用时的几个问题</h2>
      <Link href="/connections" className="text-sm text-primary hover:underline">去管理日常网络 →</Link>
    </div>
    <div className="divide-y divide-border">
      {questions.map(({ title, answer }) => <details key={title} className="group py-1">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">{title}<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
        <p className="pb-4 pr-6 text-sm leading-7 text-muted-foreground">{answer}</p>
      </details>)}
    </div>
  </section>;
}
