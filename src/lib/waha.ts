/** Minimal WAHA client for credential WhatsApp sends (session HAIM_YAHAD). */

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} חסר`);
  return v;
}

/** Normalize Israeli mobile to digits for chatId: 9725XXXXXXXX */
export function mobileToWahaPhone(mobile: string): string | null {
  let digits = mobile.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("972")) {
    // ok
  } else if (digits.startsWith("0")) {
    digits = `972${digits.slice(1)}`;
  } else if (digits.length === 9 && digits.startsWith("5")) {
    digits = `972${digits}`;
  } else {
    return null;
  }
  // Israel mobile: 972 + 9 digits (5xxxxxxxx)
  if (!/^9725\d{8}$/.test(digits)) return null;
  return digits;
}

export function mobileToChatId(mobile: string): string | null {
  const phone = mobileToWahaPhone(mobile);
  return phone ? `${phone}@c.us` : null;
}

export async function wahaSendText(opts: {
  mobile: string;
  text: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let base: string;
  let apiKey: string;
  try {
    base = requireEnv("WAHA_BASE_URL").replace(/\/$/, "");
    apiKey = requireEnv("WAHA_API_KEY");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "הגדרות WAHA חסרות",
    };
  }
  const session = process.env.WAHA_SESSION?.trim() || "HAIM_YAHAD";
  const chatId = mobileToChatId(opts.mobile);
  if (!chatId) {
    return { ok: false, error: "מספר נייד לא תקין (נדרש נייד ישראלי)" };
  }

  try {
    const res = await fetch(`${base}/api/sendText`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        session,
        chatId,
        text: opts.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return {
        ok: false,
        error: `שליחת WhatsApp נכשלה (${res.status})${body ? `: ${body}` : ""}`,
      };
    }
    const data = (await res.json()) as {
      id?: string | { _serialized?: string };
    };
    const id =
      typeof data.id === "string"
        ? data.id
        : data.id?._serialized || "sent";
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "שגיאת רשת מול WAHA",
    };
  }
}
