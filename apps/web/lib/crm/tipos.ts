/**
 * Tipos e utilitarios do nucleo CRM.
 *
 * A validacao de verdade e a do banco (app.validate_custom_fields). O que
 * existe aqui e conversao de formulario para jsonb e uma checagem previa
 * para dar erro imediato ao operador, em vez de esperar o round-trip.
 * Duplicacao consciente: o banco continua sendo a autoridade.
 */

export type EntityKind = 'contact' | 'company' | 'deal' | 'object_type';

export type FieldType =
  | 'text' | 'number' | 'currency' | 'date' | 'boolean'
  | 'select' | 'multiselect' | 'relation' | 'email' | 'phone' | 'ai_generated';

export type Sensitivity = 'none' | 'pii' | 'financial';

export interface FieldDefinition {
  id: string;
  workspace_id: string;
  entity_kind: EntityKind;
  object_type_id: string | null;
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  ai_generation_config: Record<string, unknown>;
  is_required: boolean;
  is_filterable: boolean;
  position: number;
  editable_roles: string[];
  sensitivity_level: Sensitivity;
  created_at: string;
}

export const ROTULO_TIPO: Record<FieldType, string> = {
  text: 'Texto',
  number: 'Número',
  currency: 'Valor (BRL)',
  date: 'Data',
  boolean: 'Sim/não',
  select: 'Escolha única',
  multiselect: 'Escolha múltipla',
  relation: 'Relação',
  email: 'E-mail',
  phone: 'Telefone',
  ai_generated: 'Gerado por IA',
};

export const ROTULO_ENTIDADE: Record<EntityKind, string> = {
  contact: 'Contato',
  company: 'Empresa',
  deal: 'Negócio',
  object_type: 'Objeto customizado',
};

export const ROTULO_SENSIBILIDADE: Record<Sensitivity, string> = {
  none: 'Comum',
  pii: 'Dado pessoal',
  financial: 'Financeiro',
};

/** Tipos que exigem lista de opções — o banco recusa select/multiselect sem elas. */
export function exigeOpcoes(tipo: FieldType): boolean {
  return tipo === 'select' || tipo === 'multiselect';
}

/** Converte o valor bruto do formulário para o formato que o jsonb espera. */
export function paraJson(tipo: FieldType, bruto: unknown): unknown {
  if (bruto === '' || bruto === undefined || bruto === null) return null;

  switch (tipo) {
    case 'number':
    case 'currency':
      return typeof bruto === 'number' ? bruto : Number(String(bruto).replace(',', '.'));
    case 'boolean':
      return bruto === true || bruto === 'true';
    case 'multiselect':
      return Array.isArray(bruto) ? bruto : [bruto];
    default:
      return String(bruto);
  }
}

/** Mesma exibição em lista e em formulário, para não divergirem. */
export function paraTexto(tipo: FieldType, valor: unknown): string {
  if (valor === null || valor === undefined) return '—';

  switch (tipo) {
    case 'currency':
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
        .format(Number(valor));
    case 'number':
      return new Intl.NumberFormat('pt-BR').format(Number(valor));
    case 'boolean':
      return valor ? 'Sim' : 'Não';
    case 'date':
      return new Date(String(valor)).toLocaleDateString('pt-BR');
    case 'multiselect':
      return Array.isArray(valor) ? valor.join(', ') : String(valor);
    default:
      return String(valor);
  }
}

export function formatarBRL(valor: number | null | undefined, moeda = 'BRL'): string {
  if (valor === null || valor === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(valor);
}

/**
 * Checagem previa antes de enviar. Devolve a primeira mensagem de erro, ou
 * null. Espelha as regras de app.validate_custom_fields; se as duas
 * divergirem, a do banco vence — ela é a que protege importacao e automacao.
 */
export function validarPrevia(
  definicoes: FieldDefinition[],
  valores: Record<string, unknown>
): string | null {
  for (const def of definicoes) {
    const valor = valores[def.key];
    const vazio = valor === null || valor === undefined || valor === ''
      || (Array.isArray(valor) && valor.length === 0);

    if (vazio) {
      if (def.is_required) return `${def.label} é obrigatório.`;
      continue;
    }

    if (def.field_type === 'number' || def.field_type === 'currency') {
      if (Number.isNaN(Number(valor))) return `${def.label} precisa ser um número.`;
    }

    if (def.field_type === 'email') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(valor))) {
        return `${def.label} precisa ser um e-mail válido.`;
      }
    }

    if (def.field_type === 'phone') {
      if (!/^[0-9()+\-\s.]{8,20}$/.test(String(valor))) {
        return `${def.label} precisa ser um telefone válido.`;
      }
    }

    if (def.field_type === 'select' && !def.options.includes(String(valor))) {
      return `${def.label} tem um valor fora das opções.`;
    }

    if (def.field_type === 'multiselect' && Array.isArray(valor)) {
      const fora = valor.find((v) => !def.options.includes(String(v)));
      if (fora) return `${def.label} tem um valor fora das opções: ${fora}.`;
    }
  }

  return null;
}

/** Monta o objeto custom_fields a partir do estado do formulário. */
export function montarCustomFields(
  definicoes: FieldDefinition[],
  valores: Record<string, unknown>
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  for (const def of definicoes) {
    const convertido = paraJson(def.field_type, valores[def.key]);
    // Chave ausente e chave nula são diferentes para o banco: enviar null em
    // campo opcional falharia na checagem de tipo. Campo vazio simplesmente
    // não entra no objeto.
    if (convertido !== null) saida[def.key] = convertido;
  }

  return saida;
}

export const TABELA_POR_ENTIDADE: Record<EntityKind, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  object_type: 'object_records',
};

/** Coluna que serve de rótulo principal em cada tabela. */
export const TITULO_POR_ENTIDADE: Record<EntityKind, string> = {
  contact: 'name',
  company: 'name',
  deal: 'title',
  object_type: 'title',
};
