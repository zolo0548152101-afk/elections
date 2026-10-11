import { NextRequest, NextResponse } from "next/server";
import { hashPassword, getSessionUser, requireRole, type SessionUser } from "@/lib/auth";
import { appLoginUrl } from "@/lib/app-url";
import { getSql } from "@/lib/db";
import {
  generateTempLoginCode,
  TEMP_LOGIN_TTL_MS,
} from "@/lib/passwords";
import { wahaSendText } from "@/lib/waha";

export const runtime = "nodejs";

type TargetUser = {
  id: number;
  full_name: string;
  email: string;
  mobile: string | null;
  role: string;
  manager_id: number | null;
};

function canManage(actor: SessionUser, target: TargetUser) {
  if (actor.role === "super_admin") return true;
  if (actor.role === "area_manager") {
    return target.role === "coordinator" && target.manager_id === actor.id;
  }
  return false;
}

/**
 * WhatsApp login details via WAHA (HAIM_YAHAD).
 * Does not ask for or change the permanent password — sends a 5-digit
 * one-time code (5 minutes) as an extra login option.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const sql = getSql();
  const rows = (await sql`
    SELECT id, full_name, email, mobile, role, manager_id
    FROM users WHERE id = ${id} LIMIT 1
  `) as TargetUser[];
  const target = rows[0];
  if (!target || !canManage(user!, target)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!target.mobile?.trim()) {
    return NextResponse.json(
      { error: "למשתמש אין מספר נייד לשליחה" },
      { status: 400 },
    );
  }

  if (!process.env.WAHA_BASE_URL?.trim() || !process.env.WAHA_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "שליחת WhatsApp לא מוגדרת בשרת (חסר WAHA)" },
      { status: 503 },
    );
  }

  // Ignore any legacy body.password — never overwrite password_hash here.
  await req.json().catch(() => ({}));

  const temp = generateTempLoginCode();
  const loginUrl = appLoginUrl(req);
  const text = [
    "שלום, פרטי התחברות למערכת.",
    `לינק להתחברות- ${loginUrl}`,
    `משתמש- ${target.mobile.trim()}`,
    `קוד זמני לכניסה (5 ספרות)- ${temp}`,
    "הקוד תקף ל־5 דקות. הסיסמה הקבועה לא משתנה — אפשר גם להתחבר איתה.",
  ].join("\n");

  const sent = await wahaSendText({ mobile: target.mobile, text });
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  const hash = hashPassword(temp);
  const expiresAt = new Date(Date.now() + TEMP_LOGIN_TTL_MS).toISOString();
  await sql`
    UPDATE users
    SET temp_login_code_hash = ${hash},
        temp_login_expires_at = ${expiresAt}::timestamptz
    WHERE id = ${id}
  `;

  return NextResponse.json({
    ok: true,
    message_id: sent.id,
  });
}
