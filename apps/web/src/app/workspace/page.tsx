import { redirect } from "next/navigation";
import { createDemoEdges, createDemoNodes } from "@/lib/demo-architecture";
import { demoDocument } from "@/lib/document";
import { getSessionUser, resolveWorkspace } from "@/lib/server-api";

/**
 * Ponto de entrada sem id: manda para a arquitetura de trabalho do usuário,
 * criando-a na primeira vez a partir da arquitetura demo (PRD §65).
 */
export default async function WorkspaceEntry() {
  if (!(await getSessionUser())) redirect("/login");

  const workspace = await resolveWorkspace(
    demoDocument(createDemoNodes(), createDemoEdges()),
  );
  if (!workspace) redirect("/login");

  redirect(`/workspace/${workspace.architectureId}`);
}
