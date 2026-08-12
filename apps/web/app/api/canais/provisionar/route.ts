import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { cifrar } from '@/lib/crypto/credenciais';

export const dynamic = 'force-dynamic';

/**
 * POST /api/canais/provisionar — conecta um canal.
 *
 * Para whatsapp, cria automaticamente uma subconta Twilio
 * (POST /2010-04-01/Accounts.json) com a conta master e grava o Account SID e
 * o Auth Token da subconta cifrados em channel_accounts.credentials.
 *
 * Por que a rota existe em vez de a tela gravar direto:
 *  - as credenciais master vivem só no servidor;
 *  - `credentials` não tem GRANT de escrita para `authenticated` (Etapa 5), então
 *    a gravação precisa de service role;
 *  - o texto plano do token nunca sai desta função.
 *
 * A autorização não é dispensada: antes de usar service role, a rota confirma
 * pela RLS que quem chama é membro ativo do workspace.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'nao_autenticado' }, { status: 401 });

  let corpo: {
    workspaceId?: string; channelType?: string;
    displayName?: string; externalAccountId?: string;
  };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: 'payload_invalido' }, { status: 400 });
  }

  const { workspaceId, channelType, displayName, externalAccountId } = corpo;
  if (!workspaceId || !channelType || !displayName) {
    return NextResponse.json({ erro: 'campos_obrigatorios_ausentes' }, { status: 400 });
  }

  // Autorização sob RLS: se a política não deixar ver o vínculo, não há acesso.
  const { data: vinculo } = await supabase
    .from('workspace_members')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!vinculo || vinculo.status !== 'active') {
    return NextResponse.json({ erro: 'sem_autorizacao_no_workspace' }, { status: 403 });
  }

  const admin = createAdminClient();
  let credenciaisCifradas: string | null = null;
  let contaTwilio: string | null = null;

  if (channelType === 'whatsapp') {
    const masterSid = process.env.TWILIO_MASTER_ACCOUNT_SID;
    const masterToken = process.env.TWILIO_MASTER_AUTH_TOKEN;

    if (!masterSid || !masterToken) {
      return NextResponse.json({
        erro: 'twilio_nao_configurado',
        detalhe: 'Defina TWILIO_MASTER_ACCOUNT_SID e TWILIO_MASTER_AUTH_TOKEN no ambiente do servidor.',
      }, { status: 503 });
    }

    const resposta = await fetch('https://api.twilio.com/2010-04-01/Accounts.json', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${masterSid}:${masterToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ FriendlyName: `${displayName} · ${workspaceId.slice(0, 8)}` }).toString(),
    });

    if (!resposta.ok) {
      const detalhe = await resposta.text().catch(() => '');
      return NextResponse.json({
        erro: 'falha_ao_criar_subconta',
        detalhe: detalhe.slice(0, 200),
      }, { status: 502 });
    }

    const subconta = await resposta.json();
    contaTwilio = subconta.sid;

    // O texto plano do token existe apenas nesta linha.
    credenciaisCifradas = cifrar(JSON.stringify({
      account_sid: subconta.sid,
      auth_token: subconta.auth_token,
      numero_origem: externalAccountId ?? null,
      criado_em: new Date().toISOString(),
    }));
  }

  const { data: conta, error } = await admin
    .from('channel_accounts')
    .insert({
      workspace_id: workspaceId,
      channel_type: channelType,
      external_account_id: externalAccountId || null,
      display_name: displayName,
      credentials: credenciaisCifradas,
      status: credenciaisCifradas || channelType !== 'whatsapp' ? 'active' : 'disconnected',
    })
    .select('id, channel_type, display_name, status')
    .single();

  if (error) {
    return NextResponse.json({ erro: 'falha_ao_gravar', detalhe: error.message }, { status: 500 });
  }

  // Auditoria da conexao. Diferente da rota administrativa, aqui a falha da
  // trilha nao derruba a resposta: o canal ja foi criado, e devolver erro
  // faria o operador tentar de novo e criar uma segunda subconta Twilio.
  const { error: erroAuditoria } = await admin.rpc('log_admin_action', {
    p_workspace_id: workspaceId,
    p_action: 'channel_account.provisioned',
    p_resource_type: 'channel_accounts',
    p_actor_id: user.id,
    p_resource_id: conta.id,
    // Registra que houve subconta, e o SID (identificador público). Nunca o token.
    p_after_state: { channel_type: channelType, twilio_subaccount_sid: contaTwilio },
  });

  if (erroAuditoria) {
    console.warn(JSON.stringify({
      level: 'warn', msg: 'canal criado sem trilha de auditoria', conta_id: conta.id,
    }));
  }

  return NextResponse.json({ conta, subcontaCriada: Boolean(contaTwilio) });
}
