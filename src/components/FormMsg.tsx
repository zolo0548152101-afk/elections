"use client";

type Kind = "ok" | "err" | "info";

/** Accessible form/status banner; errors are sticky alerts, success can auto-dismiss via parent. */
export function FormMsg({
  kind,
  children,
  sticky = false,
}: {
  kind: Kind;
  children: React.ReactNode;
  sticky?: boolean;
}) {
  const isErr = kind === "err";
  return (
    <p
      className={[
        "form-msg",
        kind === "ok" ? "form-msg-ok" : "",
        isErr ? "form-msg-err" : "",
        sticky || kind === "ok" ? "form-msg-sticky" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={isErr ? "alert" : "status"}
      aria-live={isErr ? "assertive" : "polite"}
    >
      {children}
    </p>
  );
}
