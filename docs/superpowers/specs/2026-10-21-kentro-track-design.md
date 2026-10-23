# Kentro Track — Especificação de projeto

> **Para a IA que vai implementar:** leia o documento inteiro antes de escrever código. As decisões da seção 2 foram propostas ao dono do produto em 21/10/2026; as marcadas **(a confirmar)** ainda dependem dele. Comece pela **Fase 0** (seção 15), que responde as premissas **⚠ VERIFICAR** (seção 16) antes do investimento grande. A base técnica é a do **Kentro Shop** (`../kentro-shop`): reaproveite o que a seção 4.4 lista em vez de reescrever.

---

## 1. Contexto e objetivo

Hoje a integração com o Meta é feita **cliente a cliente no n8n** (ex.: "API DE CONVERSÃO META SIMEÃO/GLPGÁS", "INTEGRAÇÃO UTM E API DE CONVERSÃO META – GRUPO PK", "Ads meta Kentro captura UTM"): os leads das campanhas são capturados e um evento volta para o pixel pela API de Conversões. Funciona, mas:

- **ninguém vê nada**: o gestor continua indo ao Gerenciador de Anúncios e o Gerenciador não sabe o que virou venda no atendimento;
- **o atendente não sabe de onde o lead veio** (qual anúncio, qual oferta, o que respondeu no formulário);
- **cada cliente novo é um fluxo novo** no n8n, com token colado à mão e sem monitoramento.

O **Kentro Track** é um produto **multi-cliente** com duas extensões da Kentro e uma API NestJS:

1. **Kentro Track — Gestão** (gestor/admin): painel de KPIs das campanhas **cruzado com o resultado no atendimento**: investimento, leads, CPL, conversas, atendidos, qualificados, vendas, receita, ROAS e custo por venda por campanha, conjunto, anúncio e criativo. Inclui a configuração (conectar Meta, escolher contas, mapear eventos).
2. **Kentro Track — Atendimento** (atendente): painel lateral do atendimento com a **origem do lead** (anúncio, criativo, texto que o cliente viu, respostas do formulário, histórico de entradas) e botões **Qualificado / Venda / Descartado**, que alimentam o funil e disparam o evento para o Meta.
3. **API Kentro Track**: conexão com o Meta do cliente, sincronização de métricas, recebimento de leads, vínculo lead ↔ atendimento e envio de eventos pela API de Conversões (CAPI). Substitui os fluxos do n8n.

**Critérios de sucesso:**
- Um cliente novo conecta o Meta e vê os últimos 90 dias de campanhas em **menos de 10 minutos**, sem ajuda e sem colar token.
- O atendente vê a origem do lead **no primeiro segundo** do atendimento.
- O gestor responde "qual anúncio vende, e não só gera lead" sem sair da Kentro.
- Nenhum evento duplicado ou perdido no pixel (idempotência + reenvio).
- Adicionar um cliente não exige deploy, fluxo no n8n nem trabalho manual nosso.

---

## 2. Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Multi-cliente (SaaS)**: uma API, vários clientes (tenants). Um tenant = uma **conta** do Kentro Track, criada pela extensão de Gestão | Escala sem deploy por cliente (mesmo modelo do Kentro Shop) |
| D2 | **Duas extensões**, `kentro.track-gestao` e `kentro.track`, cada uma com a sua chave | A Kentro entrega `ctx.config` (secrets decifrados) a todos que recebem a extensão. A chave que configura não pode chegar ao navegador do atendente (lição do Kentro Shop, seção 10.0 de lá) |
| D3 | **Papel pela chave, não pela tela**: `chave_admin` (configura e lê), `chave_gestor` (só lê painéis) e `chave_atendimento` (só o painel do chat). A mesma extensão de Gestão pode ser instalada duas vezes: admins com `chave_admin`, supervisores com `chave_gestor` | Supervisor vê o painel sem poder trocar a conexão do Meta; a regra fica na API e não no navegador |
| D4 | **Um app do Meta da Kentro** (tipo Business) com **Facebook Login for Business** e configuração de **token de usuário do sistema** (não expira) | O cliente só clica em "Conectar" e escolhe os ativos; não cria app, usuário do sistema nem token |
| D5 | **Plano B desde o dia 1: token manual** (usuário do sistema do BM do cliente colado na tela) | O App Review do Meta leva semanas; os clientes atuais do n8n migram já com o token que têm |
| D6 | **Métricas copiadas para o nosso banco** (fato diário por anúncio), ao contrário do proxy ao vivo do Kentro Shop | Painel rápido, cruzamento com o atendimento, histórico e economia da cota da API de Marketing |
| D7 | **Tarefas no próprio Postgres, sem Redis.** Fase 1: a agenda da sincronização fica na própria `contas_anuncio` (colunas `proxima_*`, trava `em_execucao_ate` com `FOR UPDATE SKIP LOCKED`), rodando a cada 30 s no processo. Fase 3: a fila da CAPI usa a mesma técnica numa tabela própria (`envios_capi`), com reenvio com espera; o `pg-boss` não foi necessário | Nada de infraestrutura nova no Doca; a agenda simples cobre a sincronização sem uma peça a mais |
| D8 | **Captura do atendimento em camadas**: (1) o painel do atendente lê a mensagem de anúncio do chat aberto, sem configuração; (2) uma automação da Kentro avisa a API quando o chat começa e quando a oportunidade avança (modelos prontos para copiar); (3) depois, configuração em um clique pelo MCP da instância | Funciona no primeiro dia sem automação e melhora com ela |
| D9 | **Extensões em Preact + Vite**, compiladas (`scripts/build-extensoes.mjs`, Vite em modo IIFE) num **fragmento HTML por contribuição**: `<style>` + `<div id="app">` + `<script>` clássico, sem `<html>`/`<body>` nem módulo, servido pela API | O painel de gestão tem gráficos e tabelas: em HTML puro vira um arquivo de 100 KB difícil de manter (como o `config.html` do Kentro Shop). O fragmento é o mesmo formato que o painel do Kentro Shop já roda no iframe da Kentro (o `omni` chega como global antes do script) e não tem arquivo a mais para buscar com CORS |
| D10 | **Gráficos sem CDN**: SVG próprio ou **uPlot** empacotado no HTML | O iframe é sandbox; não depender de recurso de terceiros |
| D11 | Stack: **NestJS + Postgres (Prisma)**, pacote npm único, deploy no **Doca** com HTTPS em `tracks.apps.kentro.com.br` | Igual ao Kentro Shop; o Doca já roda esse formato |
| D12 | **(a confirmar)** Ordem: **Relatório (Gestão) → Leads e Atendimento → CAPI → automações e escala** | O relatório já se paga sozinho e não depende do App Review para `leads_retrieval` |

---

## 3. Glossário

- **Conta / tenant**: um cliente do Kentro Track (uma instalação da Gestão numa instância da Kentro).
- **Conexão Meta**: o token (cifrado) que dá acesso aos ativos do cliente no Meta, com a lista do que ele autorizou.
- **Ativos**: contas de anúncio (`act_…`), páginas (formulários de lead), datasets/pixels (CAPI) e contas do WhatsApp Business.
- **Lead**: uma pessoa que entrou por uma origem rastreável: **formulário** (Lead Ads), **clique para WhatsApp** (CTWA), **link rastreável** ou **orgânico**.
- **Funil Kentro**: `recebido → em_atendimento → qualificado → venda | descartado`, por lead.
- **Evento CAPI**: o que mandamos de volta para o pixel (ex.: `Lead`, `QualifiedLead`, `Purchase`), com `event_id` para evitar duplicidade.

---

## 4. Arquitetura

```
                ┌──────────────────────────── Meta ─────────────────────────────┐
                │ Facebook Login for Business · API de Marketing (insights)     │
                │ Webhook "leadgen" das páginas · API de Conversões (dataset)   │
                └───────▲───────────────────▲──────────────────────▲────────────┘
          OAuth (aba nova)        métricas e leads             eventos CAPI
                │                         │                        │
Kentro · Gestão (topMenu) ──┐             │                        │
Kentro · Atendimento (chatPanel) ─ omni.http.request ─┐            │
Kentro · automação (request) ── webhook de eventos ───┤            │
                                                      ▼            │
                              API Kentro Track (NestJS, Postgres) ─┘
                              ├─ contas, chaves, conexão Meta cifrada
                              ├─ sincronização (pg-boss): entidades + insights diários
                              ├─ leads, vínculo lead ↔ atendimento, funil
                              ├─ CAPI: fila, idempotência, reenvio
                              └─ páginas públicas: conectar Meta, privacidade, exclusão de dados
```

### 4.1 Repositório (pacote npm único)

Mesmas regras do Kentro Shop (lá, seção 4.1): **um `package.json` na raiz, sem workspaces**; `prisma generate` dentro do `npm run build`; tudo o que roda em produção em `dependencies`; build único em `dist/`.

```
kentro-track/
  package.json
  scripts/copiar-build.mjs
  api/
    src/
      comum/          config, cripto, erros, prisma, migrações, logs   (copiado do Kentro Shop)
      contas/         registro, chaves, guard por papel, superadmin
      meta/
        cliente/      cliente HTTP do Graph (versão, ritmo, erros, appsecret_proof)
        conexao/      OAuth FBL4B, token manual, ativos, reconexão
        webhook/      verificação, assinatura, leadgen, exclusão de dados
        sincronizacao/ entidades (campanha/conjunto/anúncio/criativo) e insights
        capi/         montagem do evento, hash, envio, reenvio
      leads/          leads, origem, vínculo com atendimento, funil
      kentro/         webhook de eventos da automação, links rastreáveis
      painel/         rotas agregadas do painel de gestão
      atendimento/    rotas do painel do atendente
      tarefas/        pg-boss: agendas e workers
      paginas/        conectar, privacidade, termos (HTML servido pela API)
      arquivos-extensao/  serve as extensões com CORS (copiado do Kentro Shop)
    prisma/schema.prisma
    test/
  extension/
    gestao/       manifest.json + src (Preact) → gestao.html
    atendimento/  manifest.json + src (Preact) → painel.html
  docs/
```

### 4.2 Deploy no Doca

| Campo | Valor |
|---|---|
| Tipo | API ou microsserviço (NestJS) |
| Pasta do projeto | `.` (o build precisa de `extension/`) |
| Como construir | NestJS (`npm run build` → `dist/main.js`) |
| Subdomínio | `https://tracks.kentro.com.br` (domínio trocado em 23/10/2026; antes era `tracks.apps.kentro.com.br`; porta interna 10004; o nome curto vai aparecer na tela de consentimento do Meta) |
| Porta / verificação | 3000 / `/` |
| Memória / CPU | 512 MB / 0,5 para começar (a sincronização roda no mesmo processo, com concorrência limitada) |
| Variáveis | `DATABASE_URL`, `CHAVE_MESTRA_CRIPTO` (base64 de 32 bytes, **nunca trocar**), `TOKEN_SUPERADMIN`, `URL_PUBLICA`, `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` (configuração do Login for Business), `META_WEBHOOK_VERIFY_TOKEN`, `META_API_VERSION` (ex.: `v24.0`, ⚠ confirmar a vigente) |
| Banco | o Postgres criado no Doca para o Kentro Track, ligado ao projeto (`DATABASE_URL`). As migrações do Prisma são donas do esquema |

URLs para instalar: `https://tracks.kentro.com.br/extensao/gestao/manifest.json` e `…/extensao/atendimento/manifest.json`.

**Escala (Fase 4):** a mesma imagem sobe com `PAPEL=api` ou `PAPEL=worker` (segundo projeto no Doca, mesmo repositório) quando a sincronização passar a disputar CPU com as requisições.

### 4.3 Extensões servidas pela API

Igual ao Kentro Shop (lá, seção 4.3): `GET /extensao/<gestao|atendimento>/<arquivo>` com `Access-Control-Allow-Origin: *` em **todas** as respostas, `OPTIONS` 204, `__URL_PUBLICA__` trocado no manifest, nomes de arquivo restritos, `Cache-Control: no-cache`, sem redirecionamento. Depois de cada deploy: subir `version` e rodar "Reconsultar manifest" (`extension_installs_refresh_manifest`).

### 4.4 O que reaproveitar do Kentro Shop

| Do Kentro Shop | No Kentro Track |
|---|---|
| `api/src/comum/*` (config com validação no boot, AES-256-GCM, `ErroApi`, Prisma, migrações no boot, conferência de UTF8) | copiar como está |
| `lojas/` (registro, `gerarSegredo`/`hashSegredo`, `ChaveLojaGuard` com `@Papel`, limite de registro por IP + instância) | vira `contas/`, com os três papéis da D3 |
| `arquivos-extensao/extensao.controller.ts` | copiar, trocando a lista de extensões |
| `integracoes/oauth.controller.ts` + `estado-oauth.ts` + o fluxo "copiar link e aguardar" do `config.html` | base da conexão Meta (seção 7.2) |
| `conectores/nucleo/cliente-http.ts` e `ritmo.ts` (tempo limite, reenvio com espera, token bucket) | base do cliente do Graph |
| `test/` (Postgres embutido, `omni-falso.ts`, app de teste) | copiar a infraestrutura de teste |
| `scripts/copiar-build.mjs`, `package.json` | adaptar |

---

## 5. O que se sabe da plataforma Kentro (verificado em 21/10/2026)

Além de tudo da seção 5 da spec do Kentro Shop:

- **Contribuições úteis**: `chatPanel` (painel do atendente); `topMenu` em `fullscreen` (Gestão); `topMenuSubItem` com `parentMenu: "dashboards"` para o painel aparecer dentro do menu **Dashboards** da Kentro. Tamanhos de diálogo `sm…full`.
- **Dados do anúncio no atendimento**:
  - no SDK, cada mensagem de `omni.chats.getMessages(chatId)` tem a chave **`ad`** (estrutura não documentada: ⚠ V1);
  - nas automações, a última mensagem recebida expõe **`message_ad_url`, `message_ad_title`, `message_ad_body`**;
  - **não** aparecem `ctwa_clid` nem o ID do anúncio (`source_id`). Sem eles, o vínculo com o anúncio é por URL/título/texto (seção 8.3) e o evento CAPI não pode usar o modo "mensageria comercial" (seção 9.2).
- **Variáveis do atendimento** para a automação mandar à API: `chat_id`, `chat_client_number`, `chat_client_name`, `chat_contact_id`, `chat_queue_id`, `chat_page_id`, `chat_agent_id`, `message_text` (para o código do link rastreável) e, na oportunidade, valor e etapa.
- **`omni.http.request`: 30 chamadas/min por instalação e usuário.** O painel de gestão precisa de **rotas agregadas** (uma chamada por tela/filtro, seção 10.1), e o painel do atendente, de uma chamada por chat aberto.
- **OAuth**: abrir o login do Meta a partir do iframe **não funciona** (a aba herda o sandbox, sem cookies). Mesmo padrão do Kentro Shop: a extensão copia o link, o usuário cola numa aba nova e a extensão espera a conclusão consultando a API.
- **Canal** (`omni.channel` + `POST /api/extensions/{installId}/channel`) para avisar o painel em tempo real (lead novo, evento enviado). Exige o token do canal, gerado pelo admin da instância (Fase 4).

---

## 6. Modelo de dados (Prisma)

Toda tabela de dados de cliente tem `conta_id`, e **toda consulta filtra por ele** (repositório que injeta o filtro + teste que tenta ler outra conta). Chaves estrangeiras em cascata a partir da conta.

| Tabela | Colunas principais |
|---|---|
| `contas` | id (uuid), nome, instancia_kentro (domínio), chave_admin_hash, chave_gestor_hash, chave_atendimento_hash, token_webhook_hash, status (`pendente_conexao`, `ativa`, `reconectar`, `bloqueada`), plano, limites (json), fuso, moeda, criado_em |
| `conexoes_meta` | conta_id (único), tipo (`login_empresa`, `token_manual`), token_cifrado, iv, business_id, usuario_meta (nome), escopos (text[]), status, verificado_em, ultimo_erro |
| `ativos_meta` | conta_id, tipo (`conta_anuncio`, `pagina`, `dataset`, `waba`), id_meta, nome, moeda, fuso, selecionado, inscrito_leadgen (páginas), atualizado_em |
| `campanhas` / `conjuntos` / `anuncios` | conta_id, id_meta, pai, nome, status, objetivo, orçamento; anúncio: criativo_id, miniatura_url, titulo, texto, link, permalink, object_story_id, atualizado_em |
| `insights_diarios` | conta_id, conta_anuncio_id, anuncio_id, conjunto_id, campanha_id, data, investimento, impressoes, alcance, frequencia, cliques, cliques_link, leads_meta, conversas_iniciadas, acoes (json), valores_acoes (json); único (conta_anuncio_id, anuncio_id, data); índice (conta_id, data) |
| `leads` | id, conta_id, origem (`formulario`, `ctwa`, `link`, `organico`), telefone_e164, telefone_chave (DDD + 8 últimos dígitos), nome, email, respostas (json), leadgen_id, formulario_id, anuncio_id, conjunto_id, campanha_id, plataforma (fb/ig), anuncio_url/titulo/texto (CTWA), ctwa_clid, fbc, fbp, utm (json), chat_id, contato_id, atendente_id, etapa, valor_venda, motivo_descarte, recebido_em, primeira_resposta_em, qualificado_em, venda_em |
| `eventos_lead` | lead_id, tipo, texto, autor (`meta`, `kentro`, `atendente`, `sistema`), dados (json), em |
| `envios_capi` | conta_id, lead_id, dataset_id, event_name, event_id (único por dataset), status (`pendente`, `enviado`, `erro`, `descartado`), tentativas, resposta (json), fbtrace_id, enviado_em |
| `mapeamento_eventos` | conta_id, gatilho (`lead_recebido`, `qualificado`, `venda`, `etapa_crm:<id>`), event_name, ativo, dataset_id |
| `links_rastreaveis` | conta_id, codigo (único), nome, numero_whatsapp, mensagem, utm_padrao (json), cliques |
| `cliques_link` | link_id, codigo_sessao, fbclid, fbc, fbp, utm (json), ip_hash, user_agent, em (o código vai na mensagem pré-preenchida do WhatsApp) |
| `chamadas_meta` | conta_id, operacao, status_http, ms, erro_codigo, uso (json do cabeçalho de uso), em (apagadas após 7 dias) |
| `uso_mensal` | conta_id, mes, leads, eventos_capi, chamadas_meta |

Volume esperado: 100 contas × 3 contas de anúncio × 200 anúncios × 365 dias ≈ 22 milhões de linhas/ano em `insights_diarios`. Cabe num Postgres comum com o índice certo. Se crescer: particionar por mês ou consolidar por conjunto depois de 13 meses.

---

## 7. Conexão com o Meta do cliente

### 7.1 App do Meta (uma vez, pela Kentro)

1. App do tipo **Business** no Meta for Developers, dono = BM da Kentro, com **verificação da empresa** concluída.
2. Produtos: **Facebook Login for Business**, **Webhooks** (objeto `page`, campo `leadgen`), **API de Marketing**.
3. Configuração do Login for Business: tipo **token de acesso de usuário do sistema**, ativos pedidos: contas de anúncio, páginas e datasets (pixels). Permissões (⚠ V3 confirmar a lista mínima): `ads_read`, `ads_management` (CAPI), `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata` (inscrever o webhook), `pages_manage_ads` e `leads_retrieval` (ler o lead).
4. **App Review** com acesso avançado a essas permissões (vídeo do fluxo, política de privacidade e exclusão de dados): `URL_PUBLICA/privacidade`, `/termos` e o callback `/v1/meta/exclusao-dados` (`signed_request`).
5. **Até o App Review sair:** o fluxo funciona com clientes cadastrados como testadores do app, e o token manual (D5) atende os demais.

### 7.2 Fluxo do cliente ("Conectar Meta")

```
Gestão (admin) ─ "Conectar com o Facebook" ─▶ API cria estado (10 min) ─▶ link copiado
   │                                                          │
   │  cliente cola numa aba nova: /conectar/meta?estado=…  ◀──┘
   │     página nossa → diálogo do Meta (config_id) → escolhe empresa e ativos → autoriza
   │     /v1/meta/oauth/retorno troca o código pelo token (não expira) e lista os ativos
   │     página mostra "Pronto! Volte para a Kentro"
   └─ a extensão consulta a API a cada 4 s ─▶ mostra os ativos ─▶ admin marca contas, páginas e pixel
        ─▶ API inscreve as páginas no leadgen e agenda a carga dos últimos 90 dias
```

- **Token manual (D5):** campo "Token de usuário do sistema" + "Testar". A API chama `/me`, `/me/adaccounts` e `/me/businesses` para descobrir os ativos.
- **Reconexão:** erro 190 (token inválido, app removido) ou 200 (permissão retirada) → `conexoes_meta.status = reconectar`, `contas.status = reconectar`, faixa vermelha no painel e envios CAPI pausados (ficam pendentes, não se perdem). Lição do medular-sync: o token pode cair a qualquer momento, e o sistema precisa mostrar isso em vez de falhar em silêncio.
- Todas as chamadas levam `appsecret_proof` (HMAC do token com `META_APP_SECRET`).

### 7.3 Cliente HTTP do Graph (`meta/cliente`)

- Versão fixa por `META_API_VERSION`; tempo limite de 15 s; reenvio com espera em 5xx e nos erros de limite (4, 17, 32, 613, 80000–80014), respeitando o cabeçalho `X-Business-Use-Case-Usage` / `X-Ad-Account-Usage`: acima de 75% de uso, a sincronização daquela conta de anúncio espera.
- Paginação por cursor (`paging.next`) com teto de páginas por execução.
- Erros padronizados: `TokenInvalido`, `PermissaoFaltando(escopo)`, `LimiteMeta(esperarAte)`, `RecusadoPeloMeta(mensagem, fbtrace_id)`.
- Registro em `chamadas_meta` (sem token, sem dado pessoal), exibido na aba Saúde.

---

## 8. Dados: métricas, leads e vínculo com o atendimento

### 8.1 Sincronização de métricas (pg-boss)

| Tarefa | Quando | O quê |
|---|---|---|
| `entidades` | a cada 6 h e ao conectar | campanhas, conjuntos, anúncios e criativos (nome, status, objetivo, orçamento, miniatura, título, texto, link) |
| `insights-hoje` | a cada 1 h | `level=ad`, `time_increment=1`, hoje e ontem |
| `insights-recalculo` | todo dia às 4 h (fuso da conta) | últimos 7 dias (o Meta recalcula a atribuição) |
| `insights-carga` | ao conectar e ao marcar conta nova | últimos 90 dias, em **relatório assíncrono** (`POST /act_x/insights` + consulta do job) |

Campos: `spend, impressions, reach, frequency, clicks, inline_link_clicks, actions, action_values, cost_per_action_type`. Gravação por *upsert* em `(conta_anuncio_id, anuncio_id, data)`.

**O que conta como lead** é configurável por conta de anúncio, porque cada cliente anuncia de um jeito: formulário (`lead`/`onsite_conversion.lead_grouped`), conversa iniciada (`onsite_conversion.messaging_conversation_started_7d`) ou lead do pixel (`offsite_conversion.fb_pixel_lead`). O padrão é a soma de formulário e conversa. O CPL usa essa definição.

Concorrência: no máximo 2 tarefas de sincronização por conta e 4 no total, por processo (ajustável).

### 8.2 Leads de formulário (Lead Ads)

1. Meta → `POST /v1/meta/webhook` (assinatura `X-Hub-Signature-256` conferida com o app secret; `GET` responde o `hub.challenge`).
2. Resposta 200 imediata; o evento entra na fila `lead-formulario`.
3. Worker: encontra a conta pela `page_id`, busca `/{leadgen_id}?fields=created_time,field_data,ad_id,adset_id,campaign_id,form_id,platform,is_organic`, normaliza o telefone, grava o lead e o evento `recebido`.
4. **Reconciliação** diária por formulário (`/{form_id}/leads` desde o último lead), porque webhook se perde.
5. **(Fase 4) Lead de formulário direto no atendimento:** se a conta configurou uma captura de webhook da Kentro, a API envia o lead para ela, e a automação cria o contato e manda o template de WhatsApp em segundos (velocidade de resposta é o que mais converte em lead de formulário).

### 8.3 Leads do clique para WhatsApp (CTWA) e vínculo com o atendimento

Origem do vínculo, por ordem de confiança:

| # | Fonte | Como chega | Vincula com |
|---|---|---|---|
| 1 | Mensagem de anúncio no chat | **automação** na entrada da fila (`request` para o webhook de eventos com `message_ad_*`, `chat_id`, telefone) **ou o painel do atendente** (lê `msg.ad` da primeira mensagem do chat aberto) | `anuncio_id` se o `ad` trouxer (⚠ V1); senão, por `message_ad_url` (= permalink/`object_story_id` do criativo) e, por último, por título + texto contra os criativos sincronizados |
| 2 | Código do link rastreável | `message_text` com `[#A1B2]` | o clique gravado (fbclid → `fbc`, UTM) |
| 3 | Lead de formulário com o mesmo telefone | `telefone_chave` nos últimos 30 dias | o lead existente (vira o mesmo lead, com o chat preenchido) |
| 4 | Nada | — | lead `organico` (aparece no painel, fora do CPL) |

**Telefone no Brasil:** o WhatsApp entrega números com e sem o nono dígito. A chave de comparação é **DDD + 8 últimos dígitos** (`telefone_chave`), e o E.164 completo fica guardado para a CAPI.

**Webhook de eventos da Kentro:** `POST /v1/kentro/eventos/:tokenWebhook` (token na URL porque o elemento `request` da automação é configurado por copiar e colar; guardado como hash, rotacionável). Corpo:

```json
{ "evento": "chat_iniciado", "chatId": "{{chat_id}}", "telefone": "{{chat_client_number}}",
  "nome": "{{chat_client_name}}", "contatoId": "{{chat_contact_id}}", "filaId": "{{chat_queue_id}}",
  "anuncio": { "url": "{{message_ad_url}}", "titulo": "{{message_ad_title}}", "texto": "{{message_ad_body}}" },
  "mensagem": "{{message_text}}" }
```

Outros eventos: `qualificado`, `venda` (`valor`), `descartado` (`motivo`) e `etapa_crm` (`etapaId`, `valor`), disparados por automações de oportunidade ou pelos botões do painel do atendente. A tela de Configurações gera o texto pronto (URL + corpo) e o modelo da automação em DSL da Kentro para colar.

### 8.4 Links rastreáveis (para tráfego que passa pelo site)

`GET /r/:codigo?utm_…&fbclid=…` grava o clique (gera `fbc` a partir do `fbclid`) e redireciona para `https://wa.me/<número>?text=<mensagem> [#código-curto]`. Substitui a "captura UTM" do n8n e dá à CAPI o `fbc`, que melhora a correspondência.

---

## 9. Eventos de volta para o Meta (API de Conversões)

### 9.1 Quando

`mapeamento_eventos` liga cada gatilho do funil a um evento do Meta, por conta. Padrão:

| Gatilho | Evento do Meta |
|---|---|
| `lead_recebido` (só origem CTWA/link; o formulário o Meta já conta) | `Lead` |
| `qualificado` | `QualifiedLead` (formulário: nome da etapa do CRM, ver 9.2) |
| `venda` | `Purchase` com `value` e `currency` |
| `etapa_crm:<id>` | escolhido pelo admin |

### 9.2 Como (por origem)

| Origem | `action_source` | `user_data` | Observação |
|---|---|---|---|
| Formulário | `system_generated` | `lead_id` + `ph`/`em` com hash | `custom_data.event_source = "crm"`, `lead_event_source = "Kentro Track"` (integração de leads de conversão do CRM) |
| CTWA **com** `ctwa_clid` | `business_messaging`, `messaging_channel = "whatsapp"` | `ctwa_clid`, `whatsapp_business_account_id` | Só se a Kentro expuser o `ctwa_clid` (⚠ V1) |
| CTWA **sem** `ctwa_clid` | `chat` | `ph` com hash (+ `fn`, `ct`, `country`) | Correspondência pelo telefone. É o que dá para fazer com o que a Kentro expõe hoje |
| Link rastreável | `chat` (ou `website`) | `fbc`, `fbp`, `ph` com hash, `client_user_agent` | |

- **Hash**: SHA-256 de valores normalizados (telefone só com dígitos e DDI 55, e-mail minúsculo, nomes sem acento).
- **Idempotência:** `event_id = kt-<leadId>-<gatilho>`; `envios_capi` tem chave única por dataset. Reenvio com espera (1 min, 5 min, 30 min, 2 h, 12 h); depois disso fica `erro`, com o motivo, na aba Saúde.
- **Testar envio:** campo `test_event_code` na configuração; os envios de teste aparecem no Gerenciador de Eventos sem contar.
- **Migração do n8n:** para um cliente que já manda eventos pelo n8n, **desligar o fluxo do n8n no mesmo dia** em que ligar a CAPI do Kentro Track (os `event_id` diferem e o Meta contaria em dobro).

---

## 10. Extensões

### 10.0 Manifests (rascunho, conferido com `extensions_manifest_spec` em 21/10/2026)

```json
{
  "manifestVersion": 1,
  "id": "kentro.track-gestao",
  "version": "0.1.0",
  "name": "Kentro Track — Gestão",
  "description": "Resultados das campanhas do Meta cruzados com o atendimento: investimento, leads, CPL, vendas e ROAS por campanha e anúncio.",
  "author": { "name": "Kentro" },
  "requires": [],
  "config": [
    { "key": "api_url", "type": "url", "label": "Endereço da API do Kentro Track", "required": true, "default": "__URL_PUBLICA__" },
    { "key": "chave", "type": "secret", "label": "Chave do Kentro Track", "required": false,
      "help": "Deixe vazio na primeira instalação: a tela cria a conta e mostra a chave para colar aqui." }
  ],
  "contributions": [
    { "id": "painel", "type": "topMenu", "title": "Kentro Track", "url": "gestao.html",
      "presentation": { "mode": "fullscreen" }, "visibility": { "userTypes": [0, 1] } }
  ]
}
```

```json
{
  "manifestVersion": 1,
  "id": "kentro.track",
  "version": "0.1.0",
  "name": "Kentro Track — Atendimento",
  "description": "De onde veio este lead: anúncio, criativo e respostas do formulário, com botões de qualificação e venda.",
  "author": { "name": "Kentro" },
  "requires": [],
  "config": [
    { "key": "api_url", "type": "url", "label": "Endereço da API do Kentro Track", "required": true, "default": "__URL_PUBLICA__" },
    { "key": "chave_atendimento", "type": "secret", "label": "Chave de atendimento", "required": true,
      "help": "Gerada no Kentro Track — Gestão, ao criar a conta." }
  ],
  "contributions": [
    { "id": "origem", "type": "chatPanel", "title": "Origem do lead", "url": "painel.html" }
  ]
}
```

A Gestão usa uma só chave de configuração (`chave`); o papel (admin ou gestor) vem da chave colada (D3). Avaliar na Fase 0 trocar o `topMenu` por um `topMenuSubItem` com `parentMenu: "dashboards"`.

### 10.1 Kentro Track — Gestão

Telas (abas), todas com o mesmo filtro no topo (período com comparação ao período anterior, conta de anúncio, campanha, origem):

1. **Visão geral:** cartões com Investimento, Leads, CPL, Conversas, Atendidos, Qualificados, Vendas, Receita, **ROAS** e **Custo por venda**, cada um com a variação em relação ao período anterior; gráfico diário de investimento × leads × vendas; **funil** Impressões → Cliques → Leads → Atendidos → Qualificados → Vendas.
2. **Campanhas:** tabela campanha → conjunto → anúncio (abre por nível) com métricas do Meta **e** do atendimento lado a lado; ordenação por qualquer coluna; destaques automáticos (CPL 30% acima da média da conta, frequência > 3, investimento sem lead em 3 dias).
3. **Criativos:** grade com miniatura, título, CTR, CPL, taxa de qualificação e custo por venda. Responde "qual criativo vende".
4. **Leads:** lista com origem, anúncio, etapa, atendente e tempo até a primeira resposta; abre o atendimento (`omni.chats.select`); exportar CSV.
5. **Equipe:** leads por atendente, tempo médio da primeira resposta, taxa de qualificação e de venda, leads sem resposta há mais de X minutos.
6. **Configurações** (só com `chave_admin`): Conexão Meta (estado, reconectar, ativos marcados), O que conta como lead, Eventos para o Meta (mapeamento, dataset, testar), Kentro (URL do webhook de eventos, modelos de automação para copiar, link rastreável), Chaves (criar, rotacionar e o passo a passo de onde colar cada uma), Saúde (últimas sincronizações, chamadas ao Meta com erro, envios CAPI com erro, uso do mês).

**Regra das 30 chamadas por minuto:** cada aba carrega com **uma** rota agregada (`GET /v1/painel/visao-geral?…`, `/campanhas`, `/criativos`, `/leads`, `/equipe`), e a resposta fica em memória por filtro. Miniaturas de criativo saem pelo nosso domínio (`/v1/midia/:id`, com cache), porque as URLs do Meta expiram e o iframe é HTTPS.

**Primeiro uso** (mesmo padrão do Kentro Shop, seção 10.2 de lá): sem chave → "Criar minha conta no Kentro Track" → a API devolve `chaveAdmin`, `chaveGestor` e `chaveAtendimento` uma vez → passo a passo: colar a de admin nesta instalação, instalar o Atendimento com a de atendimento, opcionalmente instalar a Gestão de novo para supervisores com a de gestor → assistente "Conectar Meta" (seção 7.2) → "Seus dados dos últimos 90 dias estão chegando" (barra de progresso da carga).

### 10.2 Kentro Track — Atendimento (chatPanel)

Ao abrir um atendimento (`omni.chats.getSelected` e o evento `omniChatSelected`):

1. Lê as primeiras mensagens do chat (`omni.chats.getMessages`) e, se houver `ad`, envia à API junto com `chatId` e telefone (`POST /v1/atendimento/vincular`). A API devolve o lead já vinculado (ou cria um). **Uma chamada por chat aberto.**
2. Mostra:
   - **selo de origem** (Anúncio no Instagram, Anúncio no Facebook, Formulário, Link, Orgânico) e há quanto tempo o lead chegou;
   - **campanha › conjunto › anúncio**, com a **miniatura e o texto do anúncio que o cliente viu** (o atendente já começa sabendo qual oferta o cliente viu);
   - **respostas do formulário** (Lead Ads), quando houver;
   - **outras entradas** do mesmo telefone (voltou por outro anúncio? já comprou?).
3. Botões **Qualificado**, **Venda** (pede o valor) e **Descartado** (pede o motivo, numa lista configurável). Cada um grava a etapa, alimenta o painel do gestor e agenda o evento CAPI; o painel mostra "Enviado ao Meta ✓" quando o envio conclui.
4. Estados claros: sem chave ("Peça ao administrador para configurar o Kentro Track"), conta para reconectar ("Os dados do Meta estão desatualizados"), sem origem ("Lead orgânico, sem anúncio identificado").

Sem consulta periódica: recarrega ao trocar de chat e depois de cada ação. Tempo real pelo canal fica para a Fase 4.

---

## 11. API (prefixo `/v1`, erro padrão do Kentro Shop)

### 11.1 Autenticação

| Quem | Como |
|---|---|
| Gestão (admin / gestor) | `X-Track-Chave` com `chave_admin` ou `chave_gestor`; `@Papel('admin')` nas rotas de configuração |
| Atendimento | `X-Track-Chave` com `chave_atendimento` |
| Auditoria | `X-Kentro-Usuario-Id` / `-Nome` (só para registro, não autoriza) |
| Automação da Kentro | token na URL do webhook de eventos |
| Meta | assinatura `X-Hub-Signature-256` (webhook) e `signed_request` (exclusão de dados) |
| Superadmin | `Authorization: Bearer <TOKEN_SUPERADMIN>` |

No banco ficam **só hashes** das chaves e do token do webhook; o token do Meta fica **cifrado** (AES-256-GCM).

### 11.2 Rotas

- **Conta:** `POST /contas/registrar` (limite por IP + instância) · `GET /conta` · `POST /conta/chaves/:tipo/rotacionar` · `PATCH /conta/configuracoes`.
- **Meta:** `POST /meta/conectar/iniciar` → `{ url }` · `GET /conectar/meta` (página) · `GET /meta/oauth/retorno` · `PUT /meta/token-manual` · `GET /meta/conexao` · `GET /meta/ativos` · `PUT /meta/ativos` (marcar) · `GET|POST /meta/webhook` · `POST /meta/exclusao-dados`.
- **Painel:** `GET /painel/visao-geral|campanhas|criativos|leads|equipe?de&ate&contaAnuncio&campanha&origem` · `GET /painel/leads.csv` · `GET /midia/:id`.
- **Atendimento:** `POST /atendimento/vincular` `{ chatId, telefone, nome, ad? }` · `GET /atendimento/chat/:chatId` · `POST /atendimento/leads/:id/etapa` `{ etapa, valor?, motivo? }`.
- **Kentro:** `POST /kentro/eventos/:token` · `GET /r/:codigo` · `GET|POST|DELETE /links`.
- **Eventos (admin):** `GET|PUT /eventos/mapeamento` · `POST /eventos/testar` · `GET /eventos/envios?status=erro` · `POST /eventos/envios/:id/reenviar`.
- **Saúde:** `GET /conta/saude` · `GET /` → `{ ok: true }`.
- **Superadmin:** `GET /admin/contas` · `PATCH /admin/contas/:id`.

---

## 12. Segurança e LGPD

- HTTPS com domínio (já disponível no Doca por subdomínio).
- Token do Meta cifrado, nunca logado nem devolvido; `appsecret_proof` em toda chamada.
- Webhook do Meta só com assinatura válida; webhook da Kentro só com token válido e limite de requisições.
- Dados pessoais mínimos (nome, telefone, e-mail, respostas do formulário). Para a CAPI só sai **hash**.
- Retenção: leads apagados 24 meses depois do último evento (configurável por conta); `chamadas_meta` com 7 dias; exclusão por pedido do titular (rota de exclusão de dados do Meta e rota do superadmin).
- Política de privacidade e termos publicados (exigência do App Review).
- Isolamento por `conta_id` com teste automatizado.
- Nunca colar credencial em código, documento ou print (o print da tela de bancos do Doca mostra a senha do `kentro_shop`; se ele circulou, trocar a senha).

---

## 13. Operação

- Contêiner sem estado; migrações no boot; `pg-boss` usa o mesmo Postgres (esquema `pgboss`).
- Logs JSON com `contaId` e `requestId`, sem dado pessoal.
- Agendas por conta respeitam o fuso da conta de anúncio.
- Alertas (Fase 4): conexão caída, CAPI com erro por mais de 1 h, investimento sem lead, por toast no painel e pelo canal da extensão.

---

## 14. Testes

- **Cliente do Graph** com respostas gravadas (fixtures reais anonimizadas): paginação, limite (cabeçalhos de uso), erro 190 → reconectar, relatório assíncrono.
- **Sincronização:** *upsert* idempotente, recálculo dos 7 dias, definição de lead por conta.
- **Webhook leadgen:** assinatura inválida → 401; lead duplicado → um só.
- **Vínculo:** as quatro fontes da seção 8.3, telefone com e sem nono dígito.
- **CAPI:** montagem por origem (seção 9.2), hash, `event_id` único, reenvio, pausa ao reconectar.
- **Isolamento:** cada rota tenta ler dados de outra conta.
- **Extensões:** `omni` simulado (copiar `omni-falso.ts` do Kentro Shop) para a Gestão e o Atendimento; conferir o limite de chamadas por tela.

---

## 15. Fases e critérios de aceite

**Fase 0 — Fundação e premissas (1 semana)**
- Repositório, base copiada do Kentro Shop (4.4), registro de conta com os três papéis, as duas extensões em esqueleto instaladas pela URL do Doca, deploy com HTTPS.
- Responder as premissas ⚠ da seção 16 (principalmente V1 e V3).
- **Começar no dia 1** a verificação da empresa e a criação do app do Meta, porque o App Review é o caminho crítico do projeto.
- **Aceite:** as duas extensões instalam em `kentro.atenderbem.com`; a seção 16.1 respondida.

**Situação em 21/10/2026 (Fase 0, código):**
- Feito e testado (107 testes; build; teste de fumaça do `dist/main.js` com Postgres): tabela `contas`; registro com limite por IP + instância; três chaves (`kta_` admin, `ktg_` gestor, `ktk_` atendimento) guardadas só como hash, papel pela chave (`@Papeis`), rotação por tipo; superadmin; extensões servidas com CORS; config com o app do Meta opcional (`META_*`, as quatro juntas) e `META_API_VERSION`.
- Gestão: primeiro uso (cria a conta, mostra as três chaves uma vez com o passo a passo, guarda no `omni.storage` até a chave de admin ser colada), abas (só Configurações tem conteúdo: Chaves), gestor sem Configurações, chave de atendimento recusada.
- Atendimento: lê o `ad` da conversa (recuando até 4 páginas de 50), mostra o anúncio e tem um "Diagnóstico do anúncio" (só o anúncio e metadados) para copiar. Funciona mesmo sem a chave.
- V1 em andamento: extensão de teste `kentro.zz-track-diagnostico` (editor id 28, só canal dev): `https://cdn.a-tend.online/kentro.zz-track-diagnostico/manifest_dev.json`. Lista o `ad` e os **nomes** dos campos do chat e das mensagens (para achar campos de anúncio fora do `ad`). Excluir ao fim da Fase 0.
- Pendente: repositório próprio do kentro-track e deploy no Doca; verificação da empresa e app do Meta; V2–V8.
- Desenvolvimento local: `npm run db:local` sobe o Postgres na porta **54339** (a 54329 é a do Kentro Shop).

**Fase 1 — Relatório (Gestão)**
- Conexão por token manual + Login for Business (testadores), seleção de ativos, sincronização de entidades e insights, abas Visão geral, Campanhas e Criativos (só métricas do Meta), Saúde básica.
- **Aceite:** um cliente piloto conecta em menos de 10 min e vê 90 dias de campanhas com os mesmos números do Gerenciador de Anúncios (tolerância de 1%).

**Situação em 21/10/2026 (Fase 1, código; 182 testes, build e teste de fumaça do `dist/main.js`):**
- Tabelas (migração `meta`): `conexoes_meta` (token AES-256-GCM), `contas_anuncio` (no lugar do `ativos_meta` genérico; páginas e datasets entram nas fases deles), `campanhas`, `conjuntos`, `anuncios` (criativo: título, texto, miniatura, `object_story_id`), `insights_diarios` (chave `conta_anuncio_id + anuncio_id_meta + data`, sem chave estrangeira para a entidade) e `chamadas_meta`.
- Cliente do Graph: token no cabeçalho `Authorization` (nunca na URL), `appsecret_proof` só nos tokens do nosso app, erros classificados (190 → reconectar; 10/200–299 → permissão; 4/17/32/613/80000–80014 → limite com o tempo dos cabeçalhos de uso; 5xx → nova tentativa), paginação por cursor, registro em `chamadas_meta`.
- Conexão por token manual: `/me`, `/me/adaccounts`, `/me/permissions` (tolerante); aviso se faltar `ads_read`; desconectar mantém os números.
- Sincronização: entidades a cada 6 h; carga de 90 dias por relatório assíncrono; horária (ontem + hoje); recálculo diário às 4 h do fuso da conta (últimos 7 dias). Cada intervalo é relido inteiro e substitui o que havia (o Meta omite dias sem entrega). Erro → nova tentativa em 15 min (ou no tempo do limite); token recusado → conexão e conta em `reconectar`, sincronização parada. `SINCRONIZACAO=desligada` desliga a agenda do processo.
- Painel: `GET /v1/painel/{filtros,visao-geral,campanhas,criativos}` (admin e gestor). CPL pela definição de lead de cada conta de anúncio; comparação com o período anterior de mesmo tamanho; série com zero nos dias sem entrega; moedas diferentes exigem filtrar a conta de anúncio. Miniaturas por `GET /m/<anuncio>.<hmac>` (pública, assinada, cache de 6 h, renova a URL do Meta quando expira).
- Gestão 0.2.0: linha de filtros (período, conta, campanha; guardada por usuário), Visão geral (9 indicadores com variação, investimento e leads por dia em dois gráficos com dica e tabela), Campanhas (árvore com ordenação), Criativos (grade), Configurações › Conexão com o Meta (token com passo a passo, contas, o que conta como lead, situação da carga). Ícone no menu.
- **Bugs de fuso achados pelos testes e corrigidos:** dias e instantes vão ao SQL como texto convertido explicitamente (`::date`, `::timestamptz AT TIME ZONE 'UTC'`), sem depender do fuso da sessão do Postgres.
- **21/10/2026: conexão por token manual testada em produção pelo dono do produto, funcionando.** Correção no caminho: o Meta pode recusar `business{name}` em `me/adaccounts` (a conexão agora lista sem ele) e a tela passou a mostrar o motivo real dos erros 5xx.
- ⚠ Conferir com a conta piloto: os tipos de ação de lead (`onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`, `onsite_conversion.messaging_conversation_started_7d`) e os totais contra o Gerenciador.

**Fase 2 — Leads e Atendimento**
- Webhook leadgen + reconciliação, webhook de eventos da Kentro, modelos de automação, painel do atendente (origem, anúncio, formulário, botões), funil Kentro no painel do gestor (Atendidos, Qualificados, Vendas, ROAS, Custo por venda), abas Leads e Equipe.
- **Aceite:** num cliente piloto, lead de formulário e lead de CTWA aparecem no painel do atendente com o anúncio certo; uma venda marcada pelo atendente aparece no ROAS da campanha.

**Situação em 22/10/2026 (Fase 2a, código; 222 testes, build e teste de fumaça). Leads de formulário ficam para a 2b.**
- Tabelas (migração `leads`): `leads` (uma ENTRADA por atendimento ou formulário; únicos `conta + chat_id` e `conta + leadgen_id`; `telefone_chave` = DDD + 8 últimos dígitos) e `eventos_lead` (histórico). `contas.versao_webhook`.
- Identificação do anúncio, nesta ordem: id do anúncio (exato) → URL (permalink do Instagram ou id do post do Facebook dentro da URL) → título + texto normalizados (sem acento e caixa). Os dois últimos ficam marcados como aproximados no painel e na lista. Funciona com ou sem o `source_id` no `ad` (V1 em aberto).
- Telefone: com `+` ou `00` o DDI informado vale; sem eles, 10–11 dígitos ganham o 55.
- `POST /v1/atendimento/vincular` (painel; marca atendido e o atendente), `GET /v1/atendimento/chat/:chatId`, `POST /v1/atendimento/leads/:id/etapa` (venda exige valor e conta como qualificado; descarte exige motivo; reabrir volta para em atendimento). Conversa sem anúncio de quem mandou formulário nos últimos 30 dias continua o lead do formulário.
- Webhook da automação: `POST /v1/kentro/eventos/<conta>.<hmac da versão>` com `chat_iniciado` (não marca atendido: pode estar só com a IA), `qualificado`, `venda` (valor em texto brasileiro aceito) e `descartado`. Corpo lido sem DTO estrito; variável não preenchida (`{{...}}` ou vazia) é ignorada. `GET /v1/kentro/integracao` mostra a URL e os corpos de exemplo; `POST …/rotacionar` invalida a URL antiga.
- Painel: funil por período no fuso da conta (entradas, qualificados, vendas, receita, ROAS, custo por venda, taxa de venda; orgânicos fora do ROAS, contados à parte), vendas por campanha/conjunto/anúncio e criativo, `GET /v1/painel/leads` (telefone mascarado, contagem por etapa, filtros de origem/etapa, 50 por página) e `GET /v1/painel/equipe` (por atendente, com o tempo médio até o painel ser aberto).
- Extensões 0.3.0: Atendimento com origem (trilha campanha › conjunto › anúncio, miniatura, texto, aviso de aproximado), respostas do formulário, botões Qualificado / Venda / Descartar / Reabrir, outras entradas e histórico; Gestão com o bloco "No atendimento" e o funil na Visão geral, colunas de venda e ROAS em Campanhas e Criativos, abas Leads e Equipe e Configurações › Integração com o atendimento.

**Fase 3 — Eventos para o Meta (substitui o n8n)**
- Mapeamento, envio por origem, idempotência, reenvio, teste, aba de envios; links rastreáveis.
- Migrar **Grupo PK** e **Simeão/GLPGás** do n8n (desligar o fluxo antigo no mesmo dia).
- **Aceite:** eventos aparecem no Gerenciador de Eventos sem duplicidade; os fluxos do n8n desligados.

**Situação em 23/10/2026 (Fase 3, código; 243 testes, build e teste de fumaça):**
- Tabelas (migração `capi`): `config_capi` (pixel, token próprio do pixel cifrado e opcional, WABA, código de teste, mapeamento gatilho → evento) e `envios_capi` (fila; único `dataset_id + event_id`).
- **Fila sem pg-boss** (D7): a mesma técnica da agenda (trava `em_envio_ate` + `FOR UPDATE SKIP LOCKED`), um evento por requisição (uma recusa não derruba os outros), rodando no ciclo de 30 s antes da sincronização. Novas tentativas em 1, 5, 30, 120 e 720 min para Meta instável ou limite; recusa de dado vira `erro` na hora (o admin corrige e reenvia); token da conexão recusado → conta em `reconectar` e o envio espera; token próprio recusado não derruba a conexão.
- Gatilhos: `lead_recebido` (só CTWA/link; formulário o Meta já conta), `qualificado`, `venda` (com `value` e `currency`; venda direta também envia o qualificado), `descartado` (desligado por padrão). Orgânicos não enviam. Padrão: Lead / QualifiedLead / Purchase. `event_id = kt-<lead>-<gatilho>`.
- Montagem por origem conforme a seção 9.2 (formulário → `system_generated` + `lead_id`; `ctwa_clid` + WABA → `business_messaging`; o resto → `chat` com `ph`, `fn`, `ln`, `country`, `external_id` em SHA-256).
- Rotas (admin): `GET|PUT /v1/eventos/configuracao`, `GET /v1/eventos/pixels` (`act_x/adspixels` das contas selecionadas), `POST /v1/eventos/testar` (com `test_event_code`), `GET /v1/eventos/envios`, `POST /v1/eventos/envios/:id/reenviar`. O painel do atendente mostra o que já foi ao pixel.
- Extensões 0.4.0: Configurações › Eventos para o Meta; linha "Meta: Lead ✓ · …" no painel do atendente.
- ⚠ Migração do n8n (Grupo PK, Simeão/GLPGás): os fluxos não estão liberados para o MCP do n8n (V7), então a comparação é pelo Gerenciador de Eventos (mesmos nomes de evento? mesmo pixel?). Ligar aqui e desligar o fluxo do n8n no mesmo dia.

**Visual das extensões (0.5.0, 23/10/2026):** sistema próprio sobre os tokens `--ext-*` da Kentro (cor da marca e modo escuro continuam vindo da instância; tons por `color-mix`): ícones de traço próprios (`extension/comum/icones.tsx`), componentes `Secao`, `Vazio`, `Avatar`, `Interruptor`, `Seletor`; abas em pílula com ícone, barra de filtros com seletores próprios e o horário da última sincronização, cartões de indicador com ícone, variação em pílula com seta e mini tendência nos destaques, gráficos e funil em cartões, tabelas em cartão com cabeçalho fixo, etapas coloridas com texto, criativos com posição no ranking. Conferido por prévia local (Playwright + Chrome, `omni` simulado) em claro e escuro.
- Testes: uma configuração só do ts-jest (`api/tsconfig.json`, com JSX do Preact e libs `ES2022`/`DOM.Iterable`). Com duas configurações no mesmo processo, o ts-jest às vezes compilava a API com a das extensões (sem decorators) conforme a ordem das suítes: falha intermitente de "reading 'constructor'".

**Fase 4 — Automação e escala**
- Lead de formulário → atendimento em segundos (captura de webhook + template); tempo real pelo canal; alertas; configuração em um clique pelo MCP da instância (criar a captura e as automações sozinho); detalhamentos por posicionamento, idade e gênero; processo `worker` separado; planos e limites.

---

## 16. Premissas a verificar na Fase 0 (⚠)

| # | Premissa | Como verificar | Se não |
|---|---|---|---|
| V1 | O que vem em `msg.ad` (SDK) num chat real de CTWA: tem o ID do anúncio (`source_id`)? E o `ctwa_clid`? | Extensão de diagnóstico (como a `kentro.zz-grupos-spike`) que imprime `getMessages(...)[0].ad` num atendimento vindo de anúncio, numa instância de cliente com CTWA ativo | Vínculo por URL/título/texto (8.3) e CAPI com `action_source = chat` + telefone (9.2). Pedir ao time da Kentro para expor `source_id` e `ctwa_clid` (ex.: `message_ad_id`, `message_ad_ctwa_clid`), que vale muito para o produto |
| V2 | `message_ad_url` corresponde ao permalink / `object_story_id` do criativo sincronizado | Comparar num chat real com o anúncio no Graph | Casar por título + texto |
| V3 | Lista mínima de permissões do Login for Business e se o token de usuário do sistema serve para CAPI, insights e leads ao mesmo tempo | App em modo desenvolvimento + BM de teste | Pedir `ads_management` / separar o fluxo de leads |
| V4 | Tempo do App Review e da verificação da empresa | Iniciar no dia 1 | Operar com token manual (D5) + testadores |
| V5 | O iframe da Kentro executa o fragmento com o JS embutido | Mesmo formato do painel do Kentro Shop (D9); confirmar ao instalar o esqueleto pelo Doca | Servir o JS como arquivo separado com CORS |
| V6 | `topMenuSubItem` com `parentMenu: "dashboards"` aparece para supervisores | Instalar e abrir com um supervisor | Manter `topMenu` |
| V7 | Como os fluxos atuais do n8n montam o evento (qual `action_source`, quais campos, de onde vem o lead) | Liberar os fluxos para o MCP do n8n ou exportar o JSON | Reproduzir pela seção 9 e comparar no Gerenciador de Eventos |
| V8 | Uma automação disparada na entrada da fila recebe as `message_ad_*` da **primeira** mensagem | Automação de teste com `request` para um `webhook_captures`/endpoint de teste | Painel do atendente como fonte principal; captura pelo histórico |

---

## 17. Fora de escopo (por enquanto)

Google Ads e TikTok (a interface do cliente HTTP e das tabelas não deve impedir, mas não entra agora); edição de campanhas pela Kentro (pausar, mudar orçamento); atribuição multitoque; painel de superadmin com interface.

---

## 18. Referências

- Spec e código do Kentro Shop: `../kentro-shop/docs/superpowers/specs/2026-10-07-kentro-shop-design.md`, `../kentro-shop/api/src`.
- Referência do SDK `omni.*`: `../kentro-shop/docs/kentro/sdk-omni-referencia.md`.
- Fluxos atuais no n8n: "API DE CONVERSÃO META SIMEÃO/GLPGÁS" (`nnjDgRWJDfvJa0V4wHZ1o`), "INTEGRAÇÃO UTM E API DE CONVERSÂO META – [GRUPO PK]" (`67dkOQ-miW2iHuX16dlcF`), "Ads meta Kentro captura UTM" (`mPHzYrQJ7wedt5Pz`). Não estão liberados para o MCP do n8n (V7).
- Meta: Facebook Login for Business, Marketing API Insights (relatórios assíncronos, limites por caso de uso), Webhooks de páginas (`leadgen`), Conversions API (incluindo Conversion Leads e Business Messaging).
