import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ניהול יום בחירות | אשכולות",
  description: "סינון ומיון אשכולות קלפי לפי אחוז הצבעה ואחוז ימין",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@600;700;800&family=Heebo:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthShell>{children}</AuthShell>
      </body>
    </html>
  );
}
