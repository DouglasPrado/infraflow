# InfraFlow

Plataforma visual para planejamento, validação e execução de infraestrutura.

**Estágio atual: Milestone 0 — Prototype.**
Nenhuma infraestrutura real é provisionada. Não há backend, banco de dados,
autenticação real, OpenTofu, k6, AWS ou LLM (PRD §55, §88).

## Documentos

| Arquivo | Conteúdo |
| --- | --- |
| [`PRD.md`](PRD.md) | Fonte de verdade de escopo e comportamento |
| [`design.md`](design.md) | Design system do protótipo |

## Rodando

```bash
pnpm install
pnpm dev
```

Abra [http://localhost:3000](http://localhost:3000). O login é simulado e leva a
`/workspace/demo`, que abre com a arquitetura demo do PRD §65.

## Qualidade

```bash
pnpm lint          # ESLint
pnpm exec tsc --noEmit
pnpm build
```

## Stack

Next.js · React · TypeScript · React Flow (`@xyflow/react`) · Tailwind CSS ·
shadcn/ui · Zustand · Lucide.

## Estrutura

```text
src/
  app/                      /login e /workspace/[id] (PRD §6)
  components/
    canvas/                 nodes e edges do React Flow
    workspace/              top bar, library, inspector, status bar
    ui/                     shadcn/ui
  lib/
    catalog.ts              catálogo de componentes, mockado (PRD §10)
    demo-architecture.ts    cenário inicial (PRD §65, §66)
    simulation.ts           simulação e análise mockadas (PRD §20, §21, §24)
    reports.ts              artefatos de exportação (PRD §30–§34)
  store/
    workspace-store.ts      canvas, histórico e simulação
```

## Dados mockados

Capacidade, custo, métricas de gargalo e resultado do teste de carga são
**determinísticos e mockados** — derivados de `capacityRps` e `monthlyCostUsd`
declarados no catálogo. Nada é medido. O compiler determinístico de OpenTofu só
entra no Milestone 5 (PRD §74).
