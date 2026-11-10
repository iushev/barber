import { NextResponse, type NextRequest } from "next/server";

/**
 * 1) Content-Security-Policy с nonce за всяка HTML заявка. Next.js чете nonce-а от
 *    CSP заглавката на заявката и го слага на своите <script> тагове (всички страници
 *    са динамични, затова nonce-ът е различен при всяка заявка).
 * 2) Бърза (оптимистична) проверка за /admin и /api/admin: без cookie → вход / 401.
 *    НЕ е авторизация — валидността на сесията се проверява на сървъра в layout-а на
 *    /admin (requireAdmin) и във всеки Server Action / route handler.
 */
const COOKIE_NAMES = ["__Host-barber_admin", "barber_admin"];

export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic': скриптовете, заредени от доверен (с nonce) скрипт, също са разрешени.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // next/image и next/font слагат inline стилове; рискът от inline CSS е нисък.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // Картата (OpenStreetMap) се зарежда в iframe едва след клик.
    "frame-src https://www.openstreetmap.org",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (opts.https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function adminGate(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  const isAdminApi = pathname.startsWith("/api/admin");
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!isAdminApi && !isAdmin) return null;

  const hasCookie = COOKIE_NAMES.some((n) => request.cookies.has(n));
  if (isAdminApi) {
    return hasCookie
      ? null
      : NextResponse.json(
          { error: { code: "unauthorized", message: "Необходим е вход." } },
          { status: 401 },
        );
  }
  if (pathname !== "/admin/login" && !hasCookie) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  return null;
}

export function proxy(request: NextRequest) {
  const blocked = adminGate(request);
  if (blocked) return blocked;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== "production",
    https: process.env.ENABLE_HSTS === "true",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  if (request.nextUrl.pathname.startsWith("/admin")) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = {
  matcher: [
    "/api/admin/:path*",
    // Всички страници без API, статични файлове, снимки и metadata файлове.
    "/((?!api/|_next/static|_next/image|uploads/|favicon.ico|icon|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml).*)",
  ],
};
