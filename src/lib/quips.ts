/**
 * Light, playful microcopy (in the spirit of "לעבודה! אתם הולכים להצליח בגדול!").
 * One line, positive, never about opponents. Pick with `quip(list, seed)` so a
 * line stays put while the screen is open instead of changing every render.
 */

export function quip(list: readonly string[], seed: number | string = Date.now()): string {
  const n =
    typeof seed === "number"
      ? Math.abs(Math.floor(seed))
      : [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
  return list[Math.abs(n) % list.length]!;
}

export const LOADING = [
  "טוען… מהר יותר מספירת קולות 😉",
  "רגע, מצחצחים את הקלפי…",
  "טוען… שווה לחכות, כמו לתוצאות האמת",
  "מביאים את הנתונים מהשטח…",
  "טוען… בינתיים, תשתו מים 💧",
  "טוען… הזוגות כבר נועלים נעליים 👟",
  "רגע, מזמזמים שיר כינוס… 🎶",
  "טוען… הקולות שלנו לא יחכו לנצח",
] as const;

export const LOADING_MAP = [
  "פורשים את המפה…",
  "מכינים את השטח…",
  "מסמנים את הדרך לניצחון…",
  "מסמנים את הדלתות…",
  "מותחים את האקורדיון 🪗",
] as const;

/** Next to the progress pill, by percent of clusters done. */
export function progressQuip(pct: number): string {
  if (pct <= 0) return "כל מסע מתחיל ברחוב אחד 🚶";
  if (pct < 15) return "מתחממים. גם קואליציה לא נבנית ביום אחד";
  if (pct < 25) return "האקורדיון נפתח 🪗";
  if (pct < 35) return "יש תנועה בשטח 💪";
  if (pct < 55) return "חצי הדרך. ממשיכים בכל הכוח";
  if (pct < 75) return "מרגישים את זה? ריח של ניצחון";
  if (pct < 100) return "ישורת אחרונה, לא עוצרים עכשיו!";
  return "סגרנו את השטח! 🇮🇱";
}

export const STREET_DONE = [
  "רחוב בכיס ✓",
  "עוד רחוב ירוק במפה ✓",
  "עוד דלת, עוד קול ✓",
  "יפה! הרחוב הבא כבר מחכה ✓",
  "סומן. השטח שלנו ✓",
  "דלת אחר דלת, רחוב אחר רחוב ✓",
  "הזוג הזה על אש 🔥 ✓",
  "רחוב סגור. עכשיו מגיע לכם בורקס 🥐 ✓",
  "הקולות כבר שם – ועכשיו גם אתם ✓",
] as const;

export const STREET_UNDONE = [
  "הסימון בוטל. קורה לטובים ביותר",
  "בוטל. חוזרים לרחוב הזה אחר כך",
] as const;

export const CLUSTER_DONE = [
  "האשכול הושלם! עוד יהלום ירוק במפה 💎",
  "אשכול סגור ✓ על זה בונים ממשלה",
  "כל הרחובות סומנו – כל הכבוד לצוות! 🇮🇱",
  "האשכול הושלם. נחים 5 דקות וממשיכים 😄",
  "האשכול ירוק! כינוס, שיר וממשיכים לאשכול הבא 🎶",
  "עוד אשכול בכיס. ככה בונים 64 מנדטים 💪",
  "האשכול הושלם. הדלת האחרונה שווה כמו הראשונה – וסגרתם את שתיהן 🇮🇱",
] as const;

export const EMPTY_SEARCH = [
  "חיפשנו מתחת לכל אבן. כלום 🤷",
  "אין תוצאות. אולי שגיאת כתיב?",
  "ריק פה. נסו מילה אחרת",
] as const;

export const EMPTY_CLUSTERS = [
  "אין אשכולות להצגה. השטח עוד מחכה לכם",
  "אין פה אשכולות… עדיין 😉",
] as const;

export const EMPTY_ACTIVISTS = [
  "עדיין אין פעילים. הראשון שנרשם מקבל כבוד 😎",
  "השטח מחכה לפעילים הראשונים",
  "אין עדיין פעילים. זוג ראשון = חצי עבודה 👫",
] as const;

export const EMPTY_SIGNUPS = [
  "עדיין אין נרשמים. שלחו את הקישור לקבוצות 📲",
  "שקט פה. זה הזמן להפיץ את הטופס",
  "אין נרשמים עדיין. כנראה כולם עוד בשיעור 📖",
] as const;

export const SIGNUP_THANKS_ACTIVIST = [
  "ברוכים הבאים לצוות! נתראה בשטח 🇮🇱",
  "נרשמת! עכשיו כל קול נספר, גם שלך 💪",
  "מעולה! הצטרפת לנבחרת של יום הבחירות",
  "נרשמת! תביא חבר – עובדים בזוגות 👫",
  "יאללה, נתראה בכינוס של 15:00 🎶",
] as const;

export const SIGNUP_THANKS_COORDINATOR = [
  "נרשמת כרכז! ניצור איתך קשר בקרוב 🇮🇱",
  "יש! עוד רכז בנבחרת. נדבר בקרוב",
] as const;

/** One line under each page title. Stays on screen (unlike loading lines). */
export const PAGE_QUIPS: Record<string, readonly string[]> = {
  "/": [
    "המפה שלכם לניצחון 🗺️",
    "כל יהלום ירוק = עוד קלפי שעבדנו בה עד הסוף",
    "יוצאים. מצביעים. מצילים את הימין! 🇮🇱",
    "המנדט הבא נמצא מאחורי הדלת 🚪",
    "לצבוע את המפה בירוק – זו כל התוכנית 💚",
  ],
  "/institutions": [
    "מכינות, ישיבות ואולפנות – העורף החזק של השטח",
    "כאן יושבים האנשים שיוצאים לשטח 💪",
  ],
  "/team/clusters": [
    "תסתכלו על הכתומים – הם כמעט שם",
    "כל אשכול ירוק = עוד קלפי שסגרנו",
  ],
  "/activists": [
    "פעיל אחד בשטח שווה אלף לייקים",
    "הנבחרת של יום הבחירות נבנית כאן",
    "50 פעילים = 25 זוגות = הרבה דלתות פתוחות 🚪",
  ],
  "/coordinator-signups": [
    "רכזים טובים = יום בחירות שקט",
    "כל רכז חדש = עוד אשכול שמישהו דואג לו",
  ],
  "/users": [
    "מי עם מי ומי אחראי על מה – הכל כאן",
    "סדר בצוות = שקט בשטח",
  ],
  "/team/coordinators": [
    "הרכזים – השכבה שמחזיקה את השטח",
    "רכז מחובר = אשכול שמתקדם",
  ],
  "/team/managers": ["רכזי העל – מנצחי התזמורת 🎻", "מכאן רואים את כל הצוות במבט אחד"],
  "/links": ["מחברים את כל הנקודות", "רכז ← מוסד ← אשכול. פשוט."],
};

/** Encouragement under the cluster street list, by how many streets are left. */
export function streetsLeftQuip(done: number, total: number): string {
  if (total === 0) return "";
  const left = total - done;
  if (left === 0) return "האשכול ירוק! כל הכבוד לצוות 🇮🇱";
  if (done === 0) return "יאללה, הרחוב הראשון מחכה לכם 🚶";
  if (left === 1) return "רחוב אחד אחרון והאשכול ירוק! 🔥";
  return `עוד ${left} רחובות והאשכול ירוק 💪`;
}
