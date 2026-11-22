import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/connections' &&
    (request.method !== 'POST' || !['flex', 'strict-mac', 'strict-ios'].includes(request.nextUrl.searchParams.get('client') || ''))) return NextResponse.next();
  const host = process.env.LAN_MANAGEMENT_HOST;
  if (host && (request.headers.get('host') !== host || request.headers.has('cf-ray') || request.headers.has('cf-connecting-ip'))) {
    return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/home-network/:path*', '/api/home-network/:path*', '/subscription/plan', '/subscription/device', '/api/connections'],
};
