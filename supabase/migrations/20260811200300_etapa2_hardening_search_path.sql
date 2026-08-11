-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 2: fixa search_path das funcoes restantes
--
-- Funcao sem `search_path` fixo resolve nomes pela configuracao de quem
-- chama. Em uma funcao que roda com privilegio elevado, isso permite que um
-- schema colocado a frente sequestre a resolucao de um nome. Aqui as duas
-- funcoes sao inofensivas por conteudo, mas a regra vale sem excecao: nao
-- existe funcao "pequena demais" para o endurecimento.
-- =====================================================================

create or replace function app.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_entries e append-only: % nao e permitido', tg_op
    using errcode = '42501';
end;
$$;

create or replace function app.current_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text;
begin
  v_raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;
  return split_part(v_raw, ',', 1)::inet;
exception when others then
  return null;
end;
$$;
