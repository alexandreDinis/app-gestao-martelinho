// src/services/database/models/SyncQueueModel.ts
// Model para gerenciamento da fila de sincronização

import { databaseService } from '../DatabaseService';
import { SyncQueueItem, SyncPriority, SYNC_PRIORITIES } from './types';

const MAX_RETRY_ATTEMPTS = 5;

export const SyncQueueModel = {
    /**
     * Obter todos os itens pendentes de sync ordenados por prioridade
     */
    async getPending(): Promise<SyncQueueItem[]> {
        return await databaseService.runQuery<SyncQueueItem>(
            `SELECT * FROM sync_queue 
       WHERE attempts < ?
       ORDER BY priority ASC, attempts ASC, created_at ASC`,
            [MAX_RETRY_ATTEMPTS]
        );
    },

    /**
     * Obter itens com erro (após max attempts)
     */
    async getErrors(): Promise<SyncQueueItem[]> {
        return await databaseService.runQuery<SyncQueueItem>(
            `SELECT * FROM sync_queue WHERE attempts >= ?`,
            [MAX_RETRY_ATTEMPTS]
        );
    },

    /**
     * Obter contagem de pendências por tipo
     */
    async getCounts(): Promise<{ total: number; byType: Record<string, number>; errors: number }> {
        const total = await databaseService.getFirst<{ count: number }>(
            `SELECT COUNT(*) as count FROM sync_queue WHERE attempts < ?`,
            [MAX_RETRY_ATTEMPTS]
        );

        const byTypeResult = await databaseService.runQuery<{ entity_type: string; count: number }>(
            `SELECT entity_type, COUNT(*) as count FROM sync_queue 
       WHERE attempts < ? GROUP BY entity_type`,
            [MAX_RETRY_ATTEMPTS]
        );

        const errors = await databaseService.getFirst<{ count: number }>(
            `SELECT COUNT(*) as count FROM sync_queue WHERE attempts >= ?`,
            [MAX_RETRY_ATTEMPTS]
        );

        const byType: Record<string, number> = {};
        byTypeResult.forEach(r => {
            byType[r.entity_type] = r.count;
        });

        return {
            total: total?.count ?? 0,
            byType,
            errors: errors?.count ?? 0
        };
    },

    /**
     * Adicionar item à fila
     */
    async add(
        entityType: string,
        entityLocalId: string,
        operation: 'CREATE' | 'UPDATE' | 'DELETE',
        payload: any = null,
        priority: SyncPriority = SYNC_PRIORITIES.NORMAL
    ): Promise<number> {
        const now = Date.now();

        // Verificar se já existe
        const existing = await databaseService.getFirst<SyncQueueItem>(
            `SELECT * FROM sync_queue WHERE entity_type = ? AND entity_local_id = ?`,
            [entityType, entityLocalId]
        );

        if (existing) {
            // Atualizar operação existente
            // Se DELETE vem após CREATE, remover da fila (criado e deletado offline)
            if (existing.operation === 'CREATE' && operation === 'DELETE') {
                await this.remove(existing.id);
                return 0;
            }

            await databaseService.runUpdate(
                `UPDATE sync_queue SET operation = ?, payload = ?, priority = ?, created_at = ? WHERE id = ?`,
                [operation, payload ? JSON.stringify(payload) : null, priority, now, existing.id]
            );
            return existing.id;
        }

        return await databaseService.runInsert(
            `INSERT INTO sync_queue (entity_type, entity_local_id, operation, payload, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [entityType, entityLocalId, operation, payload ? JSON.stringify(payload) : null, priority, now]
        );
    },

    /**
     * Marcar tentativa de sync
     */
    async markAttempt(id: number, success: boolean, errorMessage?: string): Promise<void> {
        if (success) {
            await this.remove(id);
        } else {
            await databaseService.runUpdate(
                `UPDATE sync_queue SET attempts = attempts + 1, last_attempt = ?, error_message = ? WHERE id = ?`,
                [Date.now(), errorMessage || null, id]
            );
        }
    },

    /**
     * Remover item da fila
     */
    async remove(id: number): Promise<void> {
        await databaseService.runDelete(`DELETE FROM sync_queue WHERE id = ?`, [id]);
    },

    /**
     * Remover por entidade
     */
    async removeByEntity(entityType: string, entityLocalId: string): Promise<void> {
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE entity_type = ? AND entity_local_id = ?`,
            [entityType, entityLocalId]
        );
    },

    /**
     * Limpar todos os erros
     */
    async clearErrors(): Promise<number> {
        return await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE attempts >= ?`,
            [MAX_RETRY_ATTEMPTS]
        );
    },

    /**
     * Resetar tentativas de um item com erro (para retry manual)
     */
    async resetAttempts(id: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE sync_queue SET attempts = 0, error_message = NULL WHERE id = ?`,
            [id]
        );
    },

    /**
     * Resetar todas as tentativas (para retry em massa)
     */
    async resetAllAttempts(): Promise<number> {
        return await databaseService.runUpdate(
            `UPDATE sync_queue SET attempts = 0, error_message = NULL WHERE attempts > 0`,
            []
        );
    }
};
