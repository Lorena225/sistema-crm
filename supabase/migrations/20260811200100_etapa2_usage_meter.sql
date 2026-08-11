-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 2: medicao de consumo (esqueleto de billing)
--
-- Esta migration registra CONSUMO, nao preco. Nenhum valor comercial —
-- plano, franquia, tier, margem, gateway ou metodo de cobranca — aparece
-- aqui ou em qualquer lugar do codigo. Ver ADR-0011.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Metrica
-- ---------------------------------------------------------------------
-- Enum com uma unica metrica hoje. Novas metricas entram por
-- `alter type ... add value` na etapa que as introduzir; o enum evita que
-- cada modulo invente sua propria grafia para a mesma coisa.
create type public.usage_metric as enum ('audio_transcription_minutes');

-- ---------------------------------------------------------------------
-- 2. Tabela
-- ---------------------------------------------------------------------
create table public.usage_meter_entries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  metric            public.usage_metric not null,
  quantity          numeric(18, 6) not null check (quantity >= 0),
  provider_cost     numeric(18, 6) check (provider_cost >= 0),
  provider_currency char(3) not null default 'BRL' check (provider_currency ~ '^[A-Z]{3}$'),
  client_rate       numeric(18, 6) check (client_rate >= 0),
  occurred_at       timestamptz not null default now()
);

comment on table public.usage_meter_entries is 'Medicao de consumo variavel por workspace. Registra quanto foi consumido e quanto custou ao fornecedor; nao define preco de venda.';
comment on column public.usage_meter_entries.quantity is 'Quantidade na unidade da metrica (ex.: minutos de transcricao).';
comment on column public.usage_meter_entries.provider_cost is 'Custo do fornecedor, na moeda original dele (provider_currency). Nulo quando o custo ainda nao foi apurado.';
comment on column public.usage_meter_entries.provider_currency is 'Moeda do provider_cost, ISO 4217. Default BRL, que e a moeda base da plataforma; fornecedores internacionais gravam USD, EUR etc.';
comment on column public.usage_meter_entries.client_rate is 'Valor ja convertido para BRL, sempre. Nao ha coluna de moeda porque nao ha outra possibilidade: a assinatura e cobrada em BRL.';
comment on column public.usage_meter_entries.occurred_at is 'Quando o consumo aconteceu, nao quando foi registrado. Fechamento de periodo usa esta coluna.';

-- ---------------------------------------------------------------------
-- 3. Indices
-- ---------------------------------------------------------------------
create index usage_meter_entries_workspace_id_idx on public.usage_meter_entries (workspace_id);
-- Consulta dominante: somar uma metrica de um workspace dentro de um periodo.
create index usage_meter_entries_workspace_metric_occurred_idx
  on public.usage_meter_entries (workspace_id, metric, occurred_at desc);

-- ---------------------------------------------------------------------
-- 4. RLS e grants
-- ---------------------------------------------------------------------
alter table public.usage_meter_entries enable row level security;
alter table public.usage_meter_entries force row level security;

-- Membro ativo enxerga o proprio consumo. Escrita nao tem politica: quem
-- mede e o sistema (worker, integracoes), via service_role — consumo nao e
-- declarado pelo cliente.
create policy usage_meter_entries_select_member
  on public.usage_meter_entries for select to authenticated
  using (app.is_workspace_member(workspace_id));

revoke all on table public.usage_meter_entries from anon, authenticated;
grant select on table public.usage_meter_entries to authenticated;
