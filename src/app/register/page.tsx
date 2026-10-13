import { Suspense } from "react";
import { RegisterPoster } from "@/components/RegisterPoster";

export const metadata = {
  title: "רישום פעילים",
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="register-poster"><p>טוען…</p></main>}>
      <RegisterPoster />
    </Suspense>
  );
}
