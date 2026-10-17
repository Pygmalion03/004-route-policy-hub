import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

const questions = [
  {
    title: '平时怎么切换机场和地区？',
    answer: 'Clash 保持启用「日常 · 域名管理 · Webshare」。先在「前置机场」选拼好连、雪山或新增的机场，再到对应的「机场名节点」组选择地区。网站维护参数，当前实际选择在 Clash 查看。',
  },
  {
    title: '前置机场只有两个，正常吗？',
    answer: '这里列的是已配置的机场，不是地区。每个机场里面还有自己的节点。需要第三家机场时，在「连接配置」添加名称和 Clash / Mihomo 订阅地址，保存后刷新 Clash 这条日常订阅。',
  },
  {
    title: '选了日本或韩国，Webshare 也会换地区吗？',
    answer: '不会。地区选择改变的是到 Webshare 的前置路径，可能影响速度和稳定性；最终出口由你购买的 Webshare IP 决定。想改变最终出口，需要更换 Webshare IP 并更新这里的参数。',
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
    answer: '先确认检测到的是 Webshare 出口，再结合目标服务实际访问、连续请求耗时和超时情况判断。评分和 ASN 都不能替代使用测试；网页没有持续监测你的出口，也不会自动换 IP。换后用同样的方法比较，再决定保留哪一个。',
  },
  {
    title: '连接中断时会自动直连吗？',
    answer: '这份日常配置的默认流量和固定 AI 端口都指向 Webshare，没有设置机场或直连作为备用。Webshare 不可用时请求会失败；你添加的直连规则、本地网络和管理域名按各自规则访问。退出 Clash、切换到别的订阅或修改系统网络后的行为，不由网站控制。',
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
