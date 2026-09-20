import { ArchitectureDocumentSchema } from "@infraflow/schema";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getArchitecture, getSessionUser } from "@/lib/server-api";

export default async function WorkspacePage(props: PageProps<"/workspace/[id]">) {
  const [{ id }, session] = await Promise.all([props.params, getSessionUser()]);
  if (!session) redirect("/login");

  const architecture = await getArchitecture(id);
  // Id inválido ou de outro usuário: volta para a entrada, que resolve.
  if (!architecture) redirect("/workspace");

  const parsed = ArchitectureDocumentSchema.safeParse(architecture.document);
  if (!parsed.success) redirect("/workspace");

  return (
    <WorkspaceShell
      architectureId={architecture.id}
      document={parsed.data}
      user={session.user}
    />
  );
}
