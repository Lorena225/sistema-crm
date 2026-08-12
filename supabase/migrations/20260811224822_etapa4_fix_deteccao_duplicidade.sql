-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 4: corrige colisao de nomes em
-- detect_duplicate_contacts.
--
-- Defeito encontrado pelo teste da etapa: a funcao usava o alias `r` para a
-- tabela de regras e tambem declarava uma variavel de registro chamada `r`
-- para o laco. Em PL/pgSQL a variavel vence o alias, entao `r.workspace_id`
-- era lido como campo de um registro ainda nao atribuido e a funcao quebrava
-- em tempo de execucao — nao na criacao.
--
-- Nomes de variavel passam a ter prefixo v_, e os aliases de tabela deixam
-- de usar letras isoladas.
-- =====================================================================

create or replace function public.detect_duplicate_contacts(p_workspace_id uuid, p_contact_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contato public.contacts;
  v_regra public.identity_resolution_rules;
  v_doc text;
  v_inseridos integer := 0;
  v_dup record;
begin
  if not app.is_workspace_member(p_workspace_id) then
    raise exception 'sem acesso a este workspace' using errcode = '42501';
  end if;

  select * into v_contato
  from public.contacts ct
  where ct.id = p_contact_id and ct.workspace_id = p_workspace_id;

  if not found then
    raise exception 'contato nao encontrado' using errcode = 'P0002';
  end if;

  select * into v_regra
  from public.identity_resolution_rules irr
  where irr.workspace_id = p_workspace_id
  limit 1;

  -- CPF/CNPJ nao e coluna fixa de contacts: vive em custom_fields.
  v_doc := coalesce(
    v_contato.custom_fields ->> 'cpf',
    v_contato.custom_fields ->> 'cnpj',
    v_contato.custom_fields ->> 'documento'
  );

  for v_dup in
    select outro.id,
           -- Documento identifica melhor que e-mail, que identifica melhor
           -- que telefone: telefone e reaproveitado, e-mail e compartilhado.
           case
             when v_doc is not null
                  and coalesce(outro.custom_fields->>'cpf', outro.custom_fields->>'cnpj', outro.custom_fields->>'documento') = v_doc
               then 0.98
             when v_contato.email is not null and lower(outro.email) = lower(v_contato.email)
               then 0.90
             when v_contato.phone is not null
                  and regexp_replace(coalesce(outro.phone, ''), '[^0-9]', '', 'g')
                      = regexp_replace(v_contato.phone, '[^0-9]', '', 'g')
                  and length(regexp_replace(v_contato.phone, '[^0-9]', '', 'g')) >= 8
               then 0.75
             else 0
           end as score
    from public.contacts outro
    where outro.workspace_id = p_workspace_id
      and outro.id <> p_contact_id
  loop
    if v_dup.score > 0 then
      insert into public.identity_merge_queue
        (workspace_id, candidate_contact_id, existing_contact_id, confidence_score, status)
      values (
        p_workspace_id, p_contact_id, v_dup.id, v_dup.score,
        case
          when v_regra.auto_merge_threshold is not null and v_dup.score >= v_regra.auto_merge_threshold
            then 'auto_merged'::public.merge_status
          else 'pending_review'::public.merge_status
        end
      )
      on conflict (candidate_contact_id, existing_contact_id) do nothing;

      v_inseridos := v_inseridos + 1;
    end if;
  end loop;

  return v_inseridos;
end;
$$;
