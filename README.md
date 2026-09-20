# InfraFlow

Plataforma visual para planejamento, validação e execução de infraestrutura.

**Estágio:** Milestone 4 — Report Generator (PRD §73), concluído.
O protótipo foi aprovado (§68), o modelo de domínio é real (§70), a API persiste
em PostgreSQL, a web salva sozinha, a arquitetura é validada semanticamente e os
artefatos são gerados e baixados de verdade. Ainda **não** existem OpenTofu, k6,
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
  infra-registry  Catálogo e características de carga, livre de UI (§10, §42)
  infra-validator Validação semântica da arquitetura (§72)
  infra-analyzer  Motor de capacidade e gargalo (§37, §46)
  report-generator Artefatos derivados do documento (§32, §33, §73)
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
| `GET /architectures/:id/validation` | Validação semântica (§72) |
| `GET /architectures/:id/reports` | Artefatos disponíveis (§73) |
| `GET /architectures/:id/reports/:file` | Download do artefato (§73) |
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

## O que o validator olha

`@infraflow/validator` responde se a arquitetura **faz sentido** — distinto do
`validateIntegrity` do schema, que só pergunta se o documento é coerente consigo
mesmo. São as cinco famílias do §72:

| Família | Exemplos |
| --- | --- |
| `connection` | Banco originando tráfego para a aplicação; Load Generator entrando direto no banco; conexão marcada com o tipo errado |
| `dependency` | Balanceador sem destino; CDN sem origem; fila sem consumidor; Grafana sem fonte |
| `reachability` | Recurso solto no canvas; ilha que nenhuma origem alcança; dependência circular |
| `security` | Dado exposto na borda; bucket sem criptografia; balanceador sem HTTPS |
| `availability` | Uma réplica só; banco em zona única; cache que recusa escrita ao encher; teto de réplicas abaixo do desejado |

`error` bloqueia; `warning` informa. O resultado é determinístico — o mesmo
documento devolve a mesma lista, na mesma ordem, porque ela entra em relatório.

A validação **não bloqueia o autosave**: o canvas fica incoerente o tempo todo
enquanto se desenha. O mesmo pacote roda no cliente (feedback ao vivo no
Analysis Panel e na status bar) e na API (`GET /architectures/:id/validation`),
então as duas leituras nunca divergem.

## Artefatos gerados

`@infraflow/report-generator` produz ARCHITECTURE.md, CAPACITY.md, LOAD-TEST.md,
GOAL.md e architecture.json (§73). Tudo é **derivado do documento**: trocar o
banco muda o ARCHITECTURE.md, mexer nas réplicas muda o CAPACITY.md. Não há
texto fixo descrevendo a arquitetura.

A geração é determinística — mesma entrada, mesmo byte, sem data de geração no
corpo — porque o §4.3 pede isso e porque diff de documento gerado não pode mudar
à toa.

O preview do Export Panel e o botão de download consomem **a mesma rota**: o que
se lê na tela é byte a byte o que se baixa e o que um agente leria (§32).
Gerar a prévia no cliente e o arquivo no servidor seriam duas fontes de verdade
para o mesmo arquivo.

`CAPACITY.md` separa `Estimated` de `Observed` e só escreve a segunda seção
quando existe execução real. Enquanto não houver k6 (§77), ela diz exatamente
isso.

## Como a capacidade é calculada

Não há curva ajustada à mão. O `infra-analyzer` trabalha com três coisas que se
sustentam sozinhas:

**Propagação de tráfego.** A carga percorre o grafo e é atenuada por quem guarda
cache — um CDN com 72% de acerto entrega 28% à origem. Cada trecho exibe a sua
própria vazão (§22).

**Teoria de filas.** A latência sob carga vem de `W = S / (1 − ρ)`, a fórmula de
M/M/1, com `S` — tempo de serviço — declarado por recurso no registry. É ela que
faz a latência explodir perto da saturação, como o §24 descreve. O p95 sai do
quantil da soma ao longo do caminho, corrigido pela expansão de Cornish-Fisher.

**Saudável é o SLO.** A capacidade máxima saudável é o maior RPS em que os
critérios do §19 ainda são cumpridos, achado por busca binária. `Estimated`
guarda 30% de folga de planejamento; `Observed` vai até o limite — é o que
mantém os dois distinguíveis (§85).

Conexões simultâneas saem da **Lei de Little** (`L = λ·W`), não de um
coeficiente.

### O que ainda é estimativa

`capacityRps`, `monthlyCostUsd` e os tempos de serviço são valores de ordem de
grandeza declarados no registry, não medições. O motor é honesto; as entradas
ainda não vêm de observação. Isso muda com o k6 do Milestone 8 (§77) e a
Observabilidade do Milestone 9 (§78), quando estes números viram o ponto de
partida que a medição corrige.

Também se assume que **toda requisição exercita todas as dependências** do
recurso. É a hipótese conservadora; refinar isso pede peso por conexão, que
ainda não existe no schema.

O compiler determinístico de OpenTofu entra no Milestone 5 (§74).
