-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 3: corrige a captura de estado na auditoria
--
-- Defeito encontrado pelo teste da etapa: app.audit_registro_crm usava
-- `if old is not null` / `if new is not null` para descobrir a operacao.
--
-- Em PL/pgSQL isso nao faz o que parece. Para um registro composto,
-- `IS NOT NULL` so e verdadeiro quando TODOS os campos sao nao-nulos. Um
-- contato sem telefone e sem responsavel reprovava no teste, e a trilha
-- gravava before_state e after_state nulos — auditoria sem estado, que e
-- quase o mesmo que nenhuma auditoria.
--
-- A correcao usa tg_op, que diz exatamente qual operacao esta em curso.
-- =====================================================================

create or replace function app.audit_registro_crm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := null;
  v_after  jsonb := null;
  v_id uuid := coalesce(new.id, old.id);
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  -- Auditoria guarda as CHAVES preenchidas em custom_fields, nunca os
  -- valores: o conteudo pode estar classificado como pii ou financial em
  -- field_definitions. Fica registrado que o campo mudou, sem copiar o dado.
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old) - 'custom_fields'
             || jsonb_build_object('custom_fields_keys',
                  coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(old.custom_fields) k), '[]'::jsonb));
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new) - 'custom_fields'
            || jsonb_build_object('custom_fields_keys',
                 coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(new.custom_fields) k), '[]'::jsonb));
  end if;

  perform app.record_audit(v_ws, tg_table_name || '.' || lower(tg_op), tg_table_name, v_id, v_before, v_after);

  return coalesce(new, old);
end;
$$;
