// src/services/database/models/VeiculoModel.ts
// Model para operações CRUD de Veículos em OS no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalVeiculo, SYNC_PRIORITIES } from './types';
import type { VeiculoOS, AddVeiculoRequest } from '../../../types';
import { OSModel } from './OSModel';

export const VeiculoModel = {
    /**
     * Buscar veículo por ID local
     */
    async getById(id: number): Promise<LocalVeiculo | null> {
        return await databaseService.getFirst<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE id = ?`,
            [id]
        );
    },

    /**
     * Buscar veículo por server_id
     */
    async getByServerId(serverId: number): Promise<LocalVeiculo | null> {
        return await databaseService.getFirst<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE server_id = ?`,
            [serverId]
        );
    },

    /**
     * Buscar veículos por OS
     */
    async getByOSId(osId: number): Promise<LocalVeiculo[]> {
        return await databaseService.runQuery<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE os_id = ? AND sync_status != 'PENDING_DELETE'`,
            [osId]
        );
    },

    /**
     * Buscar veículo por placa (para pesquisa offline)
     */
    async searchByPlaca(placa: string): Promise<LocalVeiculo[]> {
        return await databaseService.runQuery<LocalVeiculo>(
            `SELECT * FROM veiculos_os 
       WHERE placa LIKE ? AND sync_status != 'PENDING_DELETE'
       ORDER BY created_at DESC
       LIMIT 20`,
            [`%${placa}%`]
        );
    },

    /**
     * Verificar se placa já existe
     */
    async verificarPlaca(placa: string): Promise<{ existe: boolean; veiculoExistente?: LocalVeiculo }> {
        const veiculo = await databaseService.getFirst<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE placa = ? ORDER BY created_at DESC LIMIT 1`,
            [placa.toUpperCase()]
        );

        return {
            existe: !!veiculo,
            veiculoExistente: veiculo || undefined
        };
    },

    /**
     * Criar veículo local
     */
    async create(data: AddVeiculoRequest & { osLocalId?: string }): Promise<LocalVeiculo> {
        const now = Date.now();
        const localId = uuidv4();

        // Resolver OS
        let osId: number | null = null;
        let osLocalId: string | null = data.osLocalId || null;

        if (data.ordemServicoId) {
            const os = await OSModel.getByServerId(data.ordemServicoId);
            if (os) {
                osId = os.id;
                osLocalId = os.local_id;
            }
        }

        // Se não achou por server_id (ou não foi passado), tentar pelo local_id
        if (!osId && osLocalId) {
            const os = await OSModel.getByLocalId(osLocalId);
            if (os) {
                osId = os.id;
            }
        }

        const id = await databaseService.runInsert(
            `INSERT INTO veiculos_os (
        local_id, server_id, version, os_id, os_local_id,
        placa, modelo, cor, valor_total, sync_status, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CREATE', ?, ?)`,
            [
                localId,
                null,
                1,
                osId,
                osLocalId,
                data.placa.toUpperCase(),
                data.modelo || null,
                data.cor || null,
                0,
                now,
                now
            ]
        );

        await this.addToSyncQueue(localId, 'CREATE', data);

        return (await this.getById(id))!;
    },

    /**
     * Salvar veículo do servidor
     */
    async upsertFromServer(veiculo: VeiculoOS, osLocalId: number): Promise<LocalVeiculo> {
        const now = Date.now();
        const existing = await this.getByServerId(veiculo.id);

        if (existing) {
            await databaseService.runUpdate(
                `UPDATE veiculos_os SET
          placa = ?, modelo = ?, cor = ?, valor_total = ?,
          sync_status = 'SYNCED', updated_at = ?
         WHERE id = ?`,
                [veiculo.placa, veiculo.modelo, veiculo.cor, veiculo.valorTotal, now, existing.id]
            );
            return (await this.getById(existing.id))!;
        } else {
            const localId = uuidv4();
            const id = await databaseService.runInsert(
                `INSERT INTO veiculos_os (
          local_id, server_id, version, os_id, placa, modelo, cor, valor_total,
          sync_status, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?)`,
                [localId, veiculo.id, 1, osLocalId, veiculo.placa, veiculo.modelo, veiculo.cor, veiculo.valorTotal, now, now]
            );
            return (await this.getById(id))!;
        }
    },

    /**
     * Atualizar valor total do veículo
     */
    async updateValorTotal(id: number, valorTotal: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE veiculos_os SET valor_total = ?, updated_at = ? WHERE id = ?`,
            [valorTotal, Date.now(), id]
        );
    },

    /**
     * Deletar veículo
     */
    async delete(id: number): Promise<boolean> {
        const existing = await this.getById(id);
        if (!existing) return false;

        if (existing.server_id) {
            await databaseService.runUpdate(
                `UPDATE veiculos_os SET sync_status = 'PENDING_DELETE', updated_at = ? WHERE id = ?`,
                [Date.now(), id]
            );
            await this.addToSyncQueue(existing.local_id, 'DELETE', null);
        } else {
            await databaseService.runDelete(`DELETE FROM veiculos_os WHERE id = ?`, [id]);
            await databaseService.runDelete(
                `DELETE FROM sync_queue WHERE entity_type = 'veiculo' AND entity_local_id = ?`,
                [existing.local_id]
            );
        }

        return true;
    },

    /**
     * Marcar como sincronizado
     * CRÍTICO: Atualiza referências em cascata (peças filhas)
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        console.log(`[VeiculoModel] markAsSynced: UUID ${localId} → ID ${serverId}`);

        // 1. Atualizar veículo com server_id
        await databaseService.runUpdate(
            `UPDATE veiculos_os SET server_id = ?, sync_status = 'SYNCED' WHERE local_id = ?`,
            [serverId, localId]
        );

        // 2. CASCATA: Atualizar peças filhas para apontar pro novo server_id do veículo
        const childrenUpdated = await databaseService.runUpdate(
            `UPDATE pecas_os SET veiculo_id = ? WHERE veiculo_local_id = ?`,
            [serverId, localId]
        );

        console.log(`[VeiculoModel] ✅ Veiculo synced. Updated ${childrenUpdated} child pecas to point to Veiculo ID ${serverId}`);

        // 3. Remover da fila de sync
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE entity_type = 'veiculo' AND entity_local_id = ?`,
            [localId]
        );
    },

    /**
     * Adicionar à fila de sync
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        const now = Date.now();

        const existing = await databaseService.getFirst<{ id: number }>(
            `SELECT id FROM sync_queue WHERE entity_type = 'veiculo' AND entity_local_id = ?`,
            [localId]
        );

        if (existing) {
            await databaseService.runUpdate(
                `UPDATE sync_queue SET operation = ?, payload = ?, created_at = ? WHERE id = ?`,
                [operation, payload ? JSON.stringify(payload) : null, now, existing.id]
            );
        } else {
            await databaseService.runInsert(
                `INSERT INTO sync_queue (entity_type, entity_local_id, operation, payload, priority, created_at)
         VALUES ('veiculo', ?, ?, ?, ?, ?)`,
                [localId, operation, payload ? JSON.stringify(payload) : null, SYNC_PRIORITIES.HIGH, now]
            );
        }
    }
};
