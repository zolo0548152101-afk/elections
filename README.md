# ניהול יום בחירות

אפליקציית Next.js לסינון אשכולות קלפי, מפת רחובות OpenStreetMap עם חיפוש וסימון, וניהול משתמשים ומוסדות (חוברת2).

## סטאק
- Next.js (App Router) על Vercel
- Neon Postgres
- MapLibre + OpenStreetMap (רחובות בעברית מ־OSM, אריחי וקטור מ־`/api/tiles`)
- Leaflet לדשבורד האשכולות

## פיתוח מקומי
```bash
cp .env.example .env.local
npm install
npm run seed
npm run seed:admin
# רחובות (לאחר הורדת parquet):
# curl -L -o /tmp/isr_roads.parquet \
#   https://production-raw-data-api.s3.amazonaws.com/ISO3/ISR/_layers/osm/roads.parquet
# npm run build:streets && npm run seed:streets
# To replace existing street rows (also clears street_marks): REPLACE_STREETS=1 npm run seed:streets
npm run dev
```

ברירת מנהל על: `admin@election.local` / `admin1234` (ניתן לשנות ב־env).

ימין = `ט` + `מחל` + `שס` + `ג`. ברירת מחדל: ימין ≥ 70%, הצבעה < 60%, בז״ב ≥ 300.

## רחובות ואשכולות
- שמות רחובות מגיעים מ־OpenStreetMap בלבד (ODbL).
- שדה `ashkol` ברחובות ריק עד להעלאת טבלת קישור; אז: `npm run import:cluster-streets -- links.json`.
