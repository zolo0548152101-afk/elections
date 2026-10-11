import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local", override: true });

const url = process.env.DATABASE_URL;
const mobileRaw = (process.env.ADMIN_MOBILE || "0584152101").trim();
const password = process.env.ADMIN_PASSWORD || "12345678";
const email =
  (process.env.ADMIN_EMAIL || "").trim().toLowerCase() ||
  `${mobileRaw.replace(/\D/g, "")}@admin.local`;

function normalizeMobileLocal(input) {
  let digits = String(input).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9 && digits.startsWith("5")) digits = `0${digits}`;
  if (!/^05\d{8}$/.test(digits)) return null;
  return digits;
}

function mobileMatchVariants(input) {
  const local = normalizeMobileLocal(input);
  if (!local) return [];
  const national = local.slice(1);
  return [local, national, `972${national}`];
}

if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const mobile = normalizeMobileLocal(mobileRaw);
if (!mobile) {
  console.error("ADMIN_MOBILE must be a valid Israeli mobile (05XXXXXXXX)");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters");
  process.exit(1);
}

const sql = neon(url);
const hash = bcrypt.hashSync(password, 10);
const variants = mobileMatchVariants(mobile);

const [inst] = await sql`
  INSERT INTO institutions (name)
  VALUES ('מערכת')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
`;

// Free the mobile on any other user so login is unique.
await sql`
  UPDATE users
  SET mobile = NULL
  WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${variants})
    AND role <> 'super_admin'
`;

const byMobile = await sql`
  SELECT id FROM users
  WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${variants})
  LIMIT 1
`;
const byAdmin = await sql`
  SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1
`;
const existingId = byMobile[0]?.id ?? byAdmin[0]?.id ?? null;

if (existingId) {
  await sql`
    UPDATE users SET
      full_name = 'מנהל על',
      mobile = ${mobile},
      email = ${email},
      password_hash = ${hash},
      role = 'super_admin',
      institution_id = ${inst.id}
    WHERE id = ${existingId}
  `;
  console.log({ admin_mobile: mobile, id: existingId, full_name: "מנהל על", password: "updated" });
} else {
  const [row] = await sql`
    INSERT INTO users (full_name, mobile, email, password_hash, role, institution_id)
    VALUES ('מנהל על', ${mobile}, ${email}, ${hash}, 'super_admin', ${inst.id})
    RETURNING id
  `;
  console.log({ admin_mobile: mobile, id: row.id, full_name: "מנהל על", password: "created" });
}
