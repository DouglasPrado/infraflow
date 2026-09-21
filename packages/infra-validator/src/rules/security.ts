import type { Topology } from "../topology.ts";
import type { ResolvedResource, ValidationIssue } from "../types.ts";

/**
 * Avisos de segurança (PRD §72 — *security warnings*).
 *
 * Duas fontes: a **posição** do recurso no grafo (o que está exposto ao
 * tráfego externo) e a **configuração** declarada nas propriedades (§14).
 * Nada aqui inspeciona nuvem real — é análise do desenho.
 */

/** Categorias que nunca deveriam receber tráfego externo de frente. */
const NEVER_PUBLIC = new Set(["database", "cache", "storage", "queue"]);

function text(resource: ResolvedResource, key: string): string {
  const value = resource.properties[key];
  return value === undefined ? "" : String(value);
}

export function securityIssues(topology: Topology): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const resource of topology.resources.values()) {
    if (topology.firstHop.has(resource.id) && resource.category && NEVER_PUBLIC.has(resource.category)) {
      issues.push({
        code: "datastore-exposed",
        category: "security",
        severity: "error",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" recebe tráfego externo diretamente.`,
        hint: "Coloque a aplicação na frente: dado não deve ser acessível a partir da borda.",
      });
    }

    if (resource.type === "aws.s3" && text(resource, "encryption") === "None") {
      issues.push({
        code: "storage-unencrypted",
        category: "security",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" está sem criptografia em repouso.`,
        hint: "Use SSE-S3 ou SSE-KMS.",
      });
    }

    if (resource.type === "aws.alb" && !/https/i.test(text(resource, "listeners"))) {
      issues.push({
        code: "traffic-without-tls",
        category: "security",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" não expõe listener HTTPS.`,
        hint: "Publique um listener HTTPS:443 — tráfego de borda em claro vaza credencial.",
      });
    }

    if (resource.type === "opensource.traefik" && resource.properties.tls === false) {
      issues.push({
        code: "traffic-without-tls",
        category: "security",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" está com TLS desligado.`,
        hint: "Ligue o TLS no entrypoint público.",
      });
    }

    // Aplicação recebendo tráfego externo de frente: sem terminação TLS nem
    // health check de borda, e com a porta da aplicação publicada.
    if (topology.firstHop.has(resource.id) && resource.category === "compute") {
      issues.push({
        code: "compute-exposed",
        category: "security",
        severity: "warning",
        subjectId: resource.id,
        message: `${resource.title} "${resource.name}" recebe tráfego externo sem balanceador na frente.`,
        hint: "Publique por trás de um balanceador — é onde o TLS termina e o health check acontece.",
      });
    }
  }

  return issues;
}
