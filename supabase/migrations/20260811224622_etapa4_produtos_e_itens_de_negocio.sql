-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 4 (3/3): catalogo comercial e itens de
-- negocio. BRL e o padrao em produto, price book e item.
-- =====================================================================

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  sku           text,
  default_price numeric(18, 2) check (default_price >= 0),
  currency      char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  is_active     boolean not null default true
);

create unique index products_sku_uniq on public.products (workspace_id, lower(sku)) where sku is not null;
create index products_workspace_idx on public.products (workspace_id, is_active);

create table public.price_books (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  currency     char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  is_default   boolean not null default false
);

-- Um unico price book padrao por workspace.
create unique index price_books_default_uniq on public.price_books (workspace_id) where is_default;
create index price_books_workspace_idx on public.price_books (workspace_id);

create table public.price_book_entries (
  id            uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references public.price_books (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  unit_price    numeric(18, 2) not null check (unit_price >= 0),
  constraint price_book_entries_uniq unique (price_book_id, product_id)
);

create index price_book_entries_produto_idx on public.price_book_entries (product_id);

create table public.deal_line_items (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.deals (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete restrict,
  price_book_id    uuid references public.price_books (id) on delete set null,
  quantity         numeric(18, 4) not null default 1 check (quantity > 0),
  unit_price       numeric(18, 2) not null check (unit_price >= 0),
  discount_percent numeric(6, 4) not null default 0 check (discount_percent >= 0 and discount_percent <= 1),
  -- O escopo define line_total = quantity * unit_price * (1 - discount_percent).
  -- Coluna gerada: a formula fica no schema, e nao em quatro lugares do codigo.
  line_total       numeric(18, 2)
    generated always as (round(quantity * unit_price * (1 - discount_percent), 2)) stored
);

comment on column public.deal_line_items.discount_percent is 'Fracao de 0 a 1, seguindo a formula literal do escopo: 0.1 e dez por cento. A interface recebe porcentagem e converte.';

create index deal_line_items_deal_idx on public.deal_line_items (deal_id);
create index deal_line_items_produto_idx on public.deal_line_items (product_id);
create index deal_line_items_price_book_idx on public.deal_line_items (price_book_id) where price_book_id is not null;

-- Preco: entrada especifica do price book primeiro; na falta dela, o preco
-- padrao do produto. So preenche quando unit_price nao veio informado.
create or replace function app.preencher_preco_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preco numeric(18, 2);
begin
  if new.unit_price is not null then
    return new;
  end if;

  if new.price_book_id is not null then
    select e.unit_price into v_preco
    from public.price_book_entries e
    where e.price_book_id = new.price_book_id and e.product_id = new.product_id;
  end if;

  if v_preco is null then
    select p.default_price into v_preco from public.products p where p.id = new.product_id;
  end if;

  if v_preco is null then
    raise exception 'produto sem preco de entrada e sem preco padrao' using errcode = '23502';
  end if;

  new.unit_price := v_preco;
  return new;
end;
$$;

create trigger deal_line_items_preco
  before insert on public.deal_line_items
  for each row execute function app.preencher_preco_item();

-- Recalculo de deals.value a partir dos itens.
create or replace function app.recalcular_valor_negocio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal uuid := coalesce(new.deal_id, old.deal_id);
  v_total numeric(18, 2);
  v_itens integer;
begin
  select count(*), coalesce(sum(line_total), 0) into v_itens, v_total
  from public.deal_line_items where deal_id = v_deal;

  -- Sem itens, deals.value volta a ser campo manual: zerar apagaria um valor
  -- que alguem digitou, o que e pior do que manter o ultimo calculado.
  if v_itens > 0 then
    update public.deals set value = v_total where id = v_deal;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger deal_line_items_recalculo
  after insert or update or delete on public.deal_line_items
  for each row execute function app.recalcular_valor_negocio();

-- Enquanto houver itens, o valor do negocio e derivado. Sem esta trava, uma
-- edicao manual sobreviveria ate o proximo item mudar, e ninguem entenderia
-- por que o numero "voltou sozinho".
create or replace function app.proteger_valor_com_itens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric(18, 2);
  v_itens integer;
begin
  select count(*), coalesce(sum(line_total), 0) into v_itens, v_total
  from public.deal_line_items where deal_id = new.id;

  if v_itens > 0 and new.value is distinct from v_total then
    new.value := v_total;
  end if;

  return new;
end;
$$;

create trigger deals_valor_derivado
  before update on public.deals
  for each row execute function app.proteger_valor_com_itens();

alter table public.products           enable row level security;
alter table public.products           force row level security;
alter table public.price_books        enable row level security;
alter table public.price_books        force row level security;
alter table public.price_book_entries enable row level security;
alter table public.price_book_entries force row level security;
alter table public.deal_line_items    enable row level security;
alter table public.deal_line_items    force row level security;

create policy products_tenant on public.products for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy price_books_tenant on public.price_books for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

-- Filhas: isolamento derivado do pai, e o with check garante que produto e
-- tabela de preco vivem no mesmo workspace (ADR-0013).
create policy price_book_entries_tenant on public.price_book_entries for all to authenticated
  using (exists (select 1 from public.price_books b where b.id = price_book_id and app.is_workspace_member(b.workspace_id)))
  with check (exists (
    select 1 from public.price_books b
    join public.products p on p.workspace_id = b.workspace_id
    where b.id = price_book_id and p.id = product_id and app.is_workspace_member(b.workspace_id)));

create policy deal_line_items_tenant on public.deal_line_items for all to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id and app.is_workspace_member(d.workspace_id)))
  with check (exists (
    select 1 from public.deals d
    join public.products p on p.workspace_id = d.workspace_id
    where d.id = deal_id and p.id = product_id and app.is_workspace_member(d.workspace_id)));

revoke all on table public.products, public.price_books,
  public.price_book_entries, public.deal_line_items from anon, authenticated;

grant select, insert, update, delete on table
  public.products, public.price_books, public.price_book_entries,
  public.deal_line_items to authenticated;
