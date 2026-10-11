import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sql = getSql();

  if (user.role === "super_admin") {
    const rows = await sql`
      SELECT u.id, u.full_name, u.mobile, u.email, u.role, u.institution_id,
             u.manager_id, u.settlement_name, u.login_password,
             i.name AS institution_name,
             m.full_name AS manager_name
      FROM users u
      LEFT JOIN institutions i ON i.id = u.institution_id
      LEFT JOIN users m ON m.id = u.manager_id
      ORDER BY u.role, u.full_name
    `;
    return NextResponse.json({ users: rows });
  }

  if (user.role === "area_manager") {
    const rows = await sql`
      SELECT u.id, u.full_name, u.mobile, u.email, u.role, u.institution_id,
             u.manager_id, u.settlement_name, u.login_password,
             i.name AS institution_name
      FROM users u
      LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.manager_id = ${user.id}
      ORDER BY u.full_name
    `;
    return NextResponse.json({ users: rows });
  }

  return NextResponse.json({ users: [user] });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    full_name?: string;
    mobile?: string;
    email?: string;
    password?: string;
    role?: string;
    institution_id?: number | null;
    settlement_name?: string | null;
    manager_id?: number | null;
  };

  const full_name = body.full_name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const mobile = body.mobile?.trim() ?? "";
  let role = body.role ?? "coordinator";
  let institution_id = body.institution_id ?? null;
  let settlement_name = body.settlement_name?.trim() || null;
  let manager_id = body.manager_id ?? null;

  if (!full_name || !email || !password) {
    return NextResponse.json({ error: "שם, אימייל וסיסמה חובה" }, { status: 400 });
  }

  if (user!.role === "area_manager") {
    role = "coordinator";
    manager_id = user!.id;
  }

  if (!["super_admin", "area_manager", "coordinator"].includes(role)) {
    return NextResponse.json({ error: "תפקיד לא חוקי" }, { status: 400 });
  }

  if (role === "coordinator" && !settlement_name) {
    return NextResponse.json({ error: "לרכז חובה לבחור יישוב" }, { status: 400 });
  }

  const sql = getSql();
  if (settlement_name) {
    const [known] = (await sql`
      SELECT name_he FROM settlements WHERE name_he = ${settlement_name} LIMIT 1
    `) as { name_he: string }[];
    if (!known) {
      return NextResponse.json({ error: "יישוב לא נמצא ברשימת היישובים" }, { status: 400 });
    }
  }
  const hash = hashPassword(password);
  try {
    const [row] = await sql`
      INSERT INTO users (
        full_name, mobile, email, password_hash, login_password, role,
        institution_id, manager_id, settlement_name
      ) VALUES (
        ${full_name}, ${mobile}, ${email}, ${hash}, ${password}, ${role},
        ${institution_id}, ${manager_id}, ${settlement_name}
      )
      RETURNING id, full_name, mobile, email, role, institution_id, manager_id,
                settlement_name, login_password
    `;
    return NextResponse.json({ user: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "אימייל כבר קיים" }, { status: 409 });
    }
    throw e;
  }
}
