# Design System — InfraFlow

**Escopo:** Milestone 0 (Prototype). Define a linguagem visual usada no protótipo.

**Referência de sensação** (PRD §68): FigJam, Miro, Linear.
A interface **não pode parecer uma IDE**. Canvas amplo e calmo, painéis densos porém
silenciosos.

---

## 1. A ideia

> A arquitetura é um blueprint até você aplicar carga. Aí ela vira instrumento.

Em repouso o canvas é monocromático: uma prancheta de desenho. Quando o teste roda,
a cor entra **só onde há saturação** — e o gargalo é a única coisa vermelha na tela.

Disso saem três regras:

1. **Cor arbitrária é proibida; cor que carrega informação, não.**
   Estado é cor. Marca de serviço é cor — é o que distingue RDS de Redis num
   relance. Categoria, provider e anotações continuam tinta neutra.
2. **Progressive disclosure** (PRD §85). O node mostra o essencial; o resto vive no
   painel de propriedades.
3. **Uma ousadia só.** O medidor de saturação é o elemento memorável. Tudo ao redor
   fica quieto.

---

## 2. Signature: medidor de saturação

`src/components/canvas/saturation-meter.tsx`

O trilho representa **0 → 125% da capacidade** do recurso e carrega um tique fino
no **teto (100%)**. Uma barra que cruza o tique está literalmente acima da linha.

```text
┌──────────────────────────────────┐
│  AWS                             │
│  RDS PostgreSQL                  │
│  orders-db                       │
│  db.t3.medium · 100GB            │
│  ● Bottleneck             115%   │
├══════════════════════════┿═══────┤  ← barra cruzou o teto
└──────────────────────────────────┘
                           ↑ tique = capacidade
```

Aparece em dois lugares, com a mesma gramática:

* **sangrando na borda inferior de cada node** — leitura do canvas inteiro de relance;
* **uma linha por degrau da escada de carga**, no Analysis Panel (PRD §20).

Faixas de cor: `< 90%` healthy · `90–100%` warning · `≥ 100%` bottleneck.

Isso responde diretamente ao gate do PRD §68 ("o gargalo deve ser identificável sem
consultar gráficos externos") e à métrica do §84 ("entender o gargalo em < 10s").

---

## 3. Tokens

Vivem em `src/app/globals.css`. Os tokens base vêm do shadcn/ui (preset
`radix-nova`) e foram **retonalizados**, não redefinidos.

### 3.1 Neutros

Cinza puro foi trocado por um **slate frio** (hue 248, croma ~0.01): papel de
desenho, não papel de escritório. Vale para `--background`, `--foreground`,
`--muted`, `--border`, `--canvas` e `--panel`.

### 3.2 Marca

| Token | Uso |
|---|---|
| `--brand` | Azul cianótipo. Ação primária, seleção, Load Generator, tráfego ao vivo |
| `--brand-foreground` | Texto sobre `--brand` |
| `--brand-subtle` | Fundo do node Load Generator |

`--primary` e `--ring` apontam para `--brand`.

### 3.3 Estado (PRD §12)

| Estado | Token | Semântica |
|---|---|---|
| `default` | `--state-idle` | Recurso definido, sem carga aplicada |
| `healthy` / `running` | `--state-healthy` | Dentro do SLO — a diferença é o *nível* da barra, não o tom |
| `warning` | `--state-warning` | ≥ 90% da capacidade |
| `error` | `--state-error` | Acima da capacidade |
| `bottleneck` | `--state-bottleneck` | O recurso que trava o sistema — único com anel pulsante |
| `disabled` | `--state-idle` | Borda tracejada, opacidade reduzida |

`selected` não é estado do modelo: é o anel `--brand` do React Flow.

### 3.4 O que foi removido

Havia um acento por categoria — dez hues que não vinham de lugar nenhum. Saiu
porque era decoração e porque `cache` era vermelho, colidindo com `bottleneck`.

**Categoria é comunicada por ícone e seção da library, não por cor.**

Isso não impede o ícone do serviço de ser colorido: a laranja do ECS e o
vermelho do Redis são identidade, não enfeite. O que garante que não competem
com o gargalo é a escala — um glifo de 20px contra borda vermelha, texto
vermelho e uma barra de saturação sangrando na largura inteira do card.

---

## 4. Tipografia

**IBM Plex Sans** (UI) + **IBM Plex Mono** (dados). Superfamília: os dois
compartilham esqueletos, então métricas em mono alinham com rótulos em sans sem
sobressalto — importante numa UI que é metade número.

A base é **13px**, não os 14px do default: densidade de instrumento. Definida
sobrescrevendo `--text-sm` no `@theme`.

| Papel | Tratamento |
|---|---|
| Veredito | Mono 32px/500, `tracking-tight`, tabular |
| Título de node / painel | Sans 13px/500 |
| Corpo | Sans 13px/400 |
| Dado, nome, identificador | **Mono** 11–13px, `tabular-nums` |
| Eyebrow / seção | Sans 10px/500, uppercase, `tracking-eyebrow` (0.09em) |
| Metadado | Sans/Mono 11px, `text-muted-foreground` |

Regra: **todo número e todo identificador em mono.** Nome de recurso, tipo
(`aws.rds`), req/s, porcentagem, custo, path de endpoint.

Idioma: **títulos de seção em pt-BR, rótulos técnicos em inglês** — a mistura do
próprio PRD. `Estimated` / `Observed` / `Suggested` são vocabulário controlado do
§85 e ficam em inglês em todo lugar.

---

## 5. Espaçamento e raio

Grid de 4px. Padding de painel `p-3`. Gap entre grupos `space-y-5`.
Altura de linha de formulário `h-8`; de ação em barra `h-7`.

`--radius` = 0.5rem. Cards e nodes em `rounded-lg`, controles em `rounded-md`.

---

## 6. Layout (PRD §8)

```text
┌─────────────────────────────────────────────┐
│ TOP BAR                              h-12   │
├────────┬──────────────────────┬─────────────┤
│Library │       Canvas         │ Inspector   │
│ w-60   │       flex-1         │   w-80      │
├────────┴──────────────────────┴─────────────┤
│ STATUS BAR                           h-8    │
└─────────────────────────────────────────────┘
```

Separação por `border` de 1px. Nunca sombra entre regiões.

**Top bar:** uma única ação preenchida — `Teste de carga`, o verbo do produto.
Todo o resto é ghost. Provider e environment são pills compactos, não selects
cheios.

**Status bar:** leitura de instrumento. Eyebrow + valor em mono. O alerta de
gargalo é a única coisa colorida e fica alinhado à direita.

---

## 7. Ícones

Duas famílias, com papéis distintos:

**Ícones de serviço** — a marca real de cada recurso, em `public/icons/`.
Gerados por `pnpm icons` a partir de:

* `aws-icons` (MIT), que empacota os Architecture Icons oficiais da AWS;
* `simple-icons` (CC0), pintado com a cor de marca do próprio metadado.

O `@infraflow/registry` é livre de UI e carrega só o identificador — igual ao
`type` com o ponto virando hífen (`aws.rds` → `aws-rds`). O componente
`ServiceIcon` resolve para `/icons/<id>.svg`.

`size-5` no node e no Properties, `size-4` na library e no command palette.

**Ícones de interface** — **Lucide**, única biblioteca para cromo.
`strokeWidth={1.75}`, mais leve que o default 2, combinando com o peso do Plex.
`size-4` no corpo, `size-3.5` em barras densas, `size-3` em linhas de status,
sempre em `text-muted-foreground`. O raio do Load Generator é a exceção
colorida, em `--brand`: ele não é um serviço, é a origem do teste.

A marca do GitHub no login é um SVG inline — marca, não ícone de sistema.

---

## 8. Movimento

| Transição | Duração |
|---|---|
| Hover, seleção, cor | 150ms |
| Preenchimento do medidor | 500ms `ease-out` |
| Passo da simulação | 600ms |
| Pulso do gargalo | 2s, infinito |

`prefers-reduced-motion: reduce` desliga o pulso e o substitui por um anel
estático — o gargalo continua identificável sem movimento.

---

## 9. Estados vazios

Canvas vazio: uma instrução, centralizada, em `text-muted-foreground`.
Sem ilustração, sem tutorial (PRD §69).

Inspector sem seleção: ícone + uma frase.

Test run sem execução: uma frase que diz o que fazer, não o que falta.
