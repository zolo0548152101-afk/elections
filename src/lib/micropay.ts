import { normalizeMobileLocal } from "@/lib/mobile";

/** Delivery channel for login codes and credential messages. */
export type DeliveryChannel = "whatsapp" | "sms";

const MICROPAY_SMS_URL = "https://www.micropay.co.il/extApi/scheduleSms.php";

/** Missing or empty channel stays WhatsApp. Invalid values return null. */
export function parseDeliveryChannel(value: unknown): DeliveryChannel | null {
  if (value == null || value === "") return "whatsapp";
  if (value === "whatsapp" || value === "sms") return value;
  return null;
}

export function deliveryChannelLabel(channel: DeliveryChannel): string {
  return channel === "sms" ? "SMS" : "WhatsApp";
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} חסר`);
  return v;
}

/** Micropay sometimes answers HTTP 200 with an error string. */
export function micropayBodyIsError(body: string): boolean {
  return /^(error|שגיאה|fail)/i.test(body.trim());
}

/**
 * One SMS via Micropay scheduleSms (same call as misc `micropay_send_sms`).
 * Phone is the Israeli local 05XXXXXXXX form. The request URL is never logged.
 */
export async function micropaySendSms(opts: {
  mobile: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let token: string;
  let source: string;
  try {
    token = requireEnv("MICROPAY_TOKEN");
    source = requireEnv("MICROPAY_SOURCE");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "הגדרות Micropay חסרות",
    };
  }

  const phone = normalizeMobileLocal(opts.mobile);
  if (!phone) {
    return { ok: false, error: "מספר נייד לא תקין (נדרש נייד ישראלי)" };
  }

  const url = new URL(MICROPAY_SMS_URL);
  url.searchParams.set("token", token);
  url.searchParams.set("get", "1");
  url.searchParams.set("msg", opts.text);
  url.searchParams.set("list", phone);
  url.searchParams.set("from", source);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    const raw = (await res.text()).slice(0, 300);
    const body = raw.split(token).join("").trim();
    if (!res.ok || micropayBodyIsError(body)) {
      return {
        ok: false,
        error: `שליחת SMS נכשלה (${res.status})${body ? `: ${body}` : ""}`,
      };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/aborted|timeout|Timeout/i.test(msg)) {
      return { ok: false, error: "שליחת SMS נכשלה (timeout)" };
    }
    return { ok: false, error: "שגיאת רשת מול Micropay" };
  }
}
