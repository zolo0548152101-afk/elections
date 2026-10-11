import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local", override: true });

const url = process.env.DATABASE_URL;
const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
const forcePassword = process.env.FORCE_ADMIN_PASSWORD === "1";

if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required (no defaults)");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters");
  process.exit(1);
}

const sql = neon(url);
const hash = bcrypt.hashSync(password, 10);

const [inst] = await sql`
  INSERT INTO institutions (name)
  VALUES ('מערכת')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
`;

const existing = await sql`
  SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1
`;

if (existing[0]) {
  if (forcePassword) {
    await sql`
      UPDATE users SET
        password_hash = ${hash},
        role = 'super_admin',
        institution_id = ${inst.id},
        full_name = COALESCE(NULLIF(full_name, ''), 'מנהל על')
      WHERE id = ${existing[0].id}
    `;
    console.log({ admin: email, institutionId: inst.id, password: "updated" });
  } else {
    await sql`
      UPDATE users SET
        role = 'super_admin',
        institution_id = ${inst.id}
      WHERE id = ${existing[0].id}
    `;
    console.log({
      admin: email,
      institutionId: inst.id,
      password: "unchanged (set FORCE_ADMIN_PASSWORD=1 to reset)",
    });
  }
} else {
  await sql`
    INSERT INTO users (full_name, mobile, email, password_hash, role, institution_id)
    VALUES ('מנהל על', '', ${email}, ${hash}, 'super_admin', ${inst.id})
  `;
  console.log({ admin: email, institutionId: inst.id, password: "created" });
}
