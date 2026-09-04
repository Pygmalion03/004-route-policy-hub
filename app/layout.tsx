import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '分流清单',
  description: '统一管理并同步 Mihomo / Clash 分流决定',
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
