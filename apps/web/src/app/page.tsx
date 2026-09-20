import { redirect } from "next/navigation";

/** PRD §6 — o produto tem apenas /login e /workspace/:id. */
export default function Home() {
  redirect("/login");
}
