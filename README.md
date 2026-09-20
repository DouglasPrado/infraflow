# InfraFlow

Plataforma visual para planejamento, validação e execução de infraestrutura.

**Estágio:** Milestone 2 — Persistence (PRD §71), concluído.
O protótipo foi aprovado (§68), o modelo de domínio é real (§70), a API persiste
em PostgreSQL e a web salva sozinha. Ainda **não** existem OpenTofu, k6,
integração com AWS nem LLM.

## Documentos

| Arquivo | Conteúdo |
| --- | --- |
| [`PRD.md`](PRD.md) | Fonte de verdade de escopo e comportamento |
| [`design.md`](design.md) | Design system do produto |

## Estrutura

```text
apps/
  web       Next.js — canvas, inspector, simulação (PRD §6–§30)
  api       Fastify + Prisma — persistência (PRD §48, §49, §71)
packages/
  infra-schema    Contrato do grafo e do architecture.json (PRD §33, §70)
  infra-registry  Catálogo de componentes, livre de UI (PRD §10, §42)
```

`infra-registry` não importa React: a API e os workers precisam dele para
estimar capacidade e, mais adiante, compilar OpenTofu. O ícone viaja como
identificador string e só vira componente na web.

## Rodando

```bash
pnpm install
docker compose up -d          # PostgreSQL 17 na porta 5434
pnpm --filter @infraflow/api db:deploy
pnpm dev                      # web em :3000, api em :3333
```

A web abre em [localhost:3000](http://localhost:3000). Crie uma conta na tela de
login — a primeira entrada gera a arquitetura demo do PRD §65 já persistida.

O botão "Continuar com GitHub" do §7 está indisponível: falta registrar um OAuth
App e configurar client id e secret.

A web fala com a API pelo rewrite `/api` do Next, na mesma origem, para o cookie
de sessão não depender de CORS.

## Qualidade

```bash
pnpm ci    # lint + typecheck + test + build em todos os workspaces
```

Os testes da API são de integração e **exigem o Postgres de pé**.

## API

| Rota | O quê |
| --- | --- |
| `GET /health` | Saúde do processo e do banco |
| `POST /auth/register` · `/auth/login` · `/auth/logout` | Sessão |
| `GET /auth/me` | Usuário da sessão |
| `POST /me/workspace` | Arquitetura de trabalho, criada na primeira vez |
| `GET /me/architectures` | Arquiteturas do usuário |
| `GET /architectures/:id` | Versão corrente do documento |
| `PUT /architectures/:id` | Autosave — grava por cima, não cria versão |
| `POST /architectures/:id/versions` | Snapshot explícito (§38) |
| `GET /architectures/:id/architecture.json` | Projeção de automação (§33) |

Todo documento é validado contra `@infraflow/schema` na entrada. Um documento
que passa no schema mas é incoerente — conexão apontando para node inexistente,
id duplicado — recebe `422`, não é gravado.

### Autenticação

Sessão opaca em cookie `httpOnly`, `SameSite=Lax`; só o hash do token vai para o
banco. Senha em scrypt com os parâmetros da OWASP — embutido no Node, sem
dependência nativa.

Toda leitura e escrita é escopada ao dono. Arquitetura de outro usuário responde
`404`, não `403`: `403` confirmaria que o recurso existe.

A API é fina de propósito (PRD §51): OpenTofu e k6 rodarão em workers isolados,
nunca nela.

## Dados mockados

`capacityRps`, `monthlyCostUsd`, os coeficientes de métrica e o resultado do
teste de carga seguem **determinísticos e mockados**, declarados no registry.
Nada é medido até a Observabilidade do Milestone 9 (§78). O compiler
determinístico de OpenTofu entra no Milestone 5 (§74).
