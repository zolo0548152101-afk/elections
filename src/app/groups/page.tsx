import { redirect } from "next/navigation";

/** Legacy /groups URL — product has institutions only. */
export default function GroupsRedirectPage() {
  redirect("/institutions");
}
