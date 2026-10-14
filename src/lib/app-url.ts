import type { NextRequest } from "next/server";

/** Custom domain connected on Vercel. Login messages must use this, not *.vercel.app. */
const PUBLIC_ORIGIN = "https://yaminwin26.app";

function stripSlash(url: string) {
  return url.replace(/\/$/, "");
}

/** Public app origin for links in outbound messages. */
export function appOrigin(req?: NextRequest): string {
  const fromEnv =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return stripSlash(fromEnv);

  if (process.env.VERCEL) return PUBLIC_ORIGIN;

  if (req) {
    const host =
      req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    if (host && !host.endsWith(".vercel.app")) return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

export function appLoginUrl(req?: NextRequest): string {
  return `${appOrigin(req)}/login`;
}
