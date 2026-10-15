/**
 * Help corner content and guided tours. Plain data so it is easy to edit.
 * A step with `element` highlights that part of the screen (CSS selector, usually
 * a [data-tour] anchor). A step without one shows as a centered card.
 * `open` clicks something first (e.g. the route menu) so the next element exists.
 */

export type Role = "super_admin" | "area_manager" | "coordinator";

export type TourStep = {
  element?: string;
  title: string;
  body: string;
  /** Selector to click before this step, when the element is behind a menu. */
  open?: string;
};

export type Guide = {
  id: string;
  title: string;
  /** One line shown in the help corner list. */
  summary: string;
  /** Page the tour runs on. */
  path: string;
  roles: Role[];
  steps: TourStep[];
};

export type Faq = { q: string; a: string; roles?: Role[] };

const ALL: Role[] = ["super_admin", "area_manager", "coordinator"];
const MANAGERS: Role[] = ["super_admin", "area_manager"];

/** Shown once on a coordinator's first visit to the map, and any time from the help corner. */
export const COORDINATOR_START: Guide = {
  id: "coordinator-start",
  title: "ברוכים הבאים, רכז! 🇮🇱",
  summary: "סיור של 2 דקות: אשכול, רחובות, מסלול ונקודות איסוף",
  path: "/",
  roles: ["coordinator"],
  steps: [
    {
      title: "ברוכים הבאים לצוות! 🇮🇱",
      body: "בשתי דקות נראה איך עובדים: בוחרים אשכול, מסמנים רחובות שבוצעו, ומכינים מסלול הליכה עם נקודות איסוף. אפשר לצאת בכל רגע ולחזור לסיור מכפתור העזרה.",
    },
    {
      element: '[data-tour="cluster-select"]',
      title: "1. בוחרים אשכול",
      body: "כאן מופיעים האשכולות שלך. אשכול = כמה רחובות סביב קלפי. ליד כל אשכול רואים את המצב שלו: טרם התחיל, בתהליך או הושלם.",
    },
    {
      element: '[data-tour="map"]',
      title: "2. המפה",
      body: "כל יהלום הוא אשכול: כחול – עוד לא התחלנו, כתום – בתהליך, ירוק – הושלם. לחיצה על יהלום בוחרת אותו, והרחובות שלו נצבעים בצבע שלו.",
    },
    {
      element: '[data-tour="street-card"]',
      title: "3. מסמנים רחובות",
      body: "אלה הרחובות של האשכול, עם מספר הבתים בכל רחוב. סיימתם רחוב? מסמנים ✓. כשכל הרחובות מסומנים, האשכול נצבע בירוק והושלם אוטומטית.",
    },
    {
      element: '[data-tour="route-toggle"]',
      title: "4. מסלול ההליכה",
      body: "כאן מכינים את סדר ההליכה של הצוות. לחצו כדי לפתוח את תפריט המסלול.",
    },
    {
      element: '[data-tour="route-draw"]',
      open: '[data-tour="route-toggle"]',
      title: "5. מציירים מסלול",
      body: "לוחצים על האייקון, ואז מקליקים על המפה לאורך הרחובות לפי סדר ההליכה. לחיצה כפולה מסיימת קטע. אפשר לגרור נקודה כדי לתקן.",
    },
    {
      element: '[data-tour="route-point"]',
      title: "6. נקודת התחלה ונקודות איסוף",
      body: "לוחצים על האייקון ואז על המקום במפה. בוחרים אם זו נקודת ההתחלה או נקודת קיבוץ (איפה הצוות נפגש או אוסף פעילים).",
    },
    {
      element: '[data-tour="route-stage"]',
      title: "7. שלבים",
      body: "מסלול ארוך? מחלקים לשלבים – למשל שלב לכל צוות או לכל שעה. כל שלב מקבל צבע ומספר משלו.",
    },
    {
      element: 'nav a[href="/activists"]',
      title: "8. מגייסים פעילים",
      body: "בדף הרשמת פעילים מעתיקים קישור הרשמה ושולחים לקבוצות. כל מי שנרשם מופיע אצלך בטבלה, כולל מידת חולצה.",
    },
    {
      element: '[data-help-corner]',
      title: "זהו, אתם מוכנים! 💪",
      body: "שכחתם משהו? כאן בפינה יש מדריכים ותשובות לשאלות. בהצלחה בשטח!",
    },
  ],
};

export const GUIDES: Guide[] = [
  COORDINATOR_START,
  {
    id: "map-basics",
    title: "המפה והאשכולות",
    summary: "איך קוראים את המפה, בוחרים אשכול ומסננים",
    path: "/",
    roles: MANAGERS,
    steps: [
      {
        element: '[data-tour="search"]',
        title: "חיפוש",
        body: "מקלידים עיר, רחוב או שניהם (למשל: בית שאן הרמב״ם) והמפה קופצת לשם.",
      },
      {
        element: '[data-tour="cluster-select"]',
        title: "בחירת אשכול",
        body: "בוחרים אשכול מהרשימה או לוחצים על יהלום במפה. ליד כל אשכול מופיע המצב שלו.",
      },
      {
        element: '[data-tour="map"]',
        title: "צבעים",
        body: "יהלום כחול – טרם התחיל, כתום – בתהליך, ירוק – הושלם. כשבוחרים אשכול, הרחובות שלו בצבע והשאר באפור.",
      },
      {
        element: '[data-tour="cluster-card"]',
        title: "נתוני האשכול",
        body: "בז״ב, מצביעים, אחוז הצבעה ואחוז ימין. מכאן גם מקשרים את האשכול למוסד.",
      },
      {
        element: '[data-tour="street-card"]',
        title: "רחובות האשכול",
        body: "כל רחוב עם מספר הבתים, הדירות והבוחרים. סימון ✓ מסמן רחוב שבוצע.",
      },
    ],
  },
  {
    id: "mark-streets",
    title: "סימון רחובות ואשכול שבוצע",
    summary: "מסמנים רחוב, ומתי אשכול נחשב הושלם",
    path: "/",
    roles: ALL,
    steps: [
      {
        element: '[data-tour="street-card"]',
        title: "סימון רחוב",
        body: "מסמנים ✓ ליד רחוב שסיימתם. אפשר לבטל סימון בכל רגע.",
      },
      {
        element: '[data-tour="cluster-done"]',
        title: "סימון כל האשכול",
        body: "סיימתם הכל בבת אחת? הכפתור מסמן את כל הרחובות. וגם בלי הכפתור – כשהרחוב האחרון מסומן, האשכול הושלם לבד.",
      },
    ],
  },
  {
    id: "route",
    title: "הכנת מסלול ונקודות איסוף",
    summary: "מציירים מסלול הליכה, נקודת התחלה ונקודות קיבוץ",
    path: "/",
    roles: ALL,
    steps: COORDINATOR_START.steps.slice(4, 8),
  },
  {
    id: "activists",
    title: "הרשמת פעילים",
    summary: "שולחים קישור הרשמה ורואים מי נרשם",
    path: "/activists",
    roles: ALL,
    steps: [
      {
        title: "הרשמת פעילים",
        body: "כאן רואים כל מי שנרשם דרך טופס הפעילים: שם, נייד, מידת חולצה ומוסד. לחיצה על כותרת עמודה ממיינת.",
      },
      {
        element: ".activists-bar .export",
        title: "קישור הרשמה",
        body: "מעתיקים את הקישור ושולחים בקבוצות. אם נבחר מוסד בסינון, הקישור כבר ממלא אותו בטופס.",
      },
    ],
  },
  {
    id: "clusters-page",
    title: "דף האשכולות",
    summary: "טבלת כל האשכולות, סינון לפי מצב ביצוע",
    path: "/team/clusters",
    roles: ALL,
    steps: [
      {
        title: "דף האשכולות",
        body: "כל האשכולות בטבלה אחת, עם המוסד, הרכז והמצב: טרם התחיל, בתהליך (כמה רחובות מתוך כמה) או הושלם.",
      },
      {
        element: ".users-filters",
        title: "סינון",
        body: "מחפשים לפי אשכול, יישוב, מוסד או רכז, ומסננים לפי מצב ביצוע.",
      },
    ],
  },
  {
    id: "institutions-page",
    title: "דף המוסדות",
    summary: "מוסדות, אנשי מפתח, רכזים ואשכולות מקושרים",
    path: "/institutions",
    roles: ALL,
    steps: [
      {
        title: "דף המוסדות",
        body: "כל מוסד עם אנשי המפתח, הרכזים שלו וכמה מהאשכולות שלו הושלמו. מנהלים מוסיפים מוסד בטופס למעלה ומקשרים רכזים ואשכולות דרך «קשרים».",
      },
    ],
  },
  {
    id: "coordinator-signups",
    title: "הרשמת רכזים",
    summary: "טופס הרשמה לרכזים חדשים וטבלת הנרשמים",
    path: "/coordinator-signups",
    roles: ["super_admin"],
    steps: [
      {
        title: "הרשמת רכזים",
        body: "כל מי שמילא את טופס הרכזים: שם, נייד, סוג מוסד ושם המוסד (כפי שהקליד). מעתיקים את הקישור לטופס, ומייצאים ל-CSV בלחיצה.",
      },
    ],
  },
  {
    id: "users-page",
    title: "משתמשים",
    summary: "הוספת משתמשים, תפקידים ושליחת פרטי כניסה",
    path: "/users",
    roles: MANAGERS,
    steps: [
      {
        title: "משתמשים",
        body: "מוסיפים מנהל, רכז על או רכז, משייכים למוסדות, ושולחים פרטי כניסה בוואטסאפ. הסיסמה נשמרת כדי שאפשר יהיה לשלוח אותה שוב.",
      },
    ],
  },
];

export const FAQ: Faq[] = [
  {
    q: "איך נכנסים לאפליקציה?",
    a: "עם מספר הנייד והסיסמה שקיבלתם בוואטסאפ. שכחתם סיסמה? «שכחתי סיסמה» במסך הכניסה שולח קוד חד-פעמי לוואטסאפ.",
  },
  {
    q: "למה אני לא רואה אשכולות?",
    a: "רכז רואה רק אשכולות של המוסדות שמשויכים אליו. אם הרשימה ריקה – בקשו מהמנהל או מרכז העל לשייך אתכם למוסד.",
    roles: ["coordinator"],
  },
  {
    q: "מה ההבדל בין הצבעים של האשכולות?",
    a: "כחול – טרם התחיל (אף רחוב לא סומן). כתום – בתהליך (לפחות רחוב אחד סומן). ירוק – הושלם (כל הרחובות סומנו).",
  },
  {
    q: "סימנתי רחוב בטעות. מה עושים?",
    a: "מורידים את ה-✓ ליד הרחוב. אם האשכול היה ירוק, הוא חוזר לכתום.",
  },
  {
    q: "מה זה ״בתים״ ליד כל רחוב?",
    a: "מספר הכתובות (בניינים/בתים) באותו רחוב שנמצאות באשכול. מתחת רואים גם כמה דירות וכמה בוחרים יש שם.",
  },
  {
    q: "איך מציירים מסלול הליכה?",
    a: "פותחים את תפריט «מסלול» במפה, לוחצים על אייקון המסלול ומקליקים על המפה לאורך הרחובות לפי הסדר. לחיצה כפולה מסיימת קטע.",
  },
  {
    q: "מה זו נקודת קיבוץ?",
    a: "מקום מפגש של הצוות או נקודת איסוף של פעילים בדרך. מסמנים אותה עם אייקון הנקודה בתפריט המסלול.",
  },
  {
    q: "איך מגייסים פעילים?",
    a: "בדף «הרשמת פעילים» מעתיקים את קישור ההרשמה ושולחים לקבוצות. כל נרשם מופיע אצלכם בטבלה.",
  },
  {
    q: "איך מוסיפים רכז חדש?",
    a: "רכזים נרשמים בטופס הרכזים, ואז מנהל יוצר להם משתמש בדף «משתמשים» ומשייך למוסד.",
    roles: MANAGERS,
  },
  {
    q: "איך מסמנים אשכול כבוצע בלי לסמן כל רחוב?",
    a: "בוחרים את האשכול במפה ולוחצים «סמן אשכול כבוצע». הכפתור מסמן את כל הרחובות שלו.",
  },
];

export function guidesFor(role: string): Guide[] {
  return GUIDES.filter((g) => g.roles.includes(role as Role));
}

export function faqFor(role: string): Faq[] {
  return FAQ.filter((f) => !f.roles || f.roles.includes(role as Role));
}
