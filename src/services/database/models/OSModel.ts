// src/services/database/models/OSModel.ts
// Model para operações CRUD de Ordens de Serviço no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalOS, SyncStatus, SYNC_PRIORITIES } from './types';
import type { OrdemServico, CreateOSRequest, OSStatus } from '../../../types';
import { ClienteModel } from './ClienteModel';

export const OSModel = {
    /**
     * Buscar todas as OS locais
     */
    async getAll(): Promise<LocalOS[]> {
        return await databaseService.runQuery<LocalOS>(
            `SELECT * FROM ordens_servico WHERE sync_status != 'PENDING_DELETE' ORDER BY data DESC`
        );
    },

    /**
     * Buscar OS por ID local
     */
    async getById(id: number): Promise<LocalOS | null> {
        return await databaseService.getFirst<LocalOS>(
            `SELECT * FROM ordens_servico WHERE id = ?`,
            [id]
        );
    },

    /**
     * Buscar OS por server_id
     */
    async getByServerId(serverId: number): Promise<LocalOS | null> {
        return await databaseService.getFirst<LocalOS>(
            `SELECT * FROM ordens_servico WHERE server_id = ?`,
            [serverId]
        );
    },

    /**
     * Buscar OS por local_id
     */
    async getByLocalId(localId: string): Promise<LocalOS | null> {
        return await databaseService.getFirst<LocalOS>(
            `SELECT * FROM ordens_servico WHERE local_id = ?`,
            [localId]
        );
    },

    /**
     * Buscar OS por status
     */
    async getByStatus(status: OSStatus): Promise<LocalOS[]> {
        return await databaseService.runQuery<LocalOS>(
            `SELECT * FROM ordens_servico 
       WHERE status = ? AND sync_status != 'PENDING_DELETE'
       ORDER BY data DESC`,
            [status]
        );
    },

    /**
     * Buscar OS por cliente
     */
    async getByClienteId(clienteId: number): Promise<LocalOS[]> {
        return await databaseService.runQuery<LocalOS>(
            `SELECT * FROM ordens_servico 
       WHERE cliente_id = ? AND sync_status != 'PENDING_DELETE'
       ORDER BY data DESC`,
            [clienteId]
        );
    },

    /**
     * Criar OS local (para uso offline)
     */
    async create(data: CreateOSRequest & { clienteLocalId?: string }, syncStatus: SyncStatus = 'PENDING_CREATE'): Promise<LocalOS> {
        const now = Date.now();
        const localId = uuidv4();

        // Resolver cliente (pode ser por server_id ou local_id)
        let clienteId: number | null = null;
        let clienteLocalId: string | null = data.clienteLocalId || null;

        if (data.clienteId) {
            const cliente = await ClienteModel.getByServerId(data.clienteId);
            if (cliente) {
                clienteId = cliente.id;
                clienteLocalId = cliente.local_id;
            }
        }

        const uuid = localId; // Usando localId como UUID

        const id = await databaseService.runInsert(
            `INSERT INTO ordens_servico (
        local_id, uuid, server_id, version, cliente_id, cliente_local_id,
        data, data_vencimento, status, valor_total,
        sync_status, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                localId,
                uuid,
                null, // server_id
                1, // version
                clienteId,
                clienteLocalId,
                data.data,
                data.dataVencimento || null,
                'ABERTA',
                0, // valor_total inicial
                syncStatus,
                now,
                now
            ]
        );

        // Adicionar à fila de sync se for pendente
        if (syncStatus === 'PENDING_CREATE') {
            await this.addToSyncQueue(localId, 'CREATE', data, SYNC_PRIORITIES.HIGH);
        }

        return (await this.getById(id))!;
    },

    /**
     * Salvar múltiplas OS do servidor no cache local (Batch)
     */
    async upsertBatch(osList: OrdemServico[]): Promise<void> {
        for (const os of osList) {
            await this.upsertFromServer(os);
        }
    },

    /**
     * Salvar OS do servidor no cache local
     */
    async upsertFromServer(os: OrdemServico): Promise<LocalOS> {
        const now = Date.now();
        const existing = await this.getByServerId(os.id);

        // Resolver cliente local
        let clienteId: number | null = null;
        let clienteLocalId: string | null = null;
        if (os.cliente) {
            const clienteLocal = await ClienteModel.getByServerId(os.cliente.id);
            if (clienteLocal) {
                clienteId = clienteLocal.id;
                clienteLocalId = clienteLocal.local_id;
            }
        }

        if (existing) {
            // Atualizar existente
            await databaseService.runUpdate(
                `UPDATE ordens_servico SET
          cliente_id = ?, cliente_local_id = ?, data = ?, data_vencimento = ?,
          status = ?, valor_total = ?, tipo_desconto = ?, valor_desconto = ?,
          sync_status = 'SYNCED', last_synced_at = ?, updated_at = ?
         WHERE id = ?`,
                [
                    clienteId,
                    clienteLocalId,
                    os.data,
                    os.dataVencimento || null,
                    os.status,
                    os.valorTotal,
                    os.tipoDesconto || null,
                    os.valorDesconto || null,
                    now,
                    now,
                    existing.id
                ]
            );
            return (await this.getById(existing.id))!;
        } else {
            // Inserir novo
            const localId = uuidv4();
            const uuid = localId; // Usando localId como UUID

            const id = await databaseService.runInsert(
                `INSERT INTO ordens_servico (
          local_id, uuid, server_id, version, cliente_id, cliente_local_id,
          data, data_vencimento, status, valor_total, tipo_desconto, valor_desconto,
          sync_status, last_synced_at, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?)`,
                [
                    localId,
                    uuid,
                    os.id,
                    1,
                    clienteId,
                    clienteLocalId,
                    os.data,
                    os.dataVencimento || null,
                    os.status,
                    os.valorTotal,
                    os.tipoDesconto || null,
                    os.valorDesconto || null,
                    now,
                    now,
                    now
                ]
            );
            return (await this.getById(id))!;
        }
    },

    /**
     * Atualizar status da OS
     */
    async updateStatus(id: number, status: OSStatus): Promise<LocalOS | null> {
        const existing = await this.getById(id);
        if (!existing) return null;

        const now = Date.now();
        const newVersion = existing.version + 1;

        await databaseService.runUpdate(
            `UPDATE ordens_servico SET
        status = ?,
        version = ?,
        sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_UPDATE' ELSE sync_status END,
        updated_at = ?
       WHERE id = ?`,
            [status, newVersion, now, id]
        );

        // Se era SYNCED, adicionar à fila
        if (existing.sync_status === 'SYNCED') {
            // Prioridade crítica para finalizações
            const priority = status === 'FINALIZADA' ? SYNC_PRIORITIES.CRITICAL : SYNC_PRIORITIES.HIGH;
            await this.addToSyncQueue(existing.local_id, 'UPDATE', { status }, priority);
        }

        return await this.getById(id);
    },

    /**
     * Atualizar valor total da OS
     */
    async updateValorTotal(id: number, valorTotal: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE ordens_servico SET valor_total = ?, updated_at = ? WHERE id = ?`,
            [valorTotal, Date.now(), id]
        );
    },

    /**
     * Marcar OS para deleção
     */
    async delete(id: number): Promise<boolean> {
        const existing = await this.getById(id);
        if (!existing) return false;

        if (existing.server_id) {
            // Tem no servidor
            await databaseService.runUpdate(
                `UPDATE ordens_servico SET sync_status = 'PENDING_DELETE', updated_at = ? WHERE id = ?`,
                [Date.now(), id]
            );
            await this.addToSyncQueue(existing.local_id, 'DELETE', null, SYNC_PRIORITIES.NORMAL);
        } else {
            // Apenas local
            await databaseService.runDelete(`DELETE FROM ordens_servico WHERE id = ?`, [id]);
            await databaseService.runDelete(
                `DELETE FROM sync_queue WHERE entity_type = 'os' AND entity_local_id = ?`,
                [existing.local_id]
            );
        }

        return true;
    },

    /**
     * Obter OS pendentes de sincronização
     */
    async getPendingSync(): Promise<LocalOS[]> {
        return await databaseService.runQuery<LocalOS>(
            `SELECT * FROM ordens_servico WHERE sync_status IN ('PENDING_CREATE', 'PENDING_UPDATE', 'PENDING_DELETE')`
        );
    },

    /**
     * Marcar como sincronizado
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE ordens_servico SET 
        server_id = ?, 
        sync_status = 'SYNCED', 
        last_synced_at = ? 
       WHERE local_id = ?`,
            [serverId, Date.now(), localId]
        );

        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE entity_type = 'os' AND entity_local_id = ?`,
            [localId]
        );
    },

    /**
     * Adicionar à fila de sincronização
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any, priority: number = SYNC_PRIORITIES.NORMAL): Promise<void> {
        const now = Date.now();

        const existing = await databaseService.getFirst<{ id: number }>(
            `SELECT id FROM sync_queue WHERE resource = 'os' AND temp_id = ? AND status = 'PENDING'`,
            [localId]
        );

        if (existing) {
            await databaseService.runUpdate(
                `UPDATE sync_queue SET action = ?, payload = ?, created_at = ?, attempts = 0 WHERE id = ?`,
                [operation, payload ? JSON.stringify(payload) : null, now, existing.id]
            );
        } else {
            await databaseService.runInsert(
                `INSERT INTO sync_queue (resource, temp_id, action, payload, status, created_at, attempts)
          VALUES ('os', ?, ?, ?, 'PENDING', ?, 0)`,
                [localId, operation, payload ? JSON.stringify(payload) : null, now]
            );
        }
    }
};
