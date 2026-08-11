# Kommo++ VirtruvIA — Descritivo Completo da Plataforma

**Versão:** 1.0 — pronta para build
**Data de congelamento:** 11/08/2026
**Status:** todas as decisões de escopo do lançamento estão fechadas, exceto as listadas na seção 11 (Decisões Pendentes). Este documento é a referência única de escopo para as frentes de construção (Claude, Manus, ChatGPT) descritas na seção 5.
**Como usar este documento para começar a construir agora:** vá direto à seção 10 (Roadmap de Construção) e inicie pela Fase 0. Um brief de execução autônomo da Fase 0, pronto para colar na ferramenta de desenvolvimento, está no arquivo separado `brief_fase0_kickoff_kommo.md`.

## 1. Visão Geral e Proposta de Valor

Kommo++ é um CRM standalone, multi-tenant e messenger-first da VirtruvIA para equipes brasileiras de vendas, atendimento e operação. A plataforma combina CRM configurável para qualquer nicho, inbox omnichannel, telefonia corporativa, automações confiáveis, agentes de IA, BI comercial/marketing e governança enterprise em uma experiência operacional centrada na conversa. O Real brasileiro (BRL) é a moeda base da plataforma: assinatura, faturas, calculadora de custo e valores padrão de negócios e produtos são expressos em BRL; o campo `currency` de negócios, produtos e price books existe para operações pontuais em outra moeda, mas assume BRL por padrão em todo workspace. Cada cliente opera em um workspace isolado, pode configurar seus próprios objetos, campos, pipelines, permissões e integrações sem código, e utiliza canais corporativos unificados — com WhatsApp Business via Twilio, voz via Twilio Voice e dados protegidos por isolamento em nível de linha. O produto elimina dependências de planilhas, integrações frágeis, bots de roteiro e cobrança opaca, mantendo uma assinatura mensal previsível por workspace e controle explícito dos custos variáveis de mensageria, IA e integrações.

## 2. Problema que Resolve

| Área | Falha recorrente do Kommo que motiva o produto | Resposta do Kommo++ | Fonte |
|---|---|---|---|
| Suporte e operação | Suporte lento, pouco contextualizado e sem histórico único de ticket. | Atendimento estruturado, casos, SLA, auditoria e contexto persistente por contato/conversa. | [Capterra](https://www.capterra.com/p/120048/amoCRM/reviews/), [Trustpilot](https://www.trustpilot.com/review/kommo.com) |
| Automação | Bots e automações são frágeis, têm limites operacionais e podem travar após falha de envio. | Workflows testáveis, versionados, com logs por etapa, rollback, retry e idempotência. | [GetApp](https://www.getapp.es/reviews/91200/amocrm), [Kommo Docs](https://support.kommo.com/docs/configure-your-salesbot-triggers) |
| Conversas livres e IA | Salesbot baseado em roteiro não lida bem com linguagem natural; IA sugere respostas, mas não executa processos completos. | Agentes com RAG, ações controladas, guardrails, handoff humano e copiloto interno. | [VentasBoost](https://ventas-boost.com/en/blog/kommo-salesbot-vs-ai-agent), [GetApp](https://www.getapp.es/reviews/91200/amocrm) |
| Dados e pipelines | Modelo centrado apenas em leads/contatos/empresas; falta objeto customizado e trilhas paralelas por negócio. | Objetos customizados, relações configuráveis e pipeline universal com múltiplas trilhas por entidade. | [Exceltic](https://exceltic.dev/en/kommo-priznaki-crm-tormozit-rost/) |
| Campos e filtros | Restrições de campos, edição excessivamente centralizada e filtros inconsistentes para valores nulos. | Campos ilimitados por metadados, permissões delegáveis, versionamento e filtros nativos de vazio/não vazio. | [Capterra](https://www.capterra.com/p/120048/amoCRM/reviews/), [Kommo API Docs](https://developers.kommo.com/docs/limitations) |
| Inbox e canais | Falhas de exibição, falta de diagnóstico, limitação de canais/contas e automações bloqueadas por entrega malsucedida. | Inbox normalizado, múltiplas contas por canal, fila resiliente e status granular de entrega. | [Reddit](https://www.reddit.com/r/CRM/comments/1sqzvb2/better_alternative_to_kommo/), [CRMChat](https://crmchat.ai/blog/kommo-telegram-integration-limitations) |
| Telefonia | Integração de voz insuficiente, sem discador, URA, gravação ou número por agente integrados ao CRM. | Telefonia corporativa nativa com Twilio Voice dentro do Módulo B. | [Capterra](https://www.capterra.com/p/120048/amoCRM/reviews/) |
| BI | Relatórios rígidos e necessidade de exportação para planilhas para análises multidimensionais. | BI nativo sem código, métricas de funil, coorte, atribuição, metas, comissões e IA analítica respeitando permissões. | [Capterra](https://www.capterra.com/p/120048/Kommo/), [Exceltic](https://exceltic.dev/en/kommo-metabase-analitika-crm/) |
| Governança e dados | Permissões insuficientemente granulares, relatos de perda de dados, importação sem proteção e backups limitados. | RBAC + ABAC, auditoria append-only, prévia/rollback de importação, exportação incremental e backup restaurável. | [Exceltic](https://exceltic.dev/en/kommo-priznaki-crm-tormozit-rost/), [Trustpilot](https://es.trustpilot.com/review/kommo.com) |
| Onboarding e preço | Curva de aprendizado elevada, configuração dependente de especialista, contrato longo e custo crescente por assento. | Onboarding self-service, configuração visual e modelo mensal por workspace/volume com calculadora de custo total. | [Capterra](https://www.capterra.com/p/120048/Kommo/reviews/), [DMly](https://dmly.io/kommo-review/) |

## 3. Modelo de Produto e Negócio

### 3.1 Produto standalone e unidade de tenant

Kommo++ é um produto independente do sistema multicliente anterior da VirtruvIA. Cada empresa assinante recebe um `workspace` isolado, com usuários, dados, pipelines, canais, agentes de IA, integrações, permissões e faturamento próprios. O mesmo usuário pode participar de múltiplos workspaces quando necessário, por exemplo em operações de consultoria.

Todo dado operacional sensível pertence a um `workspace_id`. O isolamento de tenant é obrigatório por Row Level Security (RLS), aplicado no banco e reforçado pela camada de aplicação.

### 3.2 Papel da VirtruvIA

A VirtruvIA atua como reseller e super admin da plataforma. O papel `reseller_admin` permite provisionamento, acompanhamento de saúde, suporte e faturamento cross-workspace. Esse acesso é exclusivamente administrativo, executado por rotas de servidor autenticadas e sempre registrado na trilha de auditoria; não é exposto ao client-side.

### 3.3 Onboarding self-service

A criação de um workspace suporta fluxo self-service ou assistido, sem exigir configuração manual pela VirtruvIA:

1. criação da conta e do workspace;
2. escolha de plano e ativação da assinatura recorrente;
3. configuração de usuários, papéis e SSO quando aplicável;
4. importação ou migração de dados;
5. criação de objetos, campos e pipelines;
6. conexão de canais corporativos e integrações;
7. convite de usuários;
8. ativação de automações, agentes e dashboards.

A arquitetura de billing deve existir desde a fundação, com cobrança recorrente por workspace por um provedor como Stripe ou Pagar.me; a definição comercial de valores, franquias e gateways prioritários permanece parametrizável.

### 3.4 Princípios de produto

- **Messenger-first:** o cockpit de atendimento é uma central de operação, não apenas uma caixa de entrada.
- **Multi-nicho por design:** o modelo é genérico; nichos são configurados por objetos, campos, pipelines, metas e tipos de tarefa, nunca por schema fixo.
- **Sem limites artificiais de automação:** planos não limitam quantidade de automações, nós ou ações por tier.
- **Dados e custos transparentes:** eventos, automações, decisões de IA, consumo e cobranças devem ser auditáveis e visíveis.
- **Integrar antes de internalizar:** pagamentos, sites, ERP, assinatura eletrônica e enriquecimento são conectados por integração quando não forem um motor central do CRM.

## 4. Arquitetura de Módulos

### Módulo A — Núcleo CRM, Dados Configuráveis e Tarefas

O Módulo A é o motor de registros e processos da plataforma. Ele oferece contatos, empresas, negócios, objetos customizados, campos configuráveis e pipelines para qualquer entidade.

Funcionalidades definitivas:

- Contatos, empresas e negócios com timeline de canais e atividades.
- Relação N:N entre contatos e empresas.
- Objetos customizados criados pela interface, como matrícula, reserva, apólice, contrato ou processo.
- Relações visuais entre objetos customizados, contatos, empresas e negócios, sem código.
- Campos customizados em `JSONB`, validados por metadados, sem limite artificial de quantidade.
- Tipos de campo: texto, número, moeda, data, booleano, seleção, multiseleção, relação, e-mail, telefone e `ai_generated`.
- Campos `ai_generated` são preenchidos automaticamente por IA a partir de prompt/template configurável, como objeção principal ou sentimento da conversa, com rastreabilidade da geração.
- Filtros completos, incluindo “é vazio” e “não é vazio” em todos os tipos de campo.
- Versionamento de schema de campos e edição delegável por papel.
- Pipelines 100% configuráveis por arrasta-e-solta para contato, empresa, negócio ou tipo de objeto customizado.
- Trilhas paralelas: uma mesma entidade pode ter itens simultâneos em múltiplos pipelines, cada um com estágio, responsável e prazo próprios.
- Histórico automático de movimentação entre estágios e duração por etapa.
- Tarefas, atividades, recorrências, calendário, catálogo global de tipos/códigos por workspace e resultados estruturados; `task_types` não varia por pipeline ou departamento.
- Página pública de agendamento no lançamento, vinculada a usuário ou equipe, disponibilidade, duração, buffer e tipo de tarefa; cada agendamento cria tarefa e pode criar contato ou negócio.
- Resumos de tarefa e de histórico por contato/negócio, alimentando produtividade e conversão no Módulo E.
- Catálogo de produtos por workspace, com nome, SKU, preço padrão, moeda e status ativo/inativo.
- Price books (tabelas de preço) por segmento, canal ou moeda, permitindo preço diferenciado do mesmo produto.
- Itens de negócio (produto, quantidade, preço unitário e desconto percentual) associados a cada negócio, com valor total calculado automaticamente pela soma dos itens.
- Quando o negócio possui itens de negócio, `deals.value` passa a ser derivado automaticamente da soma dos itens; sem itens, o valor permanece editável manualmente como hoje.
- Produtos, preço, quantidade e valor total do negócio ficam visíveis e editáveis diretamente no cartão do negócio, inclusive no cockpit do Módulo B, sem precisar abrir uma tela separada.
- Campanhas CRM são objetos do Núcleo CRM, com membros, influência em negócios e atribuição para canais pagos, orgânicos e offline.
- Regras de resolução de identidade por telefone, e-mail e CPF/CNPJ identificam duplicidades e alimentam uma fila de merge revisável; sessões anônimas de visitantes permanecem para versão posterior, quando houver pixel web/webchat priorizado.

### Módulo B — Chat, Inbox Omnichannel e Voz

O Módulo B centraliza mensagens, conversas e chamadas corporativas em uma única operação conectada ao Núcleo CRM.

Canais suportados no lançamento:

| Canal | Modalidade |
|---|---|
| WhatsApp Business | Via Twilio como BSP; múltiplos números por workspace e múltiplos agentes por número. |
| Instagram Direct | Conta profissional Business ou Creator vinculada a página. |
| Facebook Messenger | Página vinculada e separação explícita entre automação e atendimento humano. |
| Telegram | Múltiplas contas por workspace, incluindo grupos e canais. |
| E-mail | Caixa compartilhada por equipe. |
| Chat do site | Widget configurável e associado ao CRM. |
| SMS | Via Twilio. |
| Voz | Twilio Voice: discador, URA, filas, callback, gravação, transcrição e número por agente. |

Funcionalidades definitivas:

- Onboarding guiado de WhatsApp, status de templates e diagnóstico de qualidade do canal.
- Número corporativo único sob gestão da operação; a sincronização do WhatsApp pessoal do vendedor não faz parte do produto.
- Múltiplas contas por canal no mesmo workspace.
- Fila de envio com retry, backoff e erro isolado: falha em uma mensagem não bloqueia outras mensagens ou automações.
- Timeline unificada do contato, ainda que ele converse por vários canais.
- Status granular de entrega por mensagem: fila, enviada, entregue, lida ou falha com motivo legível.
- SLA de primeira resposta e resolução por canal.
- Conversão de conversa em negócio e movimentação de pipeline diretamente pelo inbox.
- Cockpit em três colunas: lista de conversas, thread/composer e cartão operacional do lead.
- Ações sem sair do chat: mudar estágio, trocar responsável, criar tarefa, criar nota, editar campos customizados e visualizar dados do negócio.
- Áudio com player, duração, transcrição assíncrona sempre disponível e gravação push-to-talk pelo agente. A transcrição é medida por minuto, com franquia mensal por plano e excedente repassado com transparência conforme o Módulo G.
- Resumos de conversa gerados sob demanda ou automaticamente ao encerrar, armazenados com pontos-chave estruturados. O resumo automático é padrão global do workspace para todos os canais e pode ser desativado integralmente por Owner ou Admin.
- Revisão de texto por IA no composer; corretor nativo do navegador habilitado.
- Emojis e reações a mensagens, inclusive reações espelhadas do canal.
- Chamadas de voz vinculadas a conversas e ao histórico do cliente; o agente de voz autônomo é uma ambição de versão posterior, não um requisito de lançamento.
- Comércio conversacional: o atendente ou agente envia cards do catálogo de produtos pelo WhatsApp, o lead seleciona itens e o cockpit cria automaticamente o negócio com seus itens; a cobrança é gerada pela integração de pagamento do Módulo I.

### Módulo C — Motor de Automação Confiável

O Módulo C executa automações orientadas a eventos com confiabilidade observável e sem falhas silenciosas.

Funcionalidades definitivas:

- Builder guiado por etapas, no formato linear com ramificações simples `se/senão`; não utiliza canvas livre de nós arbitrários.
- Gatilhos de alteração de campo, mudança de estágio, recebimento de mensagem, criação de registro, tempo e webhook.
- Ações nativas de atualização de campo, movimentação de pipeline, envio de mensagem, criação de tarefa e chamada HTTP/webhook genérica.
- Teste obrigatório em sandbox/dry-run antes da primeira publicação, sem efeitos externos.
- Versionamento imutável, publicação de nova versão e rollback de um clique.
- Log completo de execução e de cada nó, com entradas, saídas, erro e duração.
- Jobs agendados persistentes para esperas e ações futuras; nenhuma espera depende de `setTimeout` em memória.
- Chaves de idempotência por ação externa para impedir duplicação em reprocessamentos.
- Falhas isoladas por execução, com retry e backoff quando aplicável.
- Alerta de impacto ao editar automação ativa, indicando execuções em curso afetadas.
- Ramos por resultado de ação, divisão A/B e monitoramento de saúde de workflow.
- Verificação obrigatória de consentimento registrado antes de comunicação em massa; respostas humanas 1:1 não são bloqueadas.
- Roteamento de solicitações de aprovação pelo motor de automação para a regra de aprovador definida no Módulo F, incluindo desconto, publicação de campanha e exclusão em massa.

### Módulo D — Inteligência Artificial

O Módulo D possui duas camadas independentes de IA, com usuários, escopos e cobrança próprios.

#### D1 — Copiloto interno nativo

O copiloto atende usuários internos do CRM e está incluído na assinatura principal. Ele sugere e corrige mensagens, responde dúvidas contextualizadas sobre CRM e conversas, produz resumos e gera insights proativos de SLA, sentimento, lead parado, produtividade ou anomalias.

O copiloto não conversa com o cliente final e não consome o pacote de conversas de agentes atendentes.

#### D2 — Agentes atendentes configuráveis

Os agentes atendentes conversam com o cliente final por canais autorizados. Cada workspace pode manter múltiplos agentes, com persona, base de conhecimento, política e escopo de canal próprios.

Funcionalidades definitivas:

- RAG por agente e workspace, alimentado por documentos, URLs, FAQs e dados de CRM.
- Indexação vetorial via `pgvector` e isolamento de toda a cadeia de conhecimento por workspace.
- Escolha de provedor pelo cliente final: Claude, GPT ou Gemini; a plataforma mantém o mapeamento para a versão mais recente suportada de cada provedor.
- Conexão opcional de chave própria de LLM ou servidor MCP por workspace para os agentes. O consumo via BYO-LLM não entra na franquia de conversas de agentes D2.
- Ações no CRM: criar negócio, atualizar campo, mover estágio, enviar mensagem, chamar webhook, agendar tarefa e preencher campos `ai_generated` autorizados.
- Ações sensíveis com aprovação humana configurável.
- Guardrails para tópicos bloqueados, descontos máximos, sentimento e frases obrigatórias de compliance.
- Handoff configurável por baixa confiança, sentimento negativo, solicitação explícita, tópico sensível ou falha repetida.
- Transferência para humano com todo o histórico e os turnos do agente preservados.
- Citações e proveniência em respostas baseadas na base de conhecimento.
- Central de testes obrigatória antes de publicar um agente, com casos de teste, limiar mínimo de acerto e bloqueio de publicação quando reprovado.
- Observabilidade por sessão, ação e conversa: latência, erro, handoff, qualidade e custo.
- Cobrança de D2 por pacote de conversas, não por token ou outcome: uma sessão contínua de agente conta como uma unidade; reabertura após 24 horas de inatividade inicia nova unidade.
- Uso visível em tempo real. Aos 80% e 100% do pacote, o sistema envia notificação in-app e por e-mail. Ao atingir o limite, o agente é pausado; não há cobrança automática de excedente sem ação do cliente.
- Coaching de vendedor por IA para chamadas transcritas e conversas de chat: scorecard por atendimento com proporção de fala, perguntas de descoberta, tratamento de objeção, compromisso de próximo passo e sugestões de melhoria por vendedor.

### Módulo E — Dashboards, BI, Metas e Inteligência Comercial

O Módulo E entrega BI nativo sem código, com isolamento por workspace, atualização operacional quase em tempo real e sincronização periódica para dados históricos e externos.

Funcionalidades definitivas:

- Construtor de relatórios com cortes multidimensionais, incluindo responsável, origem, período, valor, pipeline, unidade, canal e segmentos customizados.
- Funil de mídia a comercial, coortes, atribuição, conversão, aging, tempo por etapa, perdas e atividade de vendedor.
- Comparação lado a lado de segmentos, unidades, produtos ou pipelines; não soma entidades distintas por padrão.
- Visões de comercial, pipeline, origem/canal/região, vendedores, perdas, financeiro/produto, marketing e agente SDR.
- Metas por workspace, equipe, usuário, pipeline ou segmento customizado.
- Comissões por faixa cumulativa e forma de pagamento, com cálculo auditável por venda.
- Metas de atividade usando dados de tarefas, além de metas de receita, leads e negócios ganhos.
- Integração com Meta Ads, Google Ads e métricas orgânicas, com sincronização por job a cada poucas horas e badge visível de defasagem/estado da integração.
- Atribuição de campanhas CRM pagas, orgânicas e offline a contatos e negócios para fechar o ciclo mídia → lead → negócio → receita.
- Dashboards de gestor com scorecards e sugestões de coaching por vendedor, originados da análise de chamadas e conversas pelo Módulo D.
- Alertas em linguagem simples, utilizando as regras do copiloto: campanha sem conversão, vendedor abaixo da média, risco de SLA, queda de sentimento e anomalia de automação.
- Notas metodológicas em widgets, com fórmula explícita de cada métrica, e estados vazios explicados.
- AI Analyst para perguntas em linguagem natural sobre dados, sempre respeitando as mesmas permissões por linha e por campo do usuário.

### Módulo F — Governança, Permissões e Confiabilidade

O Módulo F estabelece segurança, recuperação de dados, transparência comercial e confiabilidade operacional.

Funcionalidades definitivas:

- RBAC combinado com ABAC: permissão por papel, recurso, ação, equipe, próprio registro, segmento customizado e campo.
- Seis papéis de sistema: Owner, Admin, Gestor, Atendente, Marketing/Campanhas e Somente leitura. Papéis podem ser clonados e customizados pelo contratante.
- Ocultação, leitura e edição em nível de campo; exceções específicas por registro.
- SSO de lançamento para Google, Microsoft e SAML genérico, com possibilidade de obrigatoriedade por workspace.
- Trilha de auditoria imutável e append-only para usuários, automações, agentes, reseller admins e sistema.
- Importação em duas etapas: prévia, validação, confirmação explícita, commit, rastreio por linha e rollback.
- Exportação completa, incremental ou filtrada em CSV/JSON.
- Backup diário, backup manual, backup antes de exclusões/cancelamento e restauração self-service total ou seletiva.
- Exclusão de volume protegida por token de confirmação e auditada.
- Cancelamento self-service com cálculo de período, política de reembolso exibida, acesso até o término do período pago e exportação proativa dos dados.
- Página pública de status por componente, testes de regressão para automações e monitoramento preventivo de canais/workspaces.
- Sandbox leve por objeto em modo rascunho para validar automações, pipelines e agentes antes da ativação.
- Classificação de sensibilidade em campos para restringir uso de PII/financeiro em IA e exportação.
- Configuração de workspace auditada para manter ou desativar integralmente o resumo automático de conversa ao encerrar; o padrão é habilitado para todos os canais e somente Owner ou Admin pode alterá-lo.
- Consent Ledger com registros de consentimento e preferências de comunicação, auditado para disparos em massa e campanhas; respostas humanas 1:1 permanecem permitidas.
- Regras de aprovação por workspace para definir aprovadores de desconto, publicação de campanha e exclusão em massa, com decisão registrada e rastreável.

### Módulo G — Precificação, Billing e Transparência de Custo

O Módulo G sustenta uma oferta mensal, sem contrato mínimo de seis meses, orientada por workspace e volume de uso — não apenas por assento. A assinatura principal cobre o CRM, copiloto D1, canais incluídos, automações, governança e dashboards conforme o plano contratado. Custos variáveis são expostos em calculadora de custo total, com separação entre mensageria, agentes atendentes e integrações.

Funcionalidades definitivas:

- Assinatura recorrente por workspace, preparada desde a fundação do tenant.
- Planos mensais e simulador de custo total para o cliente final.
- Visibilidade de consumo de WhatsApp, minutos de transcrição de áudio e pacotes de agentes D2.
- Franquia mensal de minutos de transcrição por plano e excedente faturado pelo custo do provedor acrescido de margem, com cálculo e repasse transparentes.
- Pacotes de conversas de agentes com pausa ao atingir o limite, sem excedente automático.
- Registro de cancelamento, período remanescente e reembolso no Módulo F.
- Repasse transparente da mensageria de marketing e dos custos do BSP quando aplicáveis.

A lógica de WhatsApp é detalhada na seção 7.

### Módulo H — Atendimento, Casos e Conhecimento

O Módulo H separa formalmente o atendimento estruturado da conversa comercial. Uma conversa pode originar um caso sem duplicar o contato ou o histórico.

Funcionalidades definitivas:

- Casos vinculados a contato, empresa, conversa de origem e pipeline.
- Prioridade, status, SLA de primeira resposta e SLA de resolução por caso.
- Filas compartilhadas com regras de roteamento e capacidade máxima por atendente.
- Reaproveitamento de `sla_policies` do Módulo B para conversas e casos.
- Base de conhecimento pesquisável, publicada por idioma/categoria e reutilizada como fonte dos agentes D2.
- Pesquisa de satisfação pós-resolução com CSAT, NPS e comentário.
- Métricas próprias de backlog, prazo, resolução, reabertura e satisfação, separadas das métricas de venda.
- Quadro leve de tarefas de projeto exclusivamente para atendimento, reaproveitando as tarefas vinculadas a `case_id` para checklists de onboarding e implementação por cliente; não constitui um módulo genérico de gestão de projetos.

A separação entre conversa e caso evita que atendimento, backlog e SLA fiquem misturados aos funis comerciais.

### Módulo I — Central de Integrações

O Módulo I é o marketplace e framework de conexões self-service da plataforma. Ele usa OAuth2 ou chave de API, credenciais criptografadas, escopos visíveis, reconexão/revogação e log de webhooks.

Categorias e escopo:

- **Pagamentos:** o cliente conecta seu próprio gateway — Mercado Pago, PagBank/PagSeguro, Asaas, Efí, Iugu ou outros do catálogo — e o CRM orquestra cobranças ligadas ao negócio. Kommo++ não processa, custodia ou concilia dinheiro diretamente.
- **Sites e landing pages:** conectores para WordPress, Webflow, Elementor e construtores equivalentes; formulários criam leads no CRM com atribuição de origem.
- **Personalização/CRO:** categoria operacional do lançamento para ferramentas de teste e personalização por dados do CRM, conectadas por API key ou OAuth sem acoplamento a fornecedor específico.
- **Categorias de versão posterior:** ERP (Omie, Bling, TOTVS), assinatura eletrônica (Clicksign, D4Sign, Autentique) e enriquecimento de dados (BigDataCorp, ReceitaWS).

Os gaps que entraram no escopo são: pagamento e comércio conversacional no chat por orquestração via gateway, porque removem a quebra entre seleção de produtos, fechamento e cobrança sem transformar o CRM em fintech; telefonia corporativa via Twilio Voice, porque ligações fazem parte do processo comercial; atendimento por casos, porque SLA e suporte exigem objeto próprio separado de conversas de venda; e Personalização/CRO, entregue como framework genérico de integração.

## 5. Arquitetura Técnica

### 5.1 Stack de aplicação

| Camada | Tecnologia e responsabilidade |
|---|---|
| Frontend e APIs curtas | **Next.js** hospedado na **Vercel**, com CDN global, funções de curta duração e PWA no lançamento. A PWA mantém fila offline para tarefas, notas e check-ins de campo, sincronizando ao reconectar. [Vercel](https://vercel.com/pricing) |
| Banco e autenticação | **Supabase Postgres**, schema compartilhado com `workspace_id` em tabelas de tenant, RLS e `pgvector` para conhecimento de IA. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| Tempo real e workers | Serviço persistente em **Railway** para WebSocket, webhooks, filas, retry, automações, sincronizações e ingestão de IA. **Render** é alternativa compatível para serviço web, worker e cron. [Railway Docs](https://docs.railway.com/guides/sse-vs-websockets), [Render](https://render.com/articles/railway-vs-vercel) |
| Realtime operacional | Supabase Realtime para presença, notificações, status de aprovação e eventos de chat; não é usado como motor de dashboard histórico pesado. |
| WhatsApp | **Twilio** como BSP inicial para WhatsApp Business, com WABAs associadas ao Business Manager do cliente final e arquitetura preparada para futura migração a Tech Provider direto. [Twilio WhatsApp Pricing](https://www.twilio.com/en-us/whatsapp/pricing), [Meta — migração de WABA](https://developers.facebook.com/docs/whatsapp/solution-providers/support/migrating-wabas-among-solution-partners-via-embedded-signup/) |
| Voz, SMS e telefonia | **Twilio Voice** e Twilio para SMS, centralizando vendor crítico de comunicação corporativa. |

### 5.2 Topologia operacional

1. Next.js entrega a interface, autentica usuários e fornece APIs de curta duração.
2. Provedores de canal enviam webhooks ao serviço persistente do Railway.
3. O serviço normaliza eventos, grava em Supabase, publica atualizações por WebSocket/Supabase Realtime e enfileira envios.
4. A fila de saída executa retry/backoff e persiste falhas sem bloquear outras conversas ou workflows.
5. O mesmo worker processa jobs agendados de automação, ingestão/indexação de conhecimento, sincronização de anúncios e integrações.
6. Eventos operacionais alimentam o banco transacional; agregações históricas e métricas externas são sincronizadas por job agendado.

### 5.3 Isolamento e segurança

- Toda tabela de dados de tenant inclui `workspace_id`, exceto tabelas globais de catálogo explicitamente administradas pela VirtruvIA.
- RLS permite acesso apenas quando o usuário possui `workspace_members` ativo ligado ao seu `auth.uid()`.
- `reseller_admins` tem política administrativa separada, utilizada somente no servidor e auditada.
- Credenciais de canais e integrações são armazenadas criptografadas.
- Índices devem existir em `workspace_id` e em toda coluna usada em políticas RLS; campos `JSONB` filtráveis recebem índices GIN quando necessário. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- A WABA de cada cliente pertence ao Business Manager do próprio cliente final; isso preserva propriedade e simplifica futura migração de BSP. [Meta — migração de WABA](https://developers.facebook.com/docs/whatsapp/solution-providers/support/migrating-wabas-among-solution-partners-via-embedded-signup/)

### 5.4 Restrições de provedores e controles de fila

- O WhatsApp é lançado por meio da Twilio como BSP. A plataforma preserva o vínculo de cada WABA ao Business Manager do cliente final, registra a associação no `channel_accounts` e mantém o histórico em `messages`; assim, uma migração futura de BSP ou para Tech Provider direto não depende do histórico mantido pelo provedor. [Meta — migração de WABA](https://developers.facebook.com/docs/whatsapp/solution-providers/support/migrating-wabas-among-solution-partners-via-embedded-signup/)
- Instagram Direct exige conta Business ou Creator vinculada a uma Página do Facebook. A produção além de usuários de teste requer App Review para a permissão de mensagens correspondente. [Meta for Developers](https://developers.facebook.com/docs/messenger-platform/instagram/get-started/)
- A fila de envio aplica limites por `channel_account`, inclusive o teto de 200 mensagens automáticas por hora por conta no Instagram, em vez de controlar somente throughput global. [Storrito](https://storrito.com/resources/instagram-api-2026/)
- Templates de WhatsApp mantêm categoria e status de aprovação em `message_templates`; mensagens fora da janela permitida devem falhar de forma explícita, com erro legível, sem bloquear a conversa nem a automação.

## 6. Modelo de Dados

### 6.1 Fundação de tenant e identidade

| Tabela | Colunas principais | Finalidade |
|---|---|---|
| `workspaces` | `id`, `name`, `slug`, `plan`, `status`, `auto_summary_on_resolve` (`boolean`, padrão `true`), `created_at` | Tenant raiz do produto; a flag controla globalmente o resumo automático para todos os canais. |
| `workspace_members` | `id`, `workspace_id`, `user_id`, `role`, `status`, `created_at` | Vínculo usuário–workspace; os valores-base de `role` são `owner`, `admin`, `manager`, `agent` e `viewer`, complementados pelo motor de papéis do Módulo F. |
| `reseller_admins` | `id`, `user_id`, `scope` (`all_workspaces`) | Acesso cross-workspace da VirtruvIA. |

### 6.2 Campos customizados e entidades do Núcleo CRM

| Tabela | Colunas principais |
|---|---|
| `field_definitions` | `id`, `workspace_id`, `entity_kind` (`contact`\|`company`\|`deal`\|`object_type_id`), `object_type_id`, `key`, `label`, `field_type` (`text`,`number`,`currency`,`date`,`boolean`,`select`,`multiselect`,`relation`,`email`,`phone`,`ai_generated`), `options jsonb`, `ai_generation_config jsonb`, `is_required`, `is_filterable`, `position`, `editable_roles text[]`, `sensitivity_level` (`none`\|`pii`\|`financial`), `created_at` |
| `field_schema_versions` | `id`, `field_definition_id`, `version`, `change_type`, `changed_by`, `created_at` |
| `contacts` | `id`, `workspace_id`, `name`, `email`, `phone`, `owner_id`, `source`, `custom_fields jsonb`, `created_at`, `updated_at` |
| `companies` | `id`, `workspace_id`, `name`, `domain`, `owner_id`, `custom_fields jsonb`, `created_at`, `updated_at` |
| `deals` | `id`, `workspace_id`, `title`, `value`, `currency` (`DEFAULT 'BRL'`), `contact_id`, `company_id`, `owner_id`, `custom_fields jsonb`, `status` (`open`\|`won`\|`lost`), `created_at`, `updated_at` |
| `contact_company_links` | `contact_id`, `company_id`, `role` |
| `campaigns` | `id`, `workspace_id`, `name`, `channel`, `type` (`pago`\|`organico`\|`offline`), `budget` (BRL), `start_date`, `end_date`, `utm_source`, `utm_medium`, `utm_campaign`, `status` |
| `campaign_members` | `id`, `campaign_id`, `contact_id`, `deal_id` nullable, `status` (`alvo`\|`respondeu`\|`convertido`), `added_at` |
| `campaign_influence` | `id`, `deal_id`, `campaign_id`, `influence_type` (`primeiro_toque`\|`ultimo_toque`\|`multi_toque`), `weight` |
| `identity_resolution_rules` | `id`, `workspace_id`, `match_fields jsonb` (telefone, e-mail e CPF/CNPJ), `match_type` (`exact`\|`fuzzy`), `auto_merge_threshold` |
| `identity_merge_queue` | `id`, `workspace_id`, `candidate_contact_id`, `existing_contact_id`, `confidence_score`, `status` (`pending_review`\|`auto_merged`\|`rejected`), `reviewed_by` |

Todos os registros de `contacts`, `companies`, `deals` e `object_records` mantêm `custom_fields jsonb DEFAULT '{}'`. A aplicação valida os valores contra `field_definitions` antes de persistir; campos usados em filtros recebem índice GIN conforme a necessidade. Para `ai_generated`, `ai_generation_config` armazena o prompt/template e o runtime do Módulo D registra a execução auditável antes de atualizar o campo.

### 6.3 Objetos customizados e relações

| Tabela | Colunas principais |
|---|---|
| `object_types` | `id`, `workspace_id`, `name`, `icon`, `description`, `created_by`, `created_at` |
| `object_records` | `id`, `workspace_id`, `object_type_id`, `title`, `owner_id`, `custom_fields jsonb`, `created_at`, `updated_at` |
| `object_relations` | `id`, `workspace_id`, `from_kind`, `from_id`, `to_kind`, `to_id`, `relation_label` |

### 6.4 Pipelines e histórico de estágio

| Tabela | Colunas principais |
|---|---|
| `pipelines` | `id`, `workspace_id`, `name`, `entity_kind` (`contact`\|`company`\|`deal`\|`object_type_id`), `object_type_id`, `is_default`, `created_by`, `created_at` |
| `pipeline_stages` | `id`, `pipeline_id`, `name`, `position`, `color`, `is_won`, `is_lost`, `probability`, `wip_limit`, `created_at` |
| `pipeline_items` | `id`, `pipeline_id`, `stage_id`, `entity_kind`, `entity_id`, `position_in_stage`, `entered_stage_at`, `assigned_to`, `created_at`, `updated_at` |
| `pipeline_stage_history` | `id`, `pipeline_item_id`, `from_stage_id`, `to_stage_id`, `moved_by`, `moved_at`, `duration_seconds` |

Um trigger em `pipeline_items` grava `pipeline_stage_history` a cada alteração de `stage_id`, calculando a duração pelo estágio anterior. A interface usa `position` para colunas e `position_in_stage` para cards. Arrastar um card atualiza diretamente o item; o trigger preserva a auditoria e alimenta métricas do Módulo E.

### 6.5 Catálogo de produtos, price books e itens de negócio

| Tabela | Colunas principais |
|---|---|
| `products` | `id`, `workspace_id`, `name`, `sku`, `default_price`, `currency` (`DEFAULT 'BRL'`), `is_active` |
| `price_books` | `id`, `workspace_id`, `name`, `currency` (`DEFAULT 'BRL'`), `is_default` |
| `price_book_entries` | `id`, `price_book_id`, `product_id`, `unit_price` |
| `deal_line_items` | `id`, `deal_id`, `product_id`, `price_book_id`, `quantity`, `unit_price`, `discount_percent`, `line_total` |

`line_total` é calculado por `quantity * unit_price * (1 - discount_percent)`. Um trigger em `deal_line_items` recalcula `deals.value` como a soma dos `line_total` ativos sempre que um item é criado, alterado ou removido; um negócio sem itens mantém `deals.value` editável manualmente. `price_book_entries` permite preço específico por price book sem duplicar o cadastro do produto; na ausência de entrada específica, usa-se `products.default_price`. Todos os valores monetários assumem BRL por padrão; um workspace só grava um produto, price book ou negócio em outra moeda quando o usuário altera explicitamente o campo `currency`.

### 6.6 Chat, inbox, voz e cockpit

| Tabela | Colunas principais |
|---|---|
| `channel_accounts` | `id`, `workspace_id`, `channel_type` (`whatsapp`\|`instagram`\|`messenger`\|`telegram`\|`email`\|`webchat`\|`sms`\|`voice`), `external_account_id`, `display_name`, `credentials` criptografado, `status` (`active`\|`quality_issue`\|`disconnected`), `created_at` |
| `agent_numbers` | `id`, `channel_account_id`, `agent_id`, `phone_number` |
| `conversations` | `id`, `workspace_id`, `channel_account_id`, `contact_id`, `company_id`, `deal_id`, `status` (`open`\|`pending`\|`resolved`), `assigned_to`, `is_bot_active`, `last_message_at`, `sla_due_at`, `created_at` |
| `messages` | `id`, `conversation_id`, `direction` (`inbound`\|`outbound`), `sender_type` (`contact`\|`agent`\|`bot`\|`system`), `content`, `media_url`, `media_type` (`text`\|`image`\|`audio`\|`video`\|`document`\|`location`), `duration_seconds`, `transcript`, `external_message_id`, `delivery_status` (`queued`\|`sent`\|`delivered`\|`read`\|`failed`), `error_reason`, `created_at` |
| `message_templates` | `id`, `workspace_id`, `channel_account_id`, `name`, `body`, `approval_status`, `category` |
| `channel_quality_events` | `id`, `channel_account_id`, `event_type` (`quality_drop`\|`ban_risk`\|`reconnect_needed`), `detail`, `created_at` |
| `voice_calls` | `id`, `conversation_id`, `direction` (`inbound`\|`outbound`), `from_number`, `to_number`, `agent_id`, `recording_url`, `duration_seconds`, `transcript`, `ivr_path`, `created_at` |
| `sla_policies` | `id`, `workspace_id`, `channel_type`, `first_response_minutes`, `resolution_minutes` |
| `notes` | `id`, `workspace_id`, `related_to_type` (`contact`\|`deal`\|`company`), `related_to_id`, `author_id`, `body`, `is_pinned`, `created_at` |
| `conversation_summaries` | `id`, `conversation_id`, `summary_text`, `key_points jsonb`, `generated_at`, `generated_by` (`manual`\|`auto_on_resolve`) |
| `message_reactions` | `id`, `message_id`, `reactor_type` (`contact`\|`agent`), `reactor_id`, `emoji`, `created_at` |

Regras obrigatórias: cada conversa pertence a exatamente um `channel_account`; um contato pode ter conversas simultâneas em vários canais; uma resposta humana desativa `is_bot_active`; falhas de entrega não bloqueiam novas mensagens; e uma conversa pode criar ou associar um negócio/pipeline item sem duplicar cadastro.

### 6.7 Automação

| Tabela | Colunas principais |
|---|---|
| `automations` | `id`, `workspace_id`, `name`, `entity_kind` (`contact`\|`company`\|`deal`\|`object_type_id`\|`conversation`), `status` (`draft`\|`active`\|`paused`), `active_version_id`, `created_by`, `created_at` |
| `automation_versions` | `id`, `automation_id`, `version_number`, `definition jsonb`, `published_by`, `published_at`, `is_active` |
| `automation_triggers` | `id`, `automation_id`, `trigger_type` (`field_changed`\|`stage_changed`\|`message_received`\|`record_created`\|`time_based`\|`webhook_received`), `config jsonb` |
| `automation_runs` | `id`, `automation_id`, `automation_version_id`, `trigger_context jsonb`, `status` (`running`\|`succeeded`\|`failed`\|`partial`), `started_at`, `finished_at` |
| `automation_run_steps` | `id`, `run_id`, `node_id`, `node_type`, `status`, `input jsonb`, `output jsonb`, `error_message`, `started_at`, `finished_at` |
| `automation_test_runs` | `id`, `automation_version_id`, `sample_record_id`, `steps_preview jsonb`, `created_by`, `created_at` |
| `automation_scheduled_jobs` | `id`, `automation_run_id`, `node_id`, `run_at`, `status` (`pending`\|`processed`\|`cancelled`) |

A primeira publicação exige ao menos um `automation_test_run` bem-sucedido. Uma publicação sempre cria versão imutável; rollback apenas reativa versão anterior. O worker persistente executa `automation_scheduled_jobs`, registra runs e aplica idempotência em ações externas.

### 6.8 IA: copiloto e agentes atendentes

| Tabela | Colunas principais |
|---|---|
| `copilot_interactions` | `id`, `workspace_id`, `user_id`, `conversation_id`, `interaction_type` (`suggestion`\|`correction`\|`qa`\|`insight`), `input_context`, `output_content`, `accepted`, `created_at` |
| `copilot_insight_rules` | `id`, `workspace_id`, `rule_type` (`stale_lead`\|`sentiment_drop`\|`response_time_spike`\|`sla_risk`), `threshold_config jsonb`, `is_active` |
| `ai_agents` | `id`, `workspace_id`, `name`, `persona_prompt`, `channel_scope text[]`, `status` (`draft`\|`active`\|`paused`), `model_provider`, `model_connection_id` nullable, `mcp_server_connection_id` nullable, `created_at` |
| `agent_knowledge_sources` | `id`, `agent_id`, `source_type` (`document`\|`url`\|`faq`\|`crm_data`), `title`, `content_ref`, `status` (`indexed`\|`processing`\|`stale`\|`error`), `last_synced_at` |
| `agent_knowledge_chunks` | `id`, `source_id`, `chunk_text`, `embedding vector`, `token_count` |
| `agent_actions` | `id`, `agent_id`, `action_type` (`create_deal`\|`update_field`\|`move_pipeline_stage`\|`send_message`\|`call_webhook`\|`schedule_task`), `config jsonb`, `requires_approval` |
| `agent_guardrails` | `id`, `agent_id`, `rule_type` (`topic_block`\|`max_discount`\|`escalate_on_sentiment`\|`compliance_phrase`), `config jsonb` |
| `agent_handoff_rules` | `id`, `agent_id`, `trigger_type` (`low_confidence`\|`negative_sentiment`\|`explicit_request`\|`sensitive_topic`\|`repeated_failure`), `action` (`assign_to_queue`\|`assign_to_agent`\|`notify_only`), `config jsonb` |
| `agent_conversation_sessions` | `id`, `conversation_id`, `agent_id`, `status` (`active`\|`handed_off`\|`resolved`), `confidence_avg`, `started_at`, `ended_at` |
| `agent_turns` | `id`, `session_id`, `role` (`user`\|`agent`\|`system`), `content`, `confidence_score`, `tools_called jsonb`, `cited_sources jsonb`, `created_at` |
| `agent_test_cases` | Conjunto de perguntas, respostas/ações esperadas e critérios de aprovação por agente. |
| `agent_test_runs` | Resultado de execução dos testes, taxa de acerto, versão avaliada e decisão de publicação. |
| `agent_conversation_packages` | `id`, `name`, `conversations_included`, `price` (BRL), `overage_price_per_conversation` (BRL), `is_active` |
| `workspace_agent_billing` | `id`, `workspace_id`, `package_id`, `billing_card_ref` tokenizado, `status` (`active`\|`paused`\|`cancelled`\|`suspended_limit_reached`), `current_period_start`, `current_period_end`, `conversations_used`, `renews_at` |
| `workspace_llm_connections` | `id`, `workspace_id`, `provider`, `credentials` criptografado, `status`, `created_at` |
| `mcp_server_connections` | `id`, `workspace_id`, `name`, `endpoint`, `credentials` criptografado, `status`, `created_at` |
| `seller_coaching_scorecards` | `id`, `workspace_id`, `user_id`, `conversation_id` nullable, `voice_call_id` nullable, `talk_ratio`, `discovery_questions_score`, `objection_handling_score`, `next_step_commitment_score`, `suggestions jsonb`, `generated_at` |

Um agente só pode responder após indexar ao menos uma fonte de conhecimento. Toda resposta armazena confiança; abaixo do limiar configurado, aplica a regra de handoff correspondente. Eventos de guardrail e ações do agente são auditados pelo Módulo F.

### 6.9 Dashboards, metas, comissões e marketing

| Tabela | Colunas principais |
|---|---|
| `goal_periods` | `id`, `workspace_id`, `period_start`, `period_end`, `scope` (`workspace`\|`team`\|`user`) |
| `goal_targets` | `id`, `goal_period_id`, `metric_type` (`revenue`\|`leads`\|`deals_won`\|`investment`), `entity_kind` (`workspace`\|`pipeline`\|`user`\|`custom_segment`), `entity_id`, `target_value` |
| `commission_tiers` | `id`, `workspace_id`, `tier_name`, `threshold_value` (BRL), `rate_config jsonb`, `position` |
| `commission_calculations` | `id`, `workspace_id`, `user_id`, `period_id`, `deal_id`, `tier_applied`, `commission_value` (BRL), `payment_method`, `calculated_at` |
| `ad_integrations` | `id`, `workspace_id`, `platform` (`meta_ads`\|`google_ads`), `account_id_external`, `credentials` criptografado, `status` (`active`\|`paused`\|`error`\|`disconnected`), `last_synced_at` |
| `ad_campaigns` | `id`, `ad_integration_id`, `external_campaign_id`, `name`, `status`, `objective` |
| `ad_campaign_metrics` | `id`, `ad_campaign_id`, `date`, `spend`, `impressions`, `clicks`, `ctr`, `cpc`, `cpm`, `conversions`, `cost_per_conversion` |
| `ad_attribution_links` | `id`, `deal_id` ou `contact_id`, `ad_campaign_id`, `click_id_external`, `attributed_at` |
| `social_organic_accounts` | `id`, `workspace_id`, `platform` (`instagram`\|`facebook`), `account_handle`, `credentials`, `status` |
| `social_organic_metrics` | `id`, `social_organic_account_id`, `date`, `followers`, `followers_delta`, `reach`, `interactions`, `profile_visits`, `link_clicks`, `posts_count` |
| `social_organic_posts` | `id`, `social_organic_account_id`, `posted_at`, `post_type`, `permalink`, `likes`, `comments`, `total_engagement` |

As métricas de campanhas CRM combinam `campaign_members`, `campaign_influence` e `ad_attribution_links` para atribuição de primeiro toque, último toque ou multi-toque entre mídia paga, canais orgânicos e ações offline. `campaigns.budget`, assim como `ad_campaign_metrics.spend`, é registrado em BRL; quando a plataforma de anúncios reporta gasto em outra moeda, a sincronização converte o valor para BRL antes de gravar. `target_value` em `goal_targets` está em BRL quando `metric_type` é `revenue` ou `investment`, e é uma contagem sem moeda quando `metric_type` é `leads` ou `deals_won`.

A faixa de comissão é definida pelo acumulado de negócios ganhos no período. Cada venda recebe a taxa da faixa vigente no momento em que a meta cumulativa foi alcançada, multiplicada pela taxa específica de forma de pagamento configurada em `rate_config`.

### 6.10 Governança, permissões, dados e billing administrativo

| Tabela | Colunas principais |
|---|---|
| `roles` | `id`, `workspace_id`, `name`, `is_system_role`, `base_permissions jsonb` |
| `permission_grants` | `id`, `role_id`, `resource_type`, `action`, `scope_type` (`all`\|`own`\|`team`\|`custom_segment`\|`field_level`) |
| `field_visibility_rules` | `id`, `workspace_id`, `field_definition_id`, `role_id`, `visibility` (`hidden`\|`read_only`\|`editable`) |
| `record_access_overrides` | `id`, `record_type`, `record_id`, `user_id_or_role_id`, `access_level` |
| `sso_configurations` | `id`, `workspace_id`, `provider` (`google`\|`microsoft`\|`saml_generic`), `config jsonb`, `is_enforced` |
| `audit_log_entries` | `id`, `workspace_id`, `actor_type` (`user`\|`ai_agent`\|`automation`\|`reseller_admin`\|`system`), `actor_id`, `action`, `resource_type`, `resource_id`, `before_state jsonb`, `after_state jsonb`, `ip_address`, `created_at` |
| `data_deletion_confirmations` | `id`, `workspace_id`, `resource_type`, `resource_count`, `requested_by`, `confirmation_token`, `confirmed_at`, `executed_at` |
| `data_imports` | `id`, `workspace_id`, `initiated_by`, `source_type` (`csv`\|`kommo_migration`\|`api`), `status` (`preview`\|`validating`\|`ready_to_commit`\|`committed`\|`rolled_back`\|`failed`), `preview_summary jsonb`, `row_count`, `error_count`, `created_at` |
| `data_import_rows` | `id`, `data_import_id`, `row_number`, `raw_data jsonb`, `resolved_entity_id`, `status` (`success`\|`error`\|`skipped`), `error_message` |
| `data_exports` | `id`, `workspace_id`, `requested_by`, `export_type` (`full`\|`incremental`\|`filtered`), `format` (`csv`\|`json`), `status`, `file_url`, `expires_at` |
| `workspace_backups` | `id`, `workspace_id`, `backup_type` (`automatic_daily`\|`manual`\|`pre_deletion`), `storage_ref`, `size_bytes`, `restorable_until`, `created_at` |
| `backup_restorations` | `id`, `backup_id`, `requested_by`, `restoration_scope` (`full`\|`selective`), `status`, `completed_at` |
| `subscription_cancellations` | `id`, `workspace_id`, `requested_by`, `reason_category`, `requested_at`, `effective_at`, `refund_amount` (BRL), `refund_status` (`n/a`\|`pending`\|`processed`), `data_export_completed` |
| `usage_meter_entries` | `id`, `workspace_id`, `metric` (`audio_transcription_minutes`\|...), `quantity`, `provider_cost`, `provider_currency`, `client_rate` (BRL), `occurred_at` |
| `consent_records` | `id`, `workspace_id`, `contact_id`, `channel`, `consent_type` (`marketing`\|`transacional`), `status` (`concedido`\|`revogado`\|`pendente`), `source`, `granted_at`, `revoked_at` |
| `communication_preferences` | `id`, `workspace_id`, `contact_id`, `channel`, `opted_in`, `updated_at` |
| `approval_rules` | `id`, `workspace_id`, `request_type` (`desconto`\|`publicacao_campanha`\|`exclusao_massa`), `approver_scope`, `approver_id`, `is_active` |
| `approval_requests` | `id`, `workspace_id`, `requester_id`, `approver_rule_id`, `request_type` (`desconto`\|`publicacao_campanha`\|`exclusao_massa`), `payload jsonb`, `status` (`pendente`\|`aprovado`\|`rejeitado`), `comment`, `resolved_at` |

`usage_meter_entries` registra o consumo de transcrição por minuto, com `provider_cost` mantido na `provider_currency` original do fornecedor (tipicamente US$) e `client_rate` já convertido para BRL, permitindo que o Módulo G aplique franquia, custo do provedor, margem e repasse transparente. Disparos em massa do Módulo C e campanhas do Módulo E consultam `consent_records` e `communication_preferences` antes de enviar; respostas humanas 1:1 não são bloqueadas. `approval_requests` é roteada pela `approval_rules` e mantém a decisão auditada pelo Módulo F.

### 6.11 Tarefas, atividades, agenda e calendário

| Tabela | Colunas principais |
|---|---|
| `task_types` | `id`, `workspace_id`, `code`, `name`, `default_description`, `category` (`ligação`\|`reunião`\|`visita`\|`e-mail`\|`follow_up`\|`administrativa`\|`entrega`\|`outro`), `default_duration_minutes`, `default_priority`, `color`, `requires_outcome`, `is_active` |
| `task_outcome_types` | `id`, `workspace_id`, `task_type_id`, `code`, `label`, `is_positive` |
| `task_checklist_templates` / `task_checklist_template_items` | `id`, `task_type_id`, `label`, `order` |
| `tasks` | `id`, `workspace_id`, `task_type_id`, `title`, `description`, `related_to_type` (`contact`\|`company`\|`deal`\|`case`\|`campaign`), `related_to_id`, `assigned_to`, `created_by`, `due_at`, `reminder_at`, `priority` (`baixa`\|`média`\|`alta`\|`urgente`), `status` (`pendente`\|`em_andamento`\|`concluída`\|`cancelada`), `completed_at`, `outcome_type_id`, `outcome_notes`, `source` (`manual`\|`automação`\|`agente_ia`\|`gatilho_de_etapa`\|`agendamento_publico`) |
| `task_comments` | `id`, `task_id`, `author_id`, `body`, `created_at` |
| `task_recurrences` | `id`, `task_type_id`, `recurrence_rule`, `related_to_type`, `related_to_id`, `assigned_to`, `next_generation_at` |
| `calendar_integrations` | `id`, `user_id`, `provider`, `external_calendar_id`, `sync_direction` (`bidirectional`\|`push_only`) |
| `calendar_event_links` | Liga `task_id` a `external_event_id` para sincronização sem duplicação. |
| `booking_pages` | `id`, `workspace_id`, `user_id` nullable, `team_id` nullable, `slug`, `title`, `default_duration_minutes`, `buffer_between_meetings`, `task_type_id` associado |
| `booking_slots` | `id`, `booking_page_id`, `day_of_week` ou `date`, `start_time`, `end_time`, `is_available` |

`task_types` é catálogo global por workspace, sem FK de pipeline ou departamento. Cada agendamento público em `booking_pages` e `booking_slots` cria uma `task` com `source = agendamento_publico` e pode criar ou vincular contato e negócio conforme a configuração da página.

O estado de atraso não é persistido: é calculado por `due_at < now()` e `status = pendente`. A área de Tarefas oferece visões de minhas tarefas, todas as tarefas, calendário, atrasadas, catálogo de tipos e tarefas por registro, com filtros salváveis para gestores.

### 6.12 Atendimento e casos

| Tabela | Colunas principais |
|---|---|
| `cases` | `id`, `workspace_id`, `contact_id`, `company_id`, `pipeline_id`, `origin_conversation_id`, `priority`, `status`, `sla_policy_id`, `first_response_due_at`, `resolution_due_at`, `resolved_at` |
| `case_queues` | `id`, `workspace_id`, `name`, `routing_rules jsonb`, `capacity_per_agent` |
| `knowledge_base_articles` | `id`, `workspace_id`, `title`, `body`, `category`, `status` (`draft`\|`published`), `language`, `search_vector` |
| `case_satisfaction_surveys` | `id`, `case_id`, `sent_at`, `csat_score`, `nps_score`, `comment` |

O quadro leve de projeto para atendimento reutiliza `tasks` com `related_to_type = case` e `related_to_id = case_id`; portanto, não há tabela paralela de projetos genéricos.

### 6.13 Central de Integrações e pagamentos orquestrados

| Tabela | Colunas principais |
|---|---|
| `integrations_catalog` | `id`, `category` (`pagamento`\|`site`\|`personalizacao`\|...), `provider_name`, `auth_type` (`oauth2`\|`api_key`), `logo_url` |
| `workspace_integrations` | `id`, `workspace_id`, `integration_id`, `status`, `credentials` criptografado, `connected_by`, `connected_at` |
| `integration_webhooks_log` | `id`, `workspace_integration_id`, `event_type`, `payload jsonb`, `processed_at`, `deal_id` |
| `payment_charges` | `id`, `deal_id`, `workspace_integration_id`, `amount` (BRL), `method` (`pix`\|`link`), `status`, `external_charge_id`, `paid_at` |

`payment_charges.amount` é sempre BRL: os gateways prioritários (Asaas, Mercado Pago, PagBank/PagSeguro, Efí, Iugu) operam no mercado brasileiro e cobram o cliente final em BRL via Pix ou link.

O comércio conversacional reutiliza `products`, `deal_line_items`, `payment_charges` e os conectores de pagamento: cards enviados no WhatsApp selecionam itens, criam o negócio e iniciam a cobrança sem introduzir tabelas específicas.

### 6.14 Estruturas condicionadas a decisões pendentes

Não há estruturas de dados condicionadas às quatro decisões comerciais ainda pendentes. As estruturas confirmadas de campanhas, consentimento, identidade e aprovações já integram as subseções correspondentes do modelo de dados.

## 7. Modelo de Precificação

### 7.1 Estrutura comercial

O modelo comercial opera por workspace, com assinatura mensal e custos de uso visíveis. A plataforma evita dependência exclusiva de cobrança por assento e não exige contrato mínimo de seis meses. A composição exibida ao cliente deve separar:

1. assinatura base do workspace;
2. canais e operação de atendimento incluídos conforme plano;
3. consumo de mensagens de marketing e custos do BSP, quando aplicáveis;
4. pacote separado de conversas de agentes D2;
5. minutos de transcrição de áudio incluídos por plano e excedentes medidos;
6. integrações ou serviços de terceiros que possuam custo próprio.

O cliente vê uma calculadora de custo total antes da contratação e durante a operação. O catálogo comercial — valores, franquias e preço unitário de excedentes permitidos — deve ser parametrizável, não codificado na interface. Toda cobrança ao cliente final — assinatura, pacotes de agentes D2, excedente de transcrição e repasse de mensageria — é feita em Real brasileiro (BRL), independentemente da moeda em que o custo do provedor upstream (Meta, Twilio) é cotado.

### 7.2 WhatsApp Business: lógica de custo

A Meta cobra mensagens conforme categoria, e a cobrança depende da janela de atendimento e do tipo de template. A regra de precificação deve expor essas categorias de modo transparente. [WhatsApp Business Platform](https://whatsappbusiness.com/products/platform-pricing/) As tarifas de referência da Meta e da Twilio são cotadas em dólar americano (US$); a calculadora converte esse custo para BRL pela taxa de câmbio vigente antes de exibir o valor ou repassá-lo ao cliente final, e a fatura do cliente é sempre emitida em BRL.

| Categoria | Tarifa Meta de referência no Brasil | Aplicação |
|---|---:|---|
| Serviço | Gratuita, ilimitada | Resposta na janela de 24 horas aberta pelo contato. |
| Utilidade | US$ 0,0068 | Template proativo fora da janela; gratuito se enviado dentro da janela de serviço aberta. |
| Autenticação | US$ 0,0068 | OTP e verificações. |
| Marketing | US$ 0,0625 | Template promocional e campanha em massa. |

As tarifas de referência, a janela de 24 horas e o benefício de janela de 72 horas para anúncios clique-para-WhatsApp devem ser refletidos na calculadora e atualizados conforme a tabela vigente da Meta. [Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)

O uso via BSP adiciona custo do provedor. A Twilio foi definida como BSP inicial por seu modelo pay-as-you-go, sem contrato mínimo, documentação e suporte maduros; sua referência publicada é US$ 0,005 por mensagem enviada ou recebida, além da tarifa aplicável da Meta. [Twilio WhatsApp Pricing](https://www.twilio.com/en-us/whatsapp/pricing)

### 7.3 Política de repasse

- Atendimento normal dentro da janela de serviço permanece incluído na experiência comercial do plano, com o custo operacional do BSP considerado na composição do preço da plataforma.
- Marketing/broadcast é consumo mensurável e deve aparecer separadamente na calculadora e na fatura, como pacote de créditos ou repasse transparente.
- Utilidade e autenticação devem ser exibidas separadamente para que o cliente compreenda o uso fora da janela de atendimento.
- A transcrição de áudio está sempre disponível no cockpit: cada plano inclui uma franquia mensal de minutos; o excedente é cobrado pelo custo do provedor acrescido de margem, com consumo, custo e valor final visíveis ao cliente.
- A arquitetura deve preservar a possibilidade de migrar da Twilio a uma integração direta com a Meta quando escala e economia justificarem a mudança, sem perda de WABA, número, templates aprovados ou dados internos de conversa. [Meta — migração de WABA](https://developers.facebook.com/docs/whatsapp/solution-providers/support/migrating-wabas-among-solution-partners-via-embedded-signup/)

### 7.4 IA e cobrança de agentes

D1 é incluído na assinatura principal. D2 é vendido separadamente por pacote de sessões de conversa. Uma sessão é uma interação contínua entre agente e contato; sua reabertura após 24 horas de inatividade conta como nova conversa. O sistema pausa o agente ao atingir a franquia, em vez de cobrar excedente automaticamente. Upgrade de pacote no meio do período usa cálculo pro-rata.

## 8. Governança e Permissões

### 8.1 Papéis padrão

| Papel | Escopo padrão |
|---|---|
| **Owner** | Controle total do workspace, incluindo billing e exclusão do workspace. |
| **Admin** | Administração integral de operação e configuração, exceto billing e exclusão do workspace. |
| **Gestor** | Visualiza equipe e relatórios sob seu escopo, sem acesso automático a outras equipes. |
| **Atendente** | Opera seus próprios registros, tarefas e conversas segundo o escopo concedido. |
| **Marketing/Campanhas** | Acessa performance de campanha, origem de lead e investimento de mídia, sem editar valores de negócios ou mover pipeline sem permissão explícita. |
| **Somente leitura** | Visualiza os recursos e relatórios permitidos, sem edição. |

Papéis são customizáveis. Perfis como SDR e Closer são criados clonando Atendente e aplicando escopo por equipe, segmento ou etapa de pipeline, evitando proliferação de papéis fixos.

### 8.2 Regras de autorização

- `permission_grants` define ação e escopo por recurso.
- `field_visibility_rules` impede que visibilidade de registro implique visibilidade de todos os seus campos.
- `record_access_overrides` atende exceções de acesso a registros sensíveis.
- Permissões são aplicadas na interface, na API e no banco por RLS.
- O AI Analyst, agentes, automações e reseller admins obedecem aos mesmos limites de visibilidade e deixam evidência no `audit_log_entries`.

### 8.3 Auditoria, recuperação e exclusão

- Todo create, update, delete, export, login, alteração de permissão, cobrança e ação de suporte gera auditoria com ator, estado anterior, estado posterior, IP e data.
- Importação só grava após prévia e confirmação; falhas são rastreadas por linha.
- Backup é automático diário e restaurável; ações destrutivas de volume criam backup prévio obrigatório.
- Exclusão em massa exige token de confirmação, contagem de registros e registro auditável.
- Cancelamento preserva acesso até o fim do período já pago e oferece exportação completa antes da confirmação.

### 8.4 Confiabilidade operacional

A plataforma mantém status público por componente, histórico de incidentes, deploys sem downtime na arquitetura Vercel/Railway/Supabase, monitoramento de canal e testes recorrentes de regressão para automações em produção. Alterações de automação, pipeline e agente passam por ambiente de rascunho/teste antes de afetarem a operação.

## 9. Central de Integrações

### 9.1 Operação e segurança

A Central de Integrações fornece catálogo global administrado pela VirtruvIA e conexões por workspace. Cada card de integração apresenta status, última sincronização, escopos concedidos e ações de conectar, reconectar ou revogar. A conexão é self-service por OAuth2 ou chave de API; credenciais são criptografadas e todos os webhooks ficam registrados.

### 9.2 Pagamento no chat: fluxo completo

O CRM não processa o pagamento diretamente. Ele aciona o gateway que o cliente já utiliza, envia a cobrança e reage a confirmações por webhook.

1. O atendente ou agente D2 abre a conversa no cockpit do Módulo B e marca o negócio como aguardando pagamento.
2. O CRM chama a API do gateway conectado — por exemplo Asaas, Efí, Mercado Pago ou PagBank — para criar uma cobrança Pix ou link, vinculada ao `deal_id`.
3. A cobrança é registrada em `payment_charges` e enviada dentro da conversa como texto com link e/ou QR code.
4. O gateway envia confirmação ao webhook da integração.
5. O Módulo I registra o evento em `integration_webhooks_log`, atualiza `payment_charges` e associa o evento ao negócio.
6. O Módulo C executa a automação correspondente: move etapa do pipeline, registra receita e envia confirmação automática ao contato.
7. O Módulo E reflete a receita confirmada no funil e nos dashboards.

Esse desenho mantém no gateway a responsabilidade por antifraude, chargeback, conciliação financeira e custódia de recursos; a plataforma registra e orquestra o evento operacional. [Meta Payments API](https://developers.facebook.com/docs/whatsapp/cloud-api/payments-api/payments-br)

### 9.3 Comércio conversacional

O atendente ou agente D2 envia cards do catálogo de produtos no WhatsApp. A seleção do lead cria ou atualiza o negócio com `deal_line_items`, e a Central de Integrações gera o link de cobrança por meio do gateway conectado. O fluxo reutiliza o catálogo, itens de negócio e pagamento orquestrado; não cria tabelas específicas.

### 9.4 Integrações de sites e atribuição

Sites e landing pages conectados enviam formulários e eventos ao CRM. A integração cria ou atualiza o contato conforme regras de identidade, registra origem e campanha quando disponível, e permite que o Módulo E atribua a jornada de marketing ao negócio e à receita.

### 9.5 Personalização/CRO

A categoria de Personalização/CRO entra no lançamento com framework genérico por API key ou OAuth. Ferramentas de experimentação e personalização recebem dados autorizados do CRM sem acoplamento a fornecedor específico, preservando escopos visíveis, reconexão e auditoria de webhooks.

### 9.6 Evolução por categorias

A mesma infraestrutura de catálogo, credenciais e webhooks será reutilizada para ERP, assinatura eletrônica e enriquecimento de dados quando essas categorias forem priorizadas. O produto não constrói ERP, CPQ fiscal, PSP próprio ou assinatura eletrônica própria nesta fase; conecta provedores especializados.

## 10. Roadmap de Construção

### Fase 0 — Fundação transversal

**Responsável principal: Claude.**

1. Criar `workspaces`, `workspace_members`, `reseller_admins`, autenticação e RLS base.
2. Criar instrumentação inicial de `audit_log_entries` e o motor básico de papéis/permissões.
3. Provisionar Supabase Postgres, `pgvector`, Storage, Vercel e serviço Railway.
4. Definir abstrações de fila, webhook, idempotência, criptografia de credenciais e observabilidade.
5. Preparar billing recorrente por workspace, medição de minutos de transcrição e as estruturas administrativas, sem congelar valores de plano.
6. Entregar base de PWA com fila offline para tarefas, notas e check-ins de campo, sincronizando ao reconectar.

### Fase 1 — Núcleo CRM e dados configuráveis

**Responsáveis: Claude ou Manus; primeira frente prioritária definida.**

1. Construir motor de `field_definitions` e `field_schema_versions`.
2. Construir contatos, empresas, negócios e relações N:N.
3. Construir objetos customizados e relações genéricas.
4. Construir pipelines, estágios, itens paralelos e trigger de histórico.
5. Entregar UI de arrasta-e-solta e formulários de campos configuráveis.
6. Incluir a base de tarefas estruturadas e sua associação a qualquer registro, com catálogo global de `task_types` por workspace.
7. Construir página pública de agendamento, disponibilidade, buffers e criação de tarefas, contatos ou negócios a partir da reserva.
8. Construir campanhas CRM, membros, influência e regras de resolução de identidade com fila revisável de merge por telefone, e-mail e CPF/CNPJ.
9. Adicionar o tipo `ai_generated` aos campos customizados e sua configuração de prompt/template.
10. Construir catálogo de produtos, price books e itens de negócio, com cálculo automático de `line_total` e de `deals.value`.
11. Exibir produtos, quantidade, preço e valor total do negócio no cartão do negócio e no cockpit do Módulo B.

### Fase 2 — Inbox omnichannel, cockpit e voz

**Responsável principal: Manus; revisão técnica: Claude.**

1. Criar `channel_accounts`, conversas, mensagens, status de entrega e RLS.
2. Implantar serviço Railway com webhooks, normalização, fila de saída, retry, WebSocket e Supabase Realtime.
3. Integrar WhatsApp via Twilio, com WABA do cliente final e onboarding guiado.
4. Adicionar Instagram, Messenger, Telegram, e-mail, webchat e SMS.
5. Construir cockpit de três colunas, notas, reações, áudio/transcrição sempre disponível, medição por minuto e resumos automáticos globais ao encerrar.
6. Integrar Twilio Voice, números por agente, gravação, transcrição, URA, filas e callbacks.

### Fase 3 — Automação e agentes de IA

**Automação: Manus ou ChatGPT, conforme responsável pelo frontend. IA/orquestração: Claude. Conteúdo de treinamento/personas: ChatGPT.**

1. Entregar versões, testes, logs, rollback e executor persistente do Módulo C.
2. Expor builder guiado por etapas e nó HTTP genérico.
3. Criar copiloto D1, incluindo revisão de texto e insights configuráveis.
4. Implantar ingestão RAG, agentes D2, handoff, guardrails, preenchimento de campos `ai_generated` e ações com aprovação.
5. Conectar BYO-LLM e servidores MCP por workspace, separando esse consumo da franquia D2.
6. Implementar Consent Ledger como trava de comunicação em massa e aprovações genéricas roteadas por regra.
7. Adicionar coaching de vendedor por IA para chamadas e conversas, com scorecards e sugestões por atendimento.
8. Adicionar testes obrigatórios de agentes, citações de fonte e billing por sessões de conversa.

### Fase 4 — BI, produtividade e governança completa

**Responsável: frente de dashboards/portal/governança; reutiliza fundação de dados e permissões.**

1. Construir métricas operacionais, dashboards, metas e comissões.
2. Sincronizar Meta Ads, Google Ads e métricas orgânicas por jobs periódicos.
3. Integrar tarefas a calendário, relatórios, resumos e metas de atividade, incluindo as reservas de páginas públicas de agendamento.
4. Exibir atribuição de campanhas CRM e dashboards de gestor para coaching de vendedor por IA.
5. Completar SSO, importação com prévia/rollback, exportação, backup, restauração e cancelamento self-service.
6. Entregar página de status, monitoramento de saúde e testes de regressão de automações.

### Fase 5 — Atendimento estruturado e integrações

1. Entregar Módulo H: casos, filas, SLA, base de conhecimento, pesquisas de satisfação e quadro leve de tarefas de projeto vinculado a casos.
2. Entregar framework do Módulo I: catálogo, OAuth/chave de API, criptografia e logs de webhook.
3. Implementar categoria de Pagamentos e fluxo de cobrança no chat.
4. Implementar comércio conversacional com cards de catálogo no WhatsApp, criação de itens de negócio e link de cobrança pelo gateway conectado.
5. Implementar categoria de Sites/Landing Pages e atribuição de origem.
6. Implementar categoria de Personalização/CRO com framework genérico por API key ou OAuth.
7. Priorizar gateways e métodos de cobrança iniciais conforme as decisões pendentes e a demanda comercial.

## 11. Decisões Pendentes

| Tema | Decisão necessária | Contexto para decisão |
|---|---|---|
| Precificação base | Estabelecer valores dos planos, franquias por workspace, inclusão de usuários/canais e política final de repasse do custo Twilio/Meta. | A estrutura mensal, por workspace e com transparência de uso está definida; faltam valores e limites comerciais parametrizados. |
| Central de Integrações — gateways iniciais | Selecionar quantidade e provedores prioritários no lançamento. | O framework é genérico; os candidatos explícitos incluem Asaas, Mercado Pago, PagBank/PagSeguro, Efí e Iugu. |
| Central de Integrações — métodos de cobrança | Escolher a cobertura de lançamento: somente Pix/link ou também cartão recorrente. | O schema atual cobre `pix` e `link`; cartão recorrente se relaciona ao tema de Pix Automático/recorrência ainda não incorporado ao escopo inicial. |
| Gaps de versão posterior | Priorizar ERP, assinatura eletrônica, enriquecimento de dados e Pix Automático/recorrência. | Esses itens permanecem fora do build inicial e usam a mesma base de integração quando forem priorizados. |
