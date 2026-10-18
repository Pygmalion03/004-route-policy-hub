import Link from 'next/link';
import { ArrowUpRight, Network } from 'lucide-react';

export function HubNav({ active }: { active: 'overview' | 'connections' | 'policies' }) {
  return (
    <header className="border-b border-border bg-card/80">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-7">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Network className="size-4" /></span>
          网络管理 <span className="rounded-md bg-muted px-2 py-1 text-xs font-normal text-muted-foreground">私人</span>
        </Link>
        <nav aria-label="主导航" className="flex w-full flex-wrap gap-1 rounded-xl bg-muted p-1 text-sm sm:w-auto">
          {([
            ['overview', '/', 'Claude 专用'],
            ['connections', '/connections', '日常网络'],
            ['policies', '/policies', '网站例外'],
          ] as const).map(([key, href, label]) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-center transition-colors ${active === key ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</Link>)}
          <Link prefetch={false} href="/network-guide.html" className="whitespace-nowrap rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground">使用说明</Link>
        </nav>
      </div>
    </header>
  );
}

export function NextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4">{children}<ArrowUpRight className="size-4" /></Link>;
}
