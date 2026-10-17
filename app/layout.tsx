import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '网络管理 · 固定出口与分流',
  description: '维护机场、Webshare 固定出口与 Clash 分流规则',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
