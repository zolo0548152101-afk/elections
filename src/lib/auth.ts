import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { getSql } from "./db";

export type Role = "super_admin" | "area_manager" | "coordinator";

export type SessionUser = {
  id: number;
  full_name: string;
  mobile: string | null;
  email: string;
  role: Role;
  institution_id: number | null;
  manager_id: number | null;
  settlement_name: string | null;
};

const COOKIE = "edo_session";
const DAYS = 14;

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compareSync(password, hash);
}

export async function createSession(userId: number) {
  const sql = getSql();
  const id = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + DAYS * 864e5);
  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${id}, ${userId}, ${expires.toISOString()})
  `;
  const jar = await cookies();
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
  return id;
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) {
    const sql = getSql();
    await sql`DELETE FROM sessions WHERE id = ${id}`;
    jar.delete(COOKIE);
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT u.id, u.full_name, u.mobile, u.email, u.role,
           u.institution_id, u.manager_id, u.settlement_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${id} AND s.expires_at > now()
    LIMIT 1
  `) as SessionUser[];
  return rows[0] ?? null;
}

export function requireRole(user: SessionUser | null, roles: Role[]) {
  if (!user || !roles.includes(user.role)) {
    throw new Error("FORBIDDEN");
  }
}

export function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
