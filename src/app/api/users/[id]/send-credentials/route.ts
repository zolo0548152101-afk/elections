import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole, type SessionUser } from "@/lib/auth";
import { appLoginUrl } from "@/lib/app-url";
import { getSql } from "@/lib/db";
import { wahaSendText } from "@/lib/waha";

export const runtime = "nodejs";

type TargetUser = {
  id: number;
  full_name: string;
  email: string;
  mobile: string | null;
  role: string;
  manager_id: number | null;
  login_password: string | null;
};

function canManage(actor: SessionUser, target: TargetUser) {
  if (actor.role === "super_admin") return true;
  if (actor.role === "area_manager") {
    return target.role === "coordinator" && target.manager_id === actor.id;
  }
  return false;
}

/**
 * WhatsApp permanent login details via WAHA (HAIM_YAHAD).
 * Sends the stored permanent password — does not generate or change it.
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
    SELECT id, full_name, email, mobile, role, manager_id, login_password
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

  const password = target.login_password?.trim() ?? "";
  if (!password) {
    return NextResponse.json(
      {
        error:
          "אין סיסמה קבועה שמורה למשתמש. ערכו את המשתמש והגדירו סיסמה, ואז שלחו שוב.",
      },
      { status: 400 },
    );
  }

  if (!process.env.WAHA_BASE_URL?.trim() || !process.env.WAHA_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "שליחת WhatsApp לא מוגדרת בשרת (חסר WAHA)" },
      { status: 503 },
    );
  }

  await req.json().catch(() => ({}));

  const loginUrl = appLoginUrl(req);
  const text = [
    "הוקם משתמש בשבילך באפליקציה",
    `לינק להתחברות- ${loginUrl}`,
    `משתמש- ${target.mobile.trim()}`,
    `סיסמא- ${password}`,
  ].join("\n");

  const sent = await wahaSendText({ mobile: target.mobile, text });
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    message_id: sent.id,
  });
}
