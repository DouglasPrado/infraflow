import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server-api";

/** PRD §6 — o produto tem apenas /login e /workspace/:id. */
export default async function Home() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  redirect("/workspace");
}
