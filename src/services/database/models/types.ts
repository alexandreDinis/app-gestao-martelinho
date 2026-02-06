// src/services/database/models/types.ts
// Tipos compartilhados para models do banco de dados

export type SyncStatus =
    | 'SYNCED'           // Sincronizado com servidor
    | 'PENDING_CREATE'   // Aguardando criação no servidor
    | 'PENDING_UPDATE'   // Aguardando atualização no servidor
    | 'PENDING_DELETE'   // Aguardando deleção no servidor
    | 'SYNCING'          // Em processo de sincronização
    | 'ERROR';           // Erro ao sincronizar

export type SyncPriority = 1 | 3 | 5 | 10;

export const SYNC_PRIORITIES = {
    CRITICAL: 1 as SyncPriority,    // Despesas, OS finalizadas
    HIGH: 3 as SyncPriority,        // Nova OS, novo cliente
    NORMAL: 5 as SyncPriority,      // Updates gerais
    LOW: 10 as SyncPriority,        // Cache updates
};

export interface BaseLocalEntity {
    id: number;
    local_id: string; // Mantendo por compatibilidade enquanto migramos
    uuid?: string;    // Novo identificador universal
    server_id: number | null;
    version: number;
    sync_status: SyncStatus;
    last_synced_at: number | null;
    updated_at: number;
    created_at: number;
}

export interface LocalCliente extends BaseLocalEntity {
    razao_social: string;
    nome_fantasia: string | null;
    cnpj: string | null;
    cpf: string | null;
    tipo_pessoa: string | null;
    contato: string | null;
    email: string | null;
    status: string;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    cep: string | null;
}

export interface LocalOS extends BaseLocalEntity {
    cliente_id: number | null;
    cliente_local_id: string | null;
    data: string;
    data_vencimento: string | null;
    status: string;
    valor_total: number;
    tipo_desconto: string | null;
    valor_desconto: number | null;
    // Campos de Responsável
    usuario_id?: number | null;
    usuario_nome?: string | null;
    usuario_email?: string | null;
}

export interface LocalVeiculo extends BaseLocalEntity {
    os_id: number | null;
    os_local_id: string | null;
    placa: string;
    modelo: string | null;
    cor: string | null;
    valor_total: number;
}

export interface LocalPeca extends BaseLocalEntity {
    veiculo_id: number | null;
    veiculo_local_id: string | null;
    tipo_peca_id: number | null;
    nome_peca: string | null;
    valor_cobrado: number | null;
    descricao: string | null;
}

export interface LocalDespesa extends BaseLocalEntity {
    data_despesa: string | null;
    data_vencimento: string | null;
    valor: number;
    categoria: string | null;
    descricao: string | null;
    pago_agora: number;
    meio_pagamento: string | null;
    cartao_id: number | null;
}

export interface LocalTipoPeca {
    id: number;
    nome: string;
    preco_sugerido: number | null;
    updated_at: number;
}

export interface SyncQueueItem {
    id: number;
    resource: string;       // ex: 'cliente', 'os'
    temp_id: string;       // GUID local
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    payload: string | null;
    status: 'PENDING' | 'PROCESSED' | 'ERROR';
    created_at: number;
    attempts: number;
    last_attempt?: number | null;
    error_message?: string | null;
}

export interface AuditLogEntry {
    id: number;
    entity_type: string;
    entity_id: string;
    operation: string;
    old_data: string | null;
    new_data: string | null;
    conflict_detected: number;
    conflict_resolution: string | null;
    user_id: number | null;
    timestamp: number;
}
