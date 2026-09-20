# InfraFlow

Plataforma visual para planejamento, validação e execução de infraestrutura.

**Estágio:** Milestone 6 — Plan (PRD §75), concluído.
O canvas compila para OpenTofu e um worker isolado roda `tofu init` e
`tofu plan` de verdade, com o resultado dentro do workspace. Ainda **não** há
`apply`, k6 nem LLM.

## Documentos

| Arquivo | Conteúdo |
| --- | --- |
| [`PRD.md`](PRD.md) | Fonte de verdade de escopo e comportamento |
| [`design.md`](design.md) | Design system do produto |

## Estrutura

```text
apps/
  web       Next.js — canvas, inspector, simulação (PRD §6–§30)
  api       Fastify — persistência e enfileiramento (PRD §48, §71)
  worker    BullMQ — OpenTofu em processo isolado (PRD §51)
packages/
  db              Schema Prisma e cliente, compartilhados (PRD §49)
  infra-schema    Contrato do grafo, do architecture.json e dos jobs (§33, §50)
  infra-registry  Catálogo e características de carga, livre de UI (§10, §42)
  infra-validator Validação semântica da arquitetura (§72)
  infra-analyzer  Motor de capacidade e gargalo (§37, §46)
  report-generator Artefatos derivados do documento (§32, §33, §73)
  infra-compiler   Grafo → modelo de OpenTofu (§74)
  opentofu-generator Modelo → HCL no formato canônico (§34)
```

`infra-registry` não importa React: a API e os workers precisam dele para
estimar capacidade e, mais adiante, compilar OpenTofu. O ícone viaja como
identificador string e só vira componente na web.

## Rodando

```bash
pnpm install
docker compose up -d          # PostgreSQL 17 (:5434) e Redis 8 (:6381)
pnpm --filter @infraflow/db db:deploy
pnpm dev                      # web :3000 · api :3333 · worker na fila
```

O worker precisa do **OpenTofu** no PATH para executar `plan`. Sem ele, a
execução falha com a mensagem do sistema — e a falha aparece no workspace, que
é o comportamento correto.

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
| `GET /architectures/:id/opentofu` | Arquivos compilados e avisos (§74) |
| `GET /architectures/:id/opentofu/:file` | Download do `.tf` (§34) |
| `POST /architectures/:id/runs` | Enfileira um `tofu plan` (§75) |
| `GET /architectures/:id/runs` | Execuções da arquitetura |
| `GET /runs/:id` | Execução com o log do OpenTofu |
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

## Compilação para OpenTofu

O pipeline do §74 é literal: grafo → modelo de OpenTofu → `.tf` → `tofu fmt` →
`tofu validate`.

O compiler **não concatena string**. Monta uma árvore tipada
(`@infraflow/opentofu-generator`) e imprime já no formato canônico do
`tofu fmt` — sair formatado evita que cada regeneração vire diff falso. O
`tofu fmt -check` roda na suíte de testes sempre que o OpenTofu estiver
instalado.

A parte que só um canvas sabe fazer é a fiação: **a conexão do desenho vira
regra de grupo de segurança**. Um ALB ligado a um ECS abre a porta da aplicação
só para aquele balanceador; um ECS ligado a um RDS abre a 5432 só para aquele
serviço; só quem é porta de entrada aceita `0.0.0.0/0`.

Escopo do §74: VPC, ALB, ECS, RDS, S3 e Redis (ElastiCache). A VPC não vem de
node nenhum — é o chão que os outros precisam. Tipo fora dessa lista **não é
traduzido por aproximação**: vira aviso com a alternativa que o registry já
conhece (§29). Inventar equivalência silenciosa é o risco de IaC incorreta do
§85.

Decisões que ficam registradas como aviso, não escondidas no código:

- a VPC sai sem NAT Gateway — compute em sub-rede pública com IP público, dado
  no privado;
- a senha do RDS fica no Secrets Manager (`manage_master_user_password`), então
  não existe segredo em `tfvars` nem no state (§52);
- listener HTTPS exige `certificate_arn` antes do apply.

```bash
# valida contra o provider real da AWS (baixa ~766 MB na primeira vez)
INFRAFLOW_TOFU_VALIDATE=1 pnpm --filter @infraflow/compiler test
```

## Execução: o worker

A API **nunca** executa OpenTofu. Ela grava a execução, põe o id na fila e
responde `202`; quem roda é o `apps/worker`, em outro processo. O §51 é literal
nisso — "nunca executar testes pesados diretamente no servidor da API".

O job carrega só o id: job que leva o documento envelhece na fila e passa a
executar uma arquitetura que já mudou.

Cada execução recebe **seu próprio diretório**, criado do zero, sob
`apps/worker/var/runs/<slug>` (§52, §53). O processo filho **não herda o
ambiente do worker** — recebe uma lista explícita, senão a URL do banco chegaria
ao provider. Há teto de tempo e a saída é truncada pela cauda, que é onde o erro
aparece.

O plano é lido de `tofu show -json`, nunca do texto: a saída humana muda entre
versões, e regex nela erraria em silêncio.

Dois alvos:

| Alvo | O que planeja | Credencial |
| --- | --- | --- |
| `aws` | Os recursos do §74 | Precisa de credencial da AWS |
| `docker` | Containers equivalentes, para o laboratório do §76 | Nenhuma |

### Limitação conhecida (§52)

A credencial de nuvem usada é a **do próprio worker** — a que estiver no
ambiente ou em `~/.aws`. O §52 pede credencial por projeto, e isso não existe
ainda: um worker compartilhado planejaria arquiteturas de vários projetos com a
mesma identidade. Antes de uso multiusuário, isso precisa mudar.

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

A execução do OpenTofu entra no Milestone 6 (§75), num worker isolado — nunca
na API (§51).
