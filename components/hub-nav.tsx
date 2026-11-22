import Link from 'next/link';
import { ArrowUpRight, Network } from 'lucide-react';

export function HubNav({ active }: { active: 'overview' | 'claude' | 'connections' | 'policies' | 'home-network' }) {
  return <header className="border-b border-border bg-card/90">
    <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-5 py-4 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
      <Link href="/" className="flex w-fit items-center gap-2.5 font-semibold tracking-tight">
        <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Network aria-hidden="true" className="size-4" /></span>
        网络管理<span className="ml-1 rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">私人</span>
      </Link>
      <nav aria-label="主导航" className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted/70 p-1 text-sm">
        {([
          ['overview', '/', '首页'],
          ['home-network', '/home-network', '设备上网'],
          ['connections', '/connections', '线路管理'],
          ['policies', '/policies', '网站规则'],
          ['claude', '/claude', 'Claude'],
        ] as const).map(([key, href, label]) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}
          className={'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary sm:px-4 ' +
            (active === key ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground')}>{label}</Link>)}
        <Link prefetch={false} href="/network-guide.html" className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground">帮助</Link>
      </nav>
    </div>
  </header>;
}

export function NextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">{children}<ArrowUpRight aria-hidden="true" className="size-4" /></Link>;
}
