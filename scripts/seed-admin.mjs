import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import bcrypt from "bcryptjs";

config({ path: ".env.local", override: true });
const sql = neon(process.env.DATABASE_URL);

const email = process.env.ADMIN_EMAIL || "admin@election.local";
const password = process.env.ADMIN_PASSWORD || "admin1234";
const hash = bcrypt.hashSync(password, 10);

const [inst] = await sql`
  INSERT INTO institutions (name)
  VALUES ('מערכת')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
`;

await sql`
  INSERT INTO users (full_name, mobile, email, password_hash, role, institution_id)
  VALUES ('מנהל על', '', ${email}, ${hash}, 'super_admin', ${inst.id})
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    role = 'super_admin',
    institution_id = EXCLUDED.institution_id
`;

console.log({ admin: email, institutionId: inst.id });
