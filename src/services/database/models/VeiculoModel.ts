// src/services/database/models/VeiculoModel.ts
// Model para operações CRUD de Veículos em OS no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalVeiculo, SYNC_PRIORITIES } from './types';
import type { VeiculoOS, AddVeiculoRequest } from '../../../types';
import { cleanZombies } from './BaseModel';

export const VeiculoModel = {
    /**
     * Buscar veículo por ID local
     */
    async getById(id: number): Promise<LocalVeiculo | null> {
        return await databaseService.getFirst<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE id = ? AND deleted_at IS NULL`,
            [id]
        );
    },

    /**
     * Buscar veículo por ID local (UUID)
     */
    async getByLocalId(localId: string): Promise<LocalVeiculo | null> {
        return await databaseService.getFirst<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE local_id = ? AND deleted_at IS NULL`,
            [localId]
        );
    },

    /**
     * Buscar veículo por server_id
     */
    async getByServerId(serverId: number): Promise<LocalVeiculo | null> {
        return await databaseService.getFirst<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE server_id = ? AND deleted_at IS NULL`,
            [serverId]
        );
    },

    /**
     * Buscar veículos por OS
     */
    async getByOSId(osId: number): Promise<LocalVeiculo[]> {
        return await databaseService.runQuery<LocalVeiculo>(
            `SELECT * FROM veiculos_os WHERE os_id = ? AND deleted_at IS NULL AND sync_status != 'PENDING_DELETE'`,
            [osId]
        );
    },

    /**
     * Buscar veículo por placa (para pesquisa offline)
     */
    async searchByPlaca(placa: string): Promise<LocalVeiculo[]> {
        return await databaseService.runQuery<LocalVeiculo>(
            `SELECT * FROM veiculos_os 
       WHERE placa LIKE ? AND deleted_at IS NULL AND sync_status != 'PENDING_DELETE'
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
            `SELECT * FROM veiculos_os WHERE placa = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
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
        try {
            console.log('[VeiculoModel] create() called', JSON.stringify(data));
            const now = Date.now();
            const localId = uuidv4();
            console.log('[VeiculoModel] generated localId', localId);

            // Resolver OS
            let osId: number | null = null;
            let osLocalId: string | null = data.osLocalId || null;

            console.log('[VeiculoModel] requiring OSModel...');
            const { OSModel } = require('./OSModel');
            console.log('[VeiculoModel] OSModel loaded:', !!OSModel);

            // 1. Prioridade absoluta: Buscar por local_id (UUID)
            if (osLocalId) {
                console.log('[VeiculoModel] searching by osLocalId', osLocalId);
                const os = await OSModel.getByLocalId(osLocalId);
                if (os) {
                    osId = os.id;
                    osLocalId = os.local_id;
                    console.log(`[VeiculoModel] 🔗 Vinculado via osLocalId ${osLocalId} -> PK ${osId}`);
                } else {
                    console.log('[VeiculoModel] osLocalId not found');
                }
            }

            // 2. Fallback: Se não achou por local_id, busca por server_id
            if (!osId && data.ordemServicoId) {
                console.log('[VeiculoModel] fallback searching by ordemServicoId', data.ordemServicoId);
                // Tenta primeiro como server_id
                const osByServer = await OSModel.getByServerId(data.ordemServicoId);
                if (osByServer) {
                    osId = osByServer.id;
                    osLocalId = osByServer.local_id;
                    console.log(`[VeiculoModel] 🔗 Vinculado via server_id ${data.ordemServicoId} -> PK ${osId}`);
                } else {
                    // Se não é server_id, pode ser PK local
                    const osByPk = await OSModel.getById(data.ordemServicoId);
                    if (osByPk) {
                        osId = osByPk.id;
                        osLocalId = osByPk.local_id;
                        console.log(`[VeiculoModel] 🔗 Vinculado via PK local ${data.ordemServicoId} -> LocalId ${osLocalId}`);
                    }
                }
            }


            const placaValue = data.placa ? data.placa.toUpperCase() : '';

            if (!placaValue) {
                console.error('[VeiculoModel] ❌ Critical: Placa is missing/empty in create payload', JSON.stringify(data));
                throw new Error('Placa is required for vehicle creation');
            }

            const insertParams = [
                localId,
                null, // server_id
                1, // version
                osId,
                osLocalId,
                placaValue,
                data.modelo || null,
                data.cor || null,
                0, // valor_total
                now, // updated_at
                now // created_at
                // deleted_at implicitly null
            ];

            console.log('[VeiculoModel] 🛠️ Inserting vehicle with params:', JSON.stringify(insertParams));

            const id = await databaseService.runInsert(
                `INSERT INTO veiculos_os (
            local_id, server_id, version, os_id, os_local_id,
            placa, modelo, cor, valor_total, sync_status, updated_at, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CREATE', ?, ?, ?)`,
                [...insertParams, null]
            );

            await this.addToSyncQueue(localId, 'CREATE', { ...data, osLocalId });

            console.log('[VeiculoModel] ✅ create() SUCCESS. ID:', id);
            return (await this.getById(id))!;
        } catch (error: any) {
            console.error('[VeiculoModel] ❌ create() FAILED:', error.message);
            console.error('[VeiculoModel] Stack:', error.stack);
            throw error;
        }
    },

    /**
     * Salvar veículo do servidor
     */
    async upsertFromServer(veiculo: VeiculoOS, osLocalId: number): Promise<LocalVeiculo> {
        const now = Date.now();

        // 1. Tentar buscar por server_id
        let existing = await this.getByServerId(veiculo.id);

        // 2. Tentar buscar por local_id (UUID) vindo do servidor
        if (!existing && veiculo.localId) {
            existing = await this.getByLocalId(veiculo.localId);
            console.log(`[VeiculoModel] 🔗 Matched local record by UUID: ${veiculo.localId}`);
        }

        // 3. Fallback: Tentar buscar por PLACA dentro desta OS
        // Isso resolve se a OS/Veículo subiu mas o server_id ainda não voltou pro mobile
        if (!existing && veiculo.placa) {
            existing = await databaseService.getFirst<LocalVeiculo>(
                `SELECT * FROM veiculos_os WHERE os_id = ? AND placa = ? AND server_id IS NULL`,
                [osLocalId, veiculo.placa.toUpperCase()]
            );
            if (existing) {
                console.log(`[VeiculoModel] 🚗 Matched UNSYNCED local record by PLACA: ${veiculo.placa} for OS PK ${osLocalId}`);
            }
        }

        let localVeiculo: LocalVeiculo;

        if (existing) {
            await databaseService.runUpdate(
                `UPDATE veiculos_os SET
          server_id = ?, os_id = ?, placa = ?, modelo = ?, cor = ?, valor_total = ?,
          sync_status = 'SYNCED', updated_at = ?, deleted_at = ?
         WHERE id = ?`,
                [veiculo.id, osLocalId, veiculo.placa, veiculo.modelo, veiculo.cor, veiculo.valorTotal, now, veiculo.deletedAt || null, existing.id]
            );
            localVeiculo = (await this.getById(existing.id))!;
        } else {
            const localId = veiculo.localId || uuidv4();
            const id = await databaseService.runInsert(
                `INSERT INTO veiculos_os (
          local_id, server_id, version, os_id, placa, modelo, cor, valor_total,
          sync_status, updated_at, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?)`,
                [localId, veiculo.id, 1, osLocalId, veiculo.placa, veiculo.modelo, veiculo.cor, veiculo.valorTotal, now, now, veiculo.deletedAt || null]
            );
            localVeiculo = (await this.getById(id))!;
        }

        // Sync Peças/Serviços
        if (veiculo.pecas) {
            try {
                const { PecaModel } = require('./PecaModel');
                const validServerIds = new Set<number>();

                // 1. Upsert incoming
                for (const p of veiculo.pecas) {
                    const saved = await PecaModel.upsertFromServer(p, localVeiculo.id);
                    if (saved.server_id) validServerIds.add(saved.server_id);
                }

                // 2. Cleanup ("Zombie" pruning) - Generic Implementation
                // Remove peças que estão no banco local (SYNCED) mas não vieram no payload do servidor
                // Protege registros PENDING automaticamente
                const serverIdsArray = Array.from(validServerIds);
                if (serverIdsArray.length > 0) {
                    await cleanZombies('pecas_os', 'veiculo_id', localVeiculo.id, serverIdsArray);
                } else if (veiculo.pecas.length === 0) {
                    // Se veio array vazio EXPLICITAMENTE, assume que removeu tudo
                    await cleanZombies('pecas_os', 'veiculo_id', localVeiculo.id, []);
                }

            } catch (e) {
                console.error('[VeiculoModel] Erro ao sincronizar peças filhas', e);
            }
        }


        return localVeiculo;
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
                `DELETE FROM sync_queue WHERE resource = 'veiculo' AND temp_id = ?`,
                [existing.local_id]
            );
        }

        return true;
    },

    /**
     * Marcar como sincronizado
     * CRÍTICO: Atualiza referências em cascata (peças filhas)
     */
    /**
     * Recalcular valor total do veículo baseado nas peças
     */
    async recalculateTotal(veiculoId: number): Promise<number> {
        const result = await databaseService.getFirst<{ total: number }>(
            `SELECT SUM(valor_cobrado) as total FROM pecas_os 
             WHERE veiculo_id = ? AND sync_status != 'PENDING_DELETE'`,
            [veiculoId]
        );
        const total = result?.total || 0;

        await databaseService.runUpdate(
            `UPDATE veiculos_os SET valor_total = ?, updated_at = ? WHERE id = ?`,
            [total, Date.now(), veiculoId]
        );

        console.log(`[VeiculoModel] Recalculated total for Veiculo ${veiculoId}: ${total}`);
        return total;
    },

    /**
     * Marcar como sincronizado
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        console.log(`[VeiculoModel] markAsSynced: UUID ${localId} → ID ${serverId}`);

        // 1. Atualizar veículo com server_id
        await databaseService.runUpdate(
            `UPDATE veiculos_os SET server_id = ?, sync_status = 'SYNCED' WHERE local_id = ?`,
            [serverId, localId]
        );

        // 2. CASCATA: REMOVIDO
        // Não atualizar peças filhas com server_id, pois veiculo_id refere-se à PK Local
        // O vínculo é mantido pelo veiculo_id (PK Local) que não muda.
        console.log(`[VeiculoModel] ✅ Veiculo synced (ID ${serverId}). Local links preserved.`);

        // 3. Remover da fila de sync
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE resource = 'veiculo' AND temp_id = ?`,
            [localId]
        );
    },

    /**
     * Adicionar à fila de sync
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        const now = Date.now();

        const existing = await databaseService.getFirst<{ id: number }>(
            `SELECT id FROM sync_queue WHERE resource = 'veiculo' AND temp_id = ? AND status = 'PENDING'`,
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
         VALUES ('veiculo', ?, ?, ?, 'PENDING', ?, 0)`,
                [localId, operation, payload ? JSON.stringify(payload) : null, now]
            );
        }
    }
};
