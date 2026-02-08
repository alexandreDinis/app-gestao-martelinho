// src/services/database/models/SyncQueueModel.ts
// Model para gerenciamento da fila de sincronização

import { databaseService } from '../DatabaseService';
import { SyncQueueItem, SyncPriority, SYNC_PRIORITIES } from './types';

const MAX_RETRY_ATTEMPTS = 5;

export const SyncQueueModel = {
    /**
     * Adicionar item à fila de sincronização (Alias para add)
     */
    async addToQueue(item: Omit<SyncQueueItem, 'id' | 'created_at' | 'status' | 'attempts'>): Promise<number> {
        return this.add(item);
    },

    /**
     * Adicionar item à fila de sincronização
     */
    async add(item: Omit<SyncQueueItem, 'id' | 'created_at' | 'status' | 'attempts'>): Promise<number> {
        const now = Date.now();

        // Verificar se já existe item pendente para este recurso
        const existing = await databaseService.getFirst<SyncQueueItem>(
            `SELECT id, resource as entity_type, temp_id as entity_local_id, action as operation, payload, status, created_at, attempts 
             FROM sync_queue WHERE resource = ? AND temp_id = ? AND status = 'PENDING'`,
            [item.entity_type, item.entity_local_id]
        );

        if (existing) {
            // Se já existe, atualiza a ação e payload (last win)
            // Se a nova ação é DELETE e a anterior era CREATE, podemos remover ambas (nunca subiu)
            if (existing.operation === 'CREATE' && item.operation === 'DELETE') {
                await this.remove(existing.id);
                return 0;
            }

            await databaseService.runUpdate(
                `UPDATE sync_queue SET action = ?, payload = ?, created_at = ?, attempts = 0 WHERE id = ?`,
                [item.operation, item.payload ? JSON.stringify(item.payload) : null, now, existing.id]
            );
            return existing.id;
        }

        return await databaseService.runInsert(
            `INSERT INTO sync_queue (resource, action, payload, temp_id, status, created_at, attempts)
             VALUES (?, ?, ?, ?, 'PENDING', ?, 0)`,
            [item.entity_type, item.operation, item.payload ? JSON.stringify(item.payload) : null, item.entity_local_id, now]
        );
    },

    /**
     * Obter o próximo item pendente para processamento
     * Prioridade implícita: FIFO (created_at ASC) + tentativas (attempts ASC)
     */
    async getNextPending(): Promise<SyncQueueItem | null> {
        return await databaseService.getFirst<SyncQueueItem>(
            `SELECT id, resource as entity_type, temp_id as entity_local_id, action as operation, payload, status, created_at, attempts 
             FROM sync_queue 
             WHERE status = 'PENDING' AND attempts < ?
             ORDER BY attempts ASC, created_at ASC
             LIMIT 1`,
            [MAX_RETRY_ATTEMPTS]
        );
    },

    /**
     * Marcar item como processado com sucesso
     */
    async markAsProcessed(id: number): Promise<void> {
        // Opção 1: Remover da fila (Cleaner)
        await this.remove(id);

        // Opção 2: Manter histórico (Tabela cresce indefinidamente, requer limpeza periódica)
        // await databaseService.runUpdate(`UPDATE sync_queue SET status = 'PROCESSED' WHERE id = ?`, [id]);
    },

    /**
     * Marcar tentativa de processamento (sucesso ou erro)
     */
    async markAttempt(id: number, success: boolean, errorMessage?: string): Promise<void> {
        if (success) {
            await this.markAsProcessed(id);
            return;
        }

        await databaseService.runUpdate(
            `UPDATE sync_queue 
             SET attempts = attempts + 1, 
                 last_attempt = ?, 
                 error_message = ?,
                 status = CASE WHEN attempts + 1 >= ? THEN 'ERROR' ELSE 'PENDING' END
             WHERE id = ?`,
            [Date.now(), errorMessage || null, MAX_RETRY_ATTEMPTS, id]
        );
    },

    /**
     * Obter contagem de itens na fila
     */
    async getCounts(): Promise<{ total: number; errors: number }> {
        const total = await databaseService.getFirst<{ count: number }>(
            `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' AND attempts < ?`,
            [MAX_RETRY_ATTEMPTS]
        );
        const errors = await databaseService.getFirst<{ count: number }>(
            `SELECT COUNT(*) as count FROM sync_queue WHERE status = 'ERROR' OR attempts >= ?`,
            [MAX_RETRY_ATTEMPTS]
        );

        return {
            total: total?.count || 0,
            errors: errors?.count || 0
        };
    },

    /**
     * Marcar item como erro (Legacy - use markAttempt)
     */
    async markAsError(id: number, errorMessage?: string): Promise<void> {
        return this.markAttempt(id, false, errorMessage);
    },

    /**
     * Remover item da fila manualmente
     */
    async remove(id: number): Promise<void> {
        await databaseService.runDelete(`DELETE FROM sync_queue WHERE id = ?`, [id]);
    },

    /**
     * Métodos auxiliares para compatibilidade ou limpeza
     */
    async getPending(): Promise<SyncQueueItem[]> {
        return await databaseService.runQuery<SyncQueueItem>(
            `SELECT id, resource as entity_type, temp_id as entity_local_id, action as operation, payload, status, created_at, attempts 
             FROM sync_queue WHERE status = 'PENDING' AND attempts < ? ORDER BY created_at ASC`,
            [MAX_RETRY_ATTEMPTS]
        );
    },

    /**
     * Reseta tentativas de itens falhos para tentar novamente
     */
    async retryAllFailed(): Promise<void> {
        console.log('[SyncQueue] Resetting attempts for failed items...');
        await databaseService.runUpdate(
            `UPDATE sync_queue SET attempts = 0, status = 'PENDING' WHERE attempts >= ?`,
            [MAX_RETRY_ATTEMPTS]
        );
    },

    /**
     * Verificar se existe item pendente na fila para uma entidade específica
     */
    async hasPending(entityType: string, localId: string): Promise<boolean> {
        // Verifica se há item PENDING e que AINDA pode ser processado (attempts < MAX)
        // Se attempts >= MAX, o item está "morto" na fila (mesmo que status seja PENDING por algum erro)
        // e não deve bloquear updates do servidor (Zombie Check deve retornar false)
        const item = await databaseService.getFirst<SyncQueueItem>(
            `SELECT id FROM sync_queue 
             WHERE resource = ? 
             AND temp_id = ? 
             AND status = 'PENDING' 
             AND attempts < ?`,
            [entityType, localId, MAX_RETRY_ATTEMPTS]
        );
        return !!item;
    }
};
