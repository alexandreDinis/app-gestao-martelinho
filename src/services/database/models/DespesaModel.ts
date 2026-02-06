// src/services/database/models/DespesaModel.ts
// Model para operações CRUD de Despesas no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalDespesa, SYNC_PRIORITIES } from './types';
import type { Despesa } from '../../../types';
import { SyncQueueModel } from './SyncQueueModel';

export interface CreateDespesaLocal {
    data: string;
    valor: number;
    categoria?: string;
    descricao?: string;
    pagoAgora?: boolean;
    meioPagamento?: string;
    dataVencimento?: string;
    cartaoId?: number;
}

export const DespesaModel = {
    /**
     * Buscar todas as despesas locais
     */
    async getAll(): Promise<LocalDespesa[]> {
        return await databaseService.runQuery<LocalDespesa>(
            `SELECT * FROM despesas WHERE sync_status != 'PENDING_DELETE' ORDER BY data_despesa DESC`
        );
    },

    /**
     * Buscar despesa por ID
     */
    async getById(id: number): Promise<LocalDespesa | null> {
        return await databaseService.getFirst<LocalDespesa>(
            `SELECT * FROM despesas WHERE id = ?`,
            [id]
        );
    },

    /**
     * Buscar despesa por local_id
     */
    async getByLocalId(localId: string): Promise<LocalDespesa | null> {
        return await databaseService.getFirst<LocalDespesa>(
            `SELECT * FROM despesas WHERE local_id = ?`,
            [localId]
        );
    },

    /**
     * Buscar despesas por período
     */
    async getByPeriod(startDate: string, endDate: string): Promise<LocalDespesa[]> {
        return await databaseService.runQuery<LocalDespesa>(
            `SELECT * FROM despesas 
       WHERE data_despesa >= ? AND data_despesa <= ?
       AND sync_status != 'PENDING_DELETE'
       ORDER BY data_despesa DESC`,
            [startDate, endDate]
        );
    },

    /**
     * Salvar múltiplas despesas do servidor (Batch)
     */
    async upsertBatch(despesas: Despesa[]): Promise<void> {
        for (const despesa of despesas) {
            await this.upsertFromServer(despesa);
        }
    },

    /**
     * Salvar despesa do servidor no cache local
     */
    async upsertFromServer(despesa: Despesa): Promise<LocalDespesa> {
        const now = Date.now();

        // 1. Tentar buscar por server_id
        let existing = await databaseService.getFirst<LocalDespesa>(
            `SELECT * FROM despesas WHERE server_id = ?`,
            [despesa.id]
        );

        // 2. Fallback: Tentar buscar por localId se fornecido
        if (!existing && despesa.localId) {
            existing = await this.getByLocalId(despesa.localId);
            if (existing) {
                console.log(`[DespesaModel] Despesa encontrada via localId: ${despesa.localId}`);
            }
        }

        if (existing) {
            // 🛡️ SEGURANÇA: Não sobrescrever se houver alterações locais pendentes
            if (existing.sync_status !== 'SYNCED') {
                // Zombie Check: Se status é PENDING mas não está naf ila, é um estado inconsistente e devemos aceitar o server
                // Nota: DespesaModel usa 'despesa' como entity_type na tabela mas 'resource' no model?
                // Verificando addToSyncQueue: VALUES ('despesa', ...). O SyncQueueModel.hasPending busca por 'resource'.
                // O SyncQueueModel novo busca por resource. DespesaModel usa 'despesa'.
                const isReallyPending = await SyncQueueModel.hasPending('despesa', existing.local_id);

                if (isReallyPending) {
                    console.log(`[DespesaModel] 🛡️ Ignorando update do servidor para despesa ${existing.id} (status: ${existing.sync_status}, queue: YES)`);
                    return existing;
                } else {
                    console.log(`[DespesaModel] 🧟 Zombie detected! Status ${existing.sync_status} but not in Queue. Overwriting with Server data.`);
                }
            }

            await databaseService.runUpdate(
                `UPDATE despesas SET
          server_id = ?,
          data_despesa = ?, data_vencimento = ?, valor = ?, categoria = ?,
          descricao = ?, pago_agora = ?, meio_pagamento = ?, cartao_id = ?,
          sync_status = 'SYNCED', last_synced_at = ?, updated_at = ?
         WHERE id = ?`,
                [
                    despesa.id,
                    despesa.dataDespesa,
                    despesa.dataVencimento || null,
                    despesa.valor,
                    despesa.categoria,
                    despesa.descricao,
                    despesa.pagoAgora ? 1 : 0,
                    despesa.meioPagamento || null,
                    despesa.cartaoId || null,
                    now,
                    now,
                    existing.id
                ]
            );
            return (await this.getById(existing.id))!;
        } else {
            const localId = despesa.localId || uuidv4();
            const id = await databaseService.runInsert(
                `INSERT INTO despesas (
          local_id, server_id, version, data_despesa, data_vencimento,
          valor, categoria, descricao, pago_agora, meio_pagamento, cartao_id,
          sync_status, last_synced_at, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?)`,
                [
                    localId,
                    despesa.id,
                    1,
                    despesa.dataDespesa,
                    despesa.dataVencimento || null,
                    despesa.valor,
                    despesa.categoria,
                    despesa.descricao,
                    despesa.pagoAgora ? 1 : 0,
                    despesa.meioPagamento || null,
                    despesa.cartaoId || null,
                    now,
                    now,
                    now
                ]
            );
            return (await this.getById(id))!;
        }
    },

    /**
     * Criar despesa local (sempre pendente de sync)
     */
    async create(data: CreateDespesaLocal): Promise<LocalDespesa> {
        const now = Date.now();
        const localId = uuidv4();

        const id = await databaseService.runInsert(
            `INSERT INTO despesas (
        local_id, server_id, version, data_despesa, data_vencimento,
        valor, categoria, descricao, pago_agora, meio_pagamento, cartao_id,
        sync_status, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CREATE', ?, ?)`,
            [
                localId,
                null,
                1,
                data.data,
                data.dataVencimento || null,
                data.valor,
                data.categoria || null,
                data.descricao || null,
                data.pagoAgora ? 1 : 0,
                data.meioPagamento || null,
                data.cartaoId || null,
                now,
                now
            ]
        );

        // Despesas têm prioridade CRÍTICA na sync
        await this.addToSyncQueue(localId, 'CREATE', data);

        return (await this.getById(id))!;
    },

    /**
     * Obter despesas pendentes de sync
     */
    async getPendingSync(): Promise<LocalDespesa[]> {
        return await databaseService.runQuery<LocalDespesa>(
            `SELECT * FROM despesas WHERE sync_status IN ('PENDING_CREATE', 'PENDING_UPDATE', 'PENDING_DELETE')`
        );
    },

    /**
     * Marcar como sincronizada
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE despesas SET server_id = ?, sync_status = 'SYNCED', last_synced_at = ? WHERE local_id = ?`,
            [serverId, Date.now(), localId]
        );
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE entity_type = 'despesa' AND entity_local_id = ?`,
            [localId]
        );
    },

    /**
     * Marcar como erro
     */
    async markAsError(localId: string, errorMessage: string): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE despesas SET sync_status = 'ERROR' WHERE local_id = ?`,
            [localId]
        );
        await databaseService.runUpdate(
            `UPDATE sync_queue SET error_message = ? WHERE entity_type = 'despesa' AND entity_local_id = ?`,
            [errorMessage, localId]
        );
    },

    /**
     * Adicionar à fila de sync (prioridade crítica para despesas)
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        const now = Date.now();

        const existing = await databaseService.getFirst<{ id: number }>(
            `SELECT id FROM sync_queue WHERE entity_type = 'despesa' AND entity_local_id = ?`,
            [localId]
        );

        if (existing) {
            await databaseService.runUpdate(
                `UPDATE sync_queue SET operation = ?, payload = ?, created_at = ? WHERE id = ?`,
                [operation, payload ? JSON.stringify(payload) : null, now, existing.id]
            );
        } else {
            // PRIORIDADE CRÍTICA para despesas
            await databaseService.runInsert(
                `INSERT INTO sync_queue (entity_type, entity_local_id, operation, payload, priority, created_at)
         VALUES ('despesa', ?, ?, ?, ?, ?)`,
                [localId, operation, payload ? JSON.stringify(payload) : null, SYNC_PRIORITIES.CRITICAL, now]
            );
        }
    },

    /**
     * Deletar despesa
     */
    async delete(id: number): Promise<boolean> {
        const existing = await this.getById(id);
        if (!existing) return false;

        if (existing.server_id) {
            await databaseService.runUpdate(
                `UPDATE despesas SET sync_status = 'PENDING_DELETE', updated_at = ? WHERE id = ?`,
                [Date.now(), id]
            );
            await this.addToSyncQueue(existing.local_id, 'DELETE', null);
        } else {
            await databaseService.runDelete(`DELETE FROM despesas WHERE id = ?`, [id]);
            await databaseService.runDelete(
                `DELETE FROM sync_queue WHERE entity_type = 'despesa' AND entity_local_id = ?`,
                [existing.local_id]
            );
        }

        return true;
    }
};
