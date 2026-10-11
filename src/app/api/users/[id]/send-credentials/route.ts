import { NextRequest, NextResponse } from "next/server";
import {
  getSessionUser,
  hashPassword,
  requireRole,
  type SessionUser,
} from "@/lib/auth";
import { appLoginUrl } from "@/lib/app-url";
import { getSql } from "@/lib/db";
import { generateTempPassword, validatePassword } from "@/lib/passwords";
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
 * Reset/set password (optional body.password) and WhatsApp credentials
 * via WAHA session HAIM_YAHAD.
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

  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
  };
  let password = body.password?.trim() ?? "";
  let generated = false;
  if (!password) {
    password = generateTempPassword();
    generated = true;
  }
  const pwErr = validatePassword(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const hash = hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash} WHERE id = ${id}
  `;

  const loginUrl = appLoginUrl(req);
  const text = [
    "שלום, הוקם לך משתמש במערכת.",
    `לינק להתחברות- ${loginUrl}`,
    `משתמש- ${target.mobile.trim()}`,
    `סיסמא- ${password}`,
  ].join("\n");

  const sent = await wahaSendText({ mobile: target.mobile, text });
  if (!sent.ok) {
    return NextResponse.json(
      {
        error: sent.error,
        password_updated: true,
        generated,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    generated,
    message_id: sent.id,
  });
}
