import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { appLoginUrl } from "@/lib/app-url";
import { getSql } from "@/lib/db";
import { mobileMatchVariants, normalizeMobileLocal } from "@/lib/mobile";
import {
  generateTempLoginCode,
  TEMP_LOGIN_TTL_MS,
} from "@/lib/passwords";
import {
  deliveryChannelLabel,
  micropaySendSms,
  parseDeliveryChannel,
} from "@/lib/micropay";
import { wahaSendText } from "@/lib/waha";

export const runtime = "nodejs";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now >= entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/**
 * Public: send a 5-digit temporary login code over WhatsApp (WAHA) or SMS (Micropay).
 * Does not replace the permanent password — only adds a 5-minute login option.
 * Always returns a generic success when the mobile format is valid (anti-enumeration).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    mobile?: string;
    channel?: unknown;
  };
  const channel = parseDeliveryChannel(body.channel);
  if (!channel) {
    return NextResponse.json({ error: "ערוץ שליחה לא תקין" }, { status: 400 });
  }
  const via = deliveryChannelLabel(channel);
  const mobile = normalizeMobileLocal(body.mobile ?? "");
  if (!mobile) {
    return NextResponse.json(
      { error: "הזינו מספר נייד תקין (05…)" },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(`${ip}:${mobile}`)) {
    return NextResponse.json(
      { error: "יותר מדי ניסיונות. נסו שוב בעוד דקה." },
      { status: 429 },
    );
  }

  const variants = mobileMatchVariants(mobile);
  const sql = getSql();
  const rows = (await sql`
    SELECT id, full_name, mobile
    FROM users
    WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${variants})
    LIMIT 2
  `) as { id: number; full_name: string; mobile: string | null }[];

  const genericOk = {
    ok: true,
    message: `אם קיים משתמש עם מספר זה, נשלח קוד זמני בן 5 ספרות ב-${via}. תקף ל־5 דקות; הסיסמה הקבועה נשארת.`,
  };

  if (rows.length !== 1 || !rows[0].mobile?.trim()) {
    return NextResponse.json(genericOk);
  }

  const user = rows[0];
  if (channel === "sms") {
    if (!process.env.MICROPAY_TOKEN?.trim() || !process.env.MICROPAY_SOURCE?.trim()) {
      return NextResponse.json(
        { error: "שליחת SMS לא מוגדרת בשרת (חסר Micropay)" },
        { status: 503 },
      );
    }
  } else if (!process.env.WAHA_BASE_URL?.trim() || !process.env.WAHA_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "שליחת WhatsApp לא מוגדרת בשרת (חסר WAHA)" },
      { status: 503 },
    );
  }

  const temp = generateTempLoginCode();
  const loginUrl = appLoginUrl(req);
  const text = [
    "שלום, הנה קוד זמני לכניסה למערכת.",
    `לינק להתחברות- ${loginUrl}`,
    `משתמש- ${mobile}`,
    `קוד זמני (5 ספרות)- ${temp}`,
    "הקוד תקף ל־5 דקות בלבד. הסיסמה הקבועה שלכם לא משתנה.",
  ].join("\n");

  const sent =
    channel === "sms"
      ? await micropaySendSms({ mobile: user.mobile!, text })
      : await wahaSendText({ mobile: user.mobile!, text });
  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error || `שליחה ב-${via} נכשלה` },
      { status: 502 },
    );
  }

  const hash = hashPassword(temp);
  const expiresAt = new Date(Date.now() + TEMP_LOGIN_TTL_MS).toISOString();
  await sql`
    UPDATE users
    SET temp_login_code_hash = ${hash},
        temp_login_expires_at = ${expiresAt}::timestamptz
    WHERE id = ${user.id}
  `;

  return NextResponse.json(genericOk);
}
