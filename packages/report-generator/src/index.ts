import { serializeArchitectureJson } from "@infraflow/schema";
import { architectureMd } from "./architecture.ts";
import { capacityMd } from "./capacity.ts";
import { goalMd } from "./goal.ts";
import { loadTestMd } from "./load-test.ts";
import type { ReportContext, ReportFile, ReportLanguage } from "./types.ts";

export * from "./types.ts";

interface ReportDefinition {
  name: string;
  language: ReportLanguage;
  description: string;
  render: (context: ReportContext) => string;
}

/** Os artefatos do PRD §73, na ordem em que a UI os lista (§30). */
const REPORTS: ReportDefinition[] = [
  {
    name: "ARCHITECTURE.md",
    language: "markdown",
    description: "Recursos, dependências e validação",
    render: architectureMd,
  },
  {
    name: "CAPACITY.md",
    language: "markdown",
    description: "Capacidade estimada e observada",
    render: capacityMd,
  },
  {
    name: "LOAD-TEST.md",
    language: "markdown",
    description: "Workload, perfil e resultado",
    render: loadTestMd,
  },
  {
    name: "GOAL.md",
    language: "markdown",
    description: "Instruções para agentes",
    render: goalMd,
  },
  {
    name: "architecture.json",
    language: "json",
    description: "Fonte estruturada para automação",
    render: (context) => serializeArchitectureJson(context.document),
  },
];

/** Metadados sem conteúdo — para listar sem gerar. */
export const REPORT_FILES = REPORTS.map(({ name, language, description }) => ({
  name,
  language,
  description,
}));

export function isReportName(name: string): boolean {
  return REPORTS.some((report) => report.name === name);
}

/** Gera um artefato. Devolve `undefined` para nome que não existe. */
export function generateReport(name: string, context: ReportContext): ReportFile | undefined {
  const report = REPORTS.find((candidate) => candidate.name === name);
  if (!report) return undefined;

  return {
    name: report.name,
    language: report.language,
    description: report.description,
    content: report.render(context),
  };
}

export function generateReports(context: ReportContext): ReportFile[] {
  return REPORTS.map((report) => ({
    name: report.name,
    language: report.language,
    description: report.description,
    content: report.render(context),
  }));
}

/** Tipo MIME do artefato, para a API responder o download. */
export function mediaTypeOf(language: ReportLanguage): string {
  return language === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8";
}
