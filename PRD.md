# PRD — InfraFlow

**Versão:** 1.0
**Status:** Planejamento
**Nome provisório:** InfraFlow
**Tipo:** Plataforma visual para planejamento, validação e execução de infraestrutura
**Estratégia de desenvolvimento:** Prototype First
**Stack inicial:** Next.js + React + React Flow + TypeScript
**Regra principal:** nenhuma infraestrutura real será provisionada antes da aprovação do protótipo.

---

# 1. Visão do Produto

InfraFlow é uma plataforma visual para projetar arquiteturas de infraestrutura através de um canvas semelhante ao FigJam.

O usuário constrói sua infraestrutura arrastando componentes para a tela, conectando-os e configurando propriedades.

Exemplo:

```text
Load Generator
      ↓
CloudFront
      ↓
ALB
      ↓
ECS
   ┌──┴──┐
   ↓     ↓
 Redis   RDS
          │
          ↓
          S3
```

Cada elemento do canvas representa um recurso real ou abstrato de infraestrutura.

Exemplos:

```text
AWS
EC2
ECS
Lambda
RDS
S3
CloudFront
ALB
SQS

Open Source
PostgreSQL
Redis
MinIO
Traefik
RabbitMQ
NATS
Prometheus
Grafana
```

O produto não será apenas uma ferramenta de desenho.

O canvas será a representação visual de um modelo estruturado de infraestrutura capaz de futuramente:

* validar arquiteturas;
* estimar capacidade;
* estimar custo;
* detectar problemas;
* executar testes de carga;
* identificar gargalos;
* comparar versões;
* gerar documentação;
* gerar OpenTofu;
* gerar instruções para Claude Code e Codex;
* provisionar ambientes de teste.

---

# 2. Problema

O planejamento de infraestrutura normalmente fica dividido entre diversas ferramentas.

Arquitetura:

```text
FigJam
Miro
Draw.io
Lucidchart
```

Infraestrutura:

```text
Terraform
OpenTofu
CloudFormation
Pulumi
```

Teste de carga:

```text
k6
JMeter
Locust
```

Observabilidade:

```text
Grafana
Prometheus
CloudWatch
Datadog
```

Documentação:

```text
Markdown
Notion
Confluence
README
```

Desenvolvimento assistido por IA:

```text
Claude Code
Codex
Cursor
```

O problema é que o diagrama raramente é a fonte de verdade.

Normalmente acontece:

```text
Diagrama
   ↓
Desenvolvedor interpreta
   ↓
Terraform é criado
   ↓
Infra muda
   ↓
Diagrama fica desatualizado
```

InfraFlow pretende substituir esse processo por:

```text
Canvas
   ↓
Infrastructure Graph
   ↓
Validação
   ↓
Simulação
   ↓
OpenTofu
   ↓
Teste
   ↓
Resultado
   ↓
Documentação
```

---

# 3. Proposta de Valor

A proposta central é:

> Transformar um diagrama visual de infraestrutura em um modelo executável, testável e documentável.

O usuário deverá conseguir sair de:

```text
"Quero uma aplicação web escalável."
```

para:

```text
Arquitetura definida
Capacidade avaliada
Gargalos identificados
OpenTofu gerado
Teste de carga documentado
Plano de implementação gerado
```

sem sair da tela principal.

---

# 4. Princípios do Produto

## 4.1 Canvas como fonte de verdade

O canvas representa a infraestrutura.

Não será apenas uma imagem.

Cada node possui estrutura de dados própria.

---

## 4.2 Infraestrutura como grafo

Internamente:

```text
Node
Edge
Node
Edge
Node
```

Exemplo:

```json
{
  "nodes": [],
  "edges": []
}
```

React Flow será somente a camada visual.

---

## 4.3 Geração determinística

OpenTofu não deverá ser gerado livremente por uma LLM.

Fluxo:

```text
Canvas
↓
Infrastructure Graph
↓
Compiler
↓
OpenTofu
```

A IA pode:

* analisar;
* explicar;
* sugerir;
* documentar.

Mas a transformação de recursos conhecidos deverá ser determinística.

---

## 4.4 Prototype First

O primeiro objetivo não é provisionar infraestrutura.

O primeiro objetivo é validar:

* experiência;
* ergonomia;
* hierarquia;
* fluxo;
* linguagem visual;
* comportamento do canvas.

Somente depois da aprovação começará a implementação funcional.

---

# 5. Usuário-Alvo Inicial

Principal usuário:

```text
Software Developer
Tech Lead
Software Architect
DevOps Engineer
Platform Engineer
CTO técnico
```

Perfil:

* entende conceitos de infraestrutura;
* nem sempre domina todos os serviços de cloud;
* quer comparar soluções;
* quer planejar antes de implementar;
* utiliza IA para desenvolvimento;
* trabalha com aplicações web e APIs.

---

# 6. Escopo de Interface

O produto terá inicialmente apenas duas páginas.

```text
/login
/workspace/:id
```

Todo o restante acontecerá dentro do workspace.

Não serão criadas páginas separadas para:

* configurações;
* testes;
* relatórios;
* recursos;
* análises.

Essas funcionalidades utilizarão:

* drawers;
* sidebars;
* dialogs;
* popovers;
* command palette.

---

# 7. Tela de Login

A tela de login será extremamente simples.

Elementos:

```text
Logo

InfraFlow

Planeje.
Teste.
Evolua sua infraestrutura.

[ Continuar com GitHub ]

ou

E-mail
Senha

[ Entrar ]
```

No protótipo, autenticação será simulada.

---

# 8. Workspace Principal

Estrutura:

```text
┌───────────────────────────────────────────────────────────┐
│ TOP BAR                                                   │
├──────────┬───────────────────────────────────┬────────────┤
│          │                                   │            │
│ Library  │                                   │ Properties │
│          │              Canvas               │            │
│          │                                   │ Analysis   │
│          │                                   │            │
├──────────┴───────────────────────────────────┴────────────┤
│ STATUS / CAPACITY / COST / BOTTLENECK                     │
└───────────────────────────────────────────────────────────┘
```

---

# 9. Top Bar

Elementos:

```text
InfraFlow

Projeto
Arquitetura Web

Provider
AWS

Environment
dev

[ Analisar ]
[ Teste de carga ]
[ Gerar Markdown ]
[ OpenTofu ]
```

Também:

```text
Salvar

Undo
Redo

Zoom

Command Palette
```

Atalho:

```text
⌘ K
```

---

# 10. Component Library

Sidebar esquerda.

Busca:

```text
Buscar recursos...
```

Categorias iniciais:

## Compute

```text
EC2
ECS
Lambda
Docker
Kubernetes
```

## Storage

```text
S3
MinIO
```

## Database

```text
RDS
PostgreSQL
MySQL
```

## Cache

```text
Redis
ElastiCache
```

## Network

```text
ALB
NLB
CloudFront
Traefik
Nginx
```

## Messaging

```text
SQS
RabbitMQ
NATS
Kafka
```

## Observability

```text
Prometheus
Grafana
CloudWatch
OpenTelemetry
```

## Testing

```text
Load Generator
```

---

# 11. Drag and Drop

O usuário deverá poder:

```text
Library
   ↓ drag
Canvas
   ↓
Node criado
```

Ao soltar:

1. node aparece;
2. recebe posição;
3. recebe configuração padrão;
4. fica selecionado;
5. properties sidebar abre automaticamente.

---

# 12. Nodes

Cada node deverá possuir visual compacto.

Exemplo:

```text
┌──────────────────────────┐
│ AWS                      │
│ 🟧 ECS Service           │
│                          │
│ 2 replicas               │
│ 2 vCPU / 4GB             │
│                          │
│ ● Healthy                │
└──────────────────────────┘
```

Estados:

```text
Default
Selected
Warning
Error
Running
Healthy
Bottleneck
Disabled
```

---

# 13. Connections

Nodes poderão ser conectados visualmente.

Exemplo:

```text
ECS ─────→ PostgreSQL
```

O edge poderá futuramente carregar informações.

Exemplo:

```text
HTTP
TCP
Database
Queue
Storage
```

No protótipo, a ligação será apenas visual.

---

# 14. Properties Panel

Sidebar direita.

Ao clicar em:

```text
ECS
```

mostrar:

```text
ECS Service

Name
api-service

CPU
2 vCPU

Memory
4GB

Desired replicas
2

Minimum replicas
2

Maximum replicas
10

Auto Scaling
Enabled
```

Dados serão mockados no protótipo.

---

# 15. Load Generator

Esse será um node especial.

Ele será o ponto inicial para configuração do teste.

Exemplo:

```text
┌──────────────────────────┐
│ ⚡ Capacity Test         │
│                          │
│ 100 → 10K req/s          │
│                          │
│ 4 endpoints              │
│ p95 < 500ms              │
└──────────────────────────┘
```

Fluxo:

```text
Load Generator
      ↓
CloudFront
      ↓
ALB
      ↓
ECS
```

---

# 16. Configuração do Load Generator

Ao selecionar o node:

## Target

```text
Base URL

https://api.example.com
```

Campos:

```text
Protocol
Base URL
Headers
Authentication
Timeout
```

---

# 17. Workload

Será possível criar endpoints.

Exemplo:

```text
GET /products
40%

GET /products/:id
30%

POST /login
20%

POST /checkout
10%
```

Cada endpoint terá futuramente:

```text
Method
Path
Weight
Headers
Body
Variables
Authentication
```

No protótipo será apenas uma configuração visual mockada.

---

# 18. Load Profile

Tipos previstos:

```text
Smoke
Constant
Ramp
Capacity
Spike
Stress
Soak
```

Primeiro perfil implementado futuramente:

```text
Capacity
```

Configuração:

```text
Start

100 req/s

Increment

+100 req/s

Every

30s

Maximum

10.000 req/s
```

---

# 19. SLO

Critérios do teste:

```text
p95 < 500ms

p99 < 1000ms

errors < 1%
```

Futuramente:

```text
CPU
Memory
Connections
IOPS
Queue depth
```

---

# 20. Test Run

Botão:

```text
▶ Teste de carga
```

No protótipo, clicar não executará k6.

Será apresentada uma simulação visual.

Exemplo:

```text
100 req/s     ✓
250 req/s     ✓
500 req/s     ✓
1000 req/s    ✓
1500 req/s    ✓
2000 req/s    ✓
2500 req/s    ⚠
3000 req/s    ✕
```

Resultado:

```text
Maximum Healthy Capacity

2.400 req/s
```

---

# 21. Visualização de Gargalo

Durante a simulação:

```text
Load Generator
     🟢
      ↓
CloudFront
     🟢
      ↓
ALB
     🟢
      ↓
ECS
     🟡
    /   \
Redis   RDS
 🟢     🔴
```

RDS poderá receber:

```text
BOTTLENECK
```

ou:

```text
CPU 96%
```

Essa experiência deverá existir já no protótipo.

---

# 22. Live Edge Metrics

Como conceito visual, conexões poderão apresentar:

```text
2.4K req/s
```

Exemplo:

```text
Load Generator
      │
      │ 2.4K req/s
      ▼
     ALB
```

No protótipo os números serão simulados.

---

# 23. Analysis Panel

Sidebar direita poderá alternar:

```text
Properties
Analysis
Commands
```

Analysis:

```text
Estimated Capacity

1.2K req/s

Estimated Cost

US$ 387/month

Resources

8

Warnings

2
```

---

# 24. Bottleneck Analysis

Exemplo:

```text
Gargalo detectado

RDS PostgreSQL

CPU
96%

Connections
91%

Latency
310ms
```

Explicação:

```text
O aumento da latência coincide com
a saturação de CPU no PostgreSQL.
```

Separar visualmente:

```text
Observed
```

e:

```text
Suggested
```

---

# 25. Recomendações

Exemplo:

```text
Possible improvements

Upgrade database instance

Enable connection pooling

Add read replica

Review expensive queries
```

No protótipo serão dados mockados.

---

# 26. Bottom Status Bar

Rodapé permanente.

Exemplo:

```text
Architecture
✓ Valid

Capacity
1.2K req/s

Cost
US$ 387

Resources
8

⚠ Bottleneck: RDS
```

---

# 27. Notas no Canvas

Permitiremos elementos visuais não executáveis.

Exemplo:

```text
Sticky Note
Text
Group
Section
```

Isso permitirá explicar decisões diretamente no diagrama.

Exemplo:

```text
"Escalonamento automático baseado
em CPU e requisições."
```

---

# 28. Groups

Será possível agrupar recursos.

Exemplo:

```text
┌ Application ──────────┐
│                       │
│ ALB → ECS → Redis      │
│                       │
└───────────────────────┘
```

Outro exemplo:

```text
Observability

Prometheus
Grafana
OpenTelemetry
```

---

# 29. Alternativas

Um recurso poderá apresentar uma alternativa.

Exemplo:

```text
S3

Alternative:
MinIO
```

Visualmente:

```text
S3 ⇄ MinIO
```

No futuro isso poderá permitir troca de providers.

---

# 30. Export Panel

Área:

```text
Exportação
```

Mostrar:

```text
ARCHITECTURE.md

CAPACITY.md

LOAD-TEST.md

GOAL.md

architecture.json

main.tf
```

No protótipo os arquivos não precisam ser produzidos corretamente.

O objetivo é validar a UX.

---

# 31. Preview de Markdown

Ao clicar:

```text
ARCHITECTURE.md
```

abrir drawer.

Exemplo:

```markdown
# Architecture

Internet
↓
CloudFront
↓
Application Load Balancer
↓
ECS

Dependencies:

- PostgreSQL
- Redis
- S3
```

---

# 32. GOAL.md

O sistema futuramente deverá gerar um documento específico para agentes.

Exemplo:

```markdown
# Goal

Implement the infrastructure described
by architecture.json.

## Requirements

Validate OpenTofu.

Run plan.

Provision infrastructure.

Deploy application.

Execute load test.

Document deviations.
```

Objetivo:

```text
InfraFlow
    ↓
GOAL.md
    ↓
Claude Code / Codex
```

---

# 33. architecture.json

Principal fonte estruturada para automação.

Estrutura conceitual:

```json
{
  "version": 1,
  "nodes": [],
  "edges": [],
  "loadTests": [],
  "environments": []
}
```

Esse arquivo deverá possuir prioridade sobre documentos gerados.

---

# 34. OpenTofu

Fluxo futuro:

```text
architecture.json
        ↓
Infrastructure Compiler
        ↓
OpenTofu
        ↓
tofu plan
        ↓
tofu apply
```

O usuário poderá gerar:

```text
providers.tf

main.tf

variables.tf

outputs.tf

terraform.tfvars.example
```

---

# 35. Load Test Architecture

Implementação futura:

```text
InfraFlow
    ↓
Test Controller
    ↓
┌───────────────┐
│ OpenTofu      │
├───────────────┤
│ k6            │
├───────────────┤
│ Metrics       │
└───────────────┘
```

---

# 36. Observabilidade

Arquitetura futura:

```text
Application
      ↓
OpenTelemetry
      ↓
Metrics Collector
      ↓
Prometheus
```

O resultado deverá voltar para o graph.

---

# 37. Bottleneck Engine

Entradas:

```text
RPS
Latency
Error rate

CPU
RAM
Network
Connections
IOPS
Queue size
```

Saída:

```text
nodeId

metric

value

timestamp

confidence
```

Exemplo:

```json
{
  "nodeId": "postgres-primary",
  "metric": "cpu",
  "value": 96,
  "confidence": 0.94
}
```

---

# 38. Versionamento de Arquitetura

Mudanças relevantes deverão gerar versões.

```text
Architecture v1
Architecture v2
Architecture v3
```

Exemplo:

```text
v1
1200 req/s
RDS bottleneck

v2
2800 req/s
RDS bottleneck

v3
5400 req/s
ECS bottleneck
```

---

# 39. Comparison

Futuramente:

```text
Compare v2 ↔ v3
```

Mostrar:

```text
Capacity

2.8K → 5.4K

Cost

$320 → $410

p95

410ms → 230ms
```

---

# 40. Cost Analysis

Futuramente:

```text
Estimated Monthly Cost

ECS          $120
RDS          $160
Redis         $70
S3            $12
CloudFront    $34

Total

$396/month
```

---

# 41. Efficiency

Indicador futuro:

```text
Cost / 1K req/s
```

Exemplo:

```text
Architecture A

$100 / 1K req/s

Architecture B

$75 / 1K req/s
```

---

# 42. Infrastructure Registry

Todo componente virá de um registry.

Exemplo conceitual:

```ts
interface InfrastructureComponent {
  id: string
  name: string
  category: string
  provider: string

  inputs: Port[]
  outputs: Port[]

  properties: PropertySchema[]

  analyzer?: AnalyzerDefinition
  compiler?: CompilerDefinition
}
```

---

# 43. Categorias do Registry

```text
compute
database
cache
storage
network
queue
observability
testing
external
generic
```

---

# 44. Provider

Exemplo:

```text
aws.ecs
aws.rds
aws.s3

opensource.postgresql
opensource.redis
opensource.minio
```

---

# 45. Abstrações

Posteriormente poderemos criar nodes abstratos.

Exemplo:

```text
Object Storage
```

com opções:

```text
AWS → S3

Self Hosted → MinIO
```

Outro:

```text
Queue

AWS → SQS

Self Hosted → RabbitMQ
```

---

# 46. Stack

## Monorepo

```text
pnpm
Turbo
```

Estrutura futura:

```text
apps/

  web
  api
  worker

packages/

  ui

  infra-schema

  infra-registry

  infra-validator

  infra-analyzer

  infra-compiler

  opentofu-generator

  load-engine

  report-generator
```

---

# 47. Frontend

```text
Next.js
React
TypeScript

React Flow

TailwindCSS
shadcn/ui

Zustand

Zod
```

---

# 48. Backend futuro

Preferência:

```text
Node.js
TypeScript
```

Possibilidades:

```text
Fastify
```

ou:

```text
NestJS
```

---

# 49. Persistence futura

```text
PostgreSQL
Prisma
```

---

# 50. Jobs futuros

Para:

```text
OpenTofu execution
Load testing
Metrics collection
Reports
```

usar:

```text
Redis
BullMQ
```

---

# 51. Infraestrutura de execução

Workers isolados.

Exemplo:

```text
API
 │
 ▼
Queue
 │
 ▼
Worker
 │
 ├─ OpenTofu
 ├─ k6
 └─ Reports
```

Nunca executar testes pesados diretamente no servidor da API.

---

# 52. Segurança futura

Testes de infraestrutura deverão executar em ambientes isolados.

Nunca compartilhar:

```text
filesystem
credentials
network
state
```

entre projetos.

---

# 53. Projeto de Teste

Cada execução terá ID próprio.

Exemplo:

```text
load-test-01J8Z2F
```

Infra temporária:

```text
infraflow-test-01J8Z2F
```

---

# 54. Cleanup

Após testes:

```text
tofu destroy
```

O sistema deverá possuir mecanismos futuros para detectar ambientes órfãos.

---

# 55. Fases do Produto

## Milestone 0 — Prototype

Objetivo:

> Validar completamente a experiência visual antes de construir infraestrutura real.

### Deve funcionar visualmente

```text
Login

Component library

Drag and drop

React Flow canvas

Connections

Node selection

Properties

Load Generator

Workload editor

Load configuration

Mock analysis

Mock load test

Mock bottleneck

Export preview

Bottom status bar
```

### Não implementar

```text
Backend

Database

Authentication real

OpenTofu real

k6 real

AWS APIs

Prometheus

OpenTelemetry

Cloud provisioning

LLM

Cost APIs
```

---

# 56. Milestone 0.1 — Foundation

Criar:

```text
Next.js

TypeScript

Tailwind

shadcn/ui

React Flow

Zustand
```

Rotas:

```text
/login

/workspace/demo
```

---

# 57. Milestone 0.2 — Canvas

Implementar:

```text
grid

pan

zoom

select

move

connect

delete

multi-select
```

Também:

```text
undo

redo
```

---

# 58. Milestone 0.3 — Component Library

Criar visualmente:

```text
EC2
ECS
Lambda
S3
MinIO
RDS
PostgreSQL
Redis
ALB
CloudFront
SQS
Traefik
Prometheus
Grafana
Load Generator
```

Todos com dados mockados.

---

# 59. Milestone 0.4 — Properties

Cada tipo deverá apresentar propriedades relevantes.

Exemplo ECS:

```text
CPU

Memory

Replicas

Autoscaling
```

RDS:

```text
Engine

Instance

Storage

Multi-AZ
```

---

# 60. Milestone 0.5 — Load Generator

Deverá permitir visualmente:

```text
Target URL

Endpoints

Weights

Start RPS

Increment

Interval

Maximum RPS

p95 threshold

Error threshold
```

---

# 61. Milestone 0.6 — Simulation

Ao clicar:

```text
Teste de Carga
```

executar uma animação simulada.

Exemplo:

```text
100

250

500

1000

1500

2000

2500

3000
```

Atualizar nodes durante a simulação.

---

# 62. Milestone 0.7 — Bottleneck Visualization

Em determinado ponto:

```text
RDS
```

deverá mudar:

```text
Healthy

↓

Warning

↓

Bottleneck
```

Mostrando:

```text
CPU 96%

Connections 91%
```

---

# 63. Milestone 0.8 — Report Preview

Mostrar arquivos:

```text
ARCHITECTURE.md

CAPACITY.md

LOAD-TEST.md

GOAL.md

main.tf
```

Conteúdo mockado baseado no exemplo presente no canvas.

---

# 64. Milestone 0.9 — Polish

Validar:

```text
spacing

colors

typography

icons

transitions

empty states

hover states

selection

zoom behavior
```

---

# 65. Prototype Demo Architecture

O protótipo deverá abrir inicialmente com esta arquitetura:

```text
Load Generator
      ↓
CloudFront
      ↓
ALB
      ↓
ECS
   ┌──┼──┐
   ↓  ↓  ↓
 RDS Redis S3
```

Com:

```text
MinIO
```

apresentado como alternativa ao S3.

Também:

```text
Prometheus
→
Grafana
```

como grupo de observabilidade.

---

# 66. Cenário do Prototype

Contexto:

```text
E-commerce API
```

Load Generator:

```text
GET /products       40%

GET /products/:id   30%

POST /login         20%

POST /checkout      10%
```

Teste:

```text
Start

100 req/s

Increment

+250 req/s

Interval

30 seconds

Maximum

5K req/s
```

---

# 67. Resultado Simulado

```text
Maximum healthy throughput

2.4K req/s

Breaking point

3.0K req/s

p95

320ms

Errors

0.2%
```

Gargalo:

```text
RDS PostgreSQL
```

Métricas:

```text
CPU

96%

Connections

91%
```

---

# 68. Gate de Aprovação do Protótipo

Nenhum milestone posterior poderá ser iniciado antes dessa validação.

Critérios obrigatórios:

### Canvas

Arrastar recursos deve parecer natural.

### Nodes

Informações devem ser compreensíveis sem abrir propriedades.

### Connections

Deve ficar evidente como os recursos estão relacionados.

### Properties

Configuração não pode poluir o canvas.

### Load Generator

Deve ficar evidente que esse node representa a origem do teste.

### Test Simulation

Deve ser visualmente compreensível onde está acontecendo a degradação.

### Bottleneck

O gargalo deve ser identificável sem consultar gráficos externos.

### Reports

Deve ficar evidente que a arquitetura pode virar documentação e código.

### Complexidade

A interface não pode parecer uma IDE tradicional.

Deve continuar tendo simplicidade semelhante a:

```text
FigJam
Miro
Linear
```

---

# 69. Resultado Esperado do Prototype

O usuário deve conseguir entender o produto apenas fazendo:

```text
Arrastar

↓

Conectar

↓

Configurar

↓

Testar

↓

Encontrar gargalo

↓

Exportar
```

Sem tutorial obrigatório.

---

# 70. Milestone 1 — Infrastructure Graph

**Somente após aprovação.**

Substituir mocks por modelo real.

Implementar:

```text
node schema

edge schema

component registry

validation

serialization

architecture.json
```

---

# 71. Milestone 2 — Persistence

Adicionar:

```text
projects

architectures

versions

nodes

edges

settings
```

Autosave.

---

# 72. Milestone 3 — Architecture Validator

Detectar:

```text
connections invalid

missing dependencies

unreachable resources

security warnings

availability problems
```

---

# 73. Milestone 4 — Report Generator

Gerar:

```text
ARCHITECTURE.md

CAPACITY.md

GOAL.md

architecture.json
```

Ainda sem provisionamento.

---

# 74. Milestone 5 — OpenTofu Compiler

Primeiros componentes:

```text
AWS VPC

ALB

ECS

RDS

S3

Redis
```

Pipeline:

```text
Graph
↓

OpenTofu AST/model
↓

.tf
↓

tofu fmt

↓

tofu validate
```

---

# 75. Milestone 6 — Plan

Adicionar:

```text
tofu init

tofu plan
```

Mostrar resultado dentro do workspace.

Ainda sem:

```text
apply
```

automático.

---

# 76. Milestone 7 — Infrastructure Lab

Permitir criar infraestrutura temporária.

Fluxo:

```text
Create Lab

↓

OpenTofu apply

↓

Deploy

↓

Ready
```

---

# 77. Milestone 8 — Real Load Testing

Adicionar:

```text
k6
```

O Load Generator do canvas vira configuração real.

---

# 78. Milestone 9 — Observability

Adicionar:

```text
OpenTelemetry

Prometheus
```

Associar métricas reais aos nodes.

---

# 79. Milestone 10 — Bottleneck Analyzer

Correlacionar:

```text
load

latency

errors

infrastructure metrics
```

e apontar candidatos a gargalo.

---

# 80. Milestone 11 — Architecture Versions

Permitir:

```text
Clone

Modify

Test

Compare
```

Fluxo:

```text
v1
↓
test
↓
modify
↓
v2
↓
test
↓
compare
```

---

# 81. Milestone 12 — AI Assistant

Somente depois do motor determinístico funcionar.

IA poderá:

```text
explain architecture

explain bottleneck

suggest improvements

explain tradeoffs

generate documentation

prepare agent instructions
```

---

# 82. Não Objetivos do MVP

Não serão prioridade:

```text
Kubernetes completo

multi-cloud completo

200+ recursos AWS

real-time collaboration

mobile editor

automatic production deployment

full FinOps

full observability platform

network packet simulation
```

---

# 83. Métricas de Produto

Posteriormente acompanhar:

```text
Architecture created

Node added

Architecture analyzed

Load test configured

Load test executed

Report generated

OpenTofu generated

Plan executed
```

---

# 84. Métricas de Experiência

O protótipo deve permitir:

```text
Create architecture

< 5 minutes

Configure load test

< 2 minutes

Understand bottleneck

< 10 seconds
```

sem documentação externa.

---

# 85. Riscos

## Complexidade visual

Muitos recursos podem transformar a interface em algo confuso.

Mitigação:

```text
progressive disclosure
```

---

## Excesso de features

O produto pode tentar substituir demasiadas ferramentas.

Mitigação:

Manter o canvas como núcleo.

---

## Geração IaC

Infraestrutura incorreta possui alto impacto.

Mitigação:

Compiler determinístico.

---

## Teste de carga

Teste incorreto pode produzir conclusões incorretas.

Mitigação:

Separar:

```text
Observed

Estimated

Suggested
```

---

# 86. Definição de MVP

O MVP funcional posterior deverá permitir:

```text
Criar arquitetura

↓

Configurar recursos

↓

Salvar

↓

Gerar architecture.json

↓

Gerar documentação

↓

Gerar OpenTofu

↓

Executar tofu plan
```

Load testing real poderá entrar imediatamente após esse estágio.

---

# 87. Definição de Prototype

O protótipo estará concluído quando for possível demonstrar visualmente:

```text
Login

↓

Workspace

↓

Drag ECS

↓

Drag RDS

↓

Connect

↓

Configure

↓

Add Load Generator

↓

Configure workload

↓

Run simulated load test

↓

RDS becomes bottleneck

↓

Open analysis

↓

Preview LOAD-TEST.md

↓

Preview OpenTofu
```

Sem backend real.

---

# 88. Primeiro Goal de Desenvolvimento

```text
GOAL — InfraFlow Prototype

Construir exclusivamente o protótipo frontend
da experiência principal do InfraFlow.

Priorizar fidelidade visual, interação e UX.

Usar dados mockados.

Não implementar backend.

Não implementar banco de dados.

Não implementar autenticação real.

Não executar OpenTofu.

Não executar k6.

Não integrar AWS.

Não integrar LLM.

O objetivo dessa etapa é validar o produto,
não construir sua infraestrutura interna.

O protótipo somente estará concluído quando
todo o fluxo principal puder ser demonstrado
visualmente de ponta a ponta.
```

---

# 89. Ordem Obrigatória de Implementação

```text
Design system

↓

Workspace shell

↓

Canvas

↓

Component library

↓

Nodes

↓

Connections

↓

Properties

↓

Load Generator

↓

Load simulation

↓

Bottleneck visualization

↓

Reports preview

↓

Polish

↓

Review

↓

APPROVAL GATE
```

Somente após:

```text
PROTOTYPE APPROVED
```

começam:

```text
Infrastructure Graph
Persistence
Validation
OpenTofu
k6
Observability
AI
```

---

# 90. Visão Final

InfraFlow deverá transformar:

```text
Ideia
```

em:

```text
Arquitetura
```

depois:

```text
Arquitetura
↓

Validação
↓

Teste
↓

Evolução
```

e finalmente:

```text
Architecture Graph

+

OpenTofu

+

Load Test

+

Documentation

+

Agent Instructions
```

A experiência central continuará sendo:

```text
Arrastar.
Conectar.
Configurar.
Testar.
Evoluir.
Executar.
```
