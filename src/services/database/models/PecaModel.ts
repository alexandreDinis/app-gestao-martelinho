// src/services/database/models/PecaModel.ts
// Model para operações CRUD de Peças/Serviços em Veículos no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalPeca, LocalVeiculo, SYNC_PRIORITIES } from './types';
import type { PecaOS, AddPecaRequest } from '../../../types';
// import { VeiculoModel } from './VeiculoModel'; // Replaced by lazy load in methods

export const PecaModel = {
    /**
     * Buscar peça por ID local
     */
    async getById(id: number): Promise<LocalPeca | null> {
        return await databaseService.getFirst<LocalPeca>(
            `SELECT * FROM pecas_os WHERE id = ? AND deleted_at IS NULL`,
            [id]
        );
    },

    /**
     * Buscar peça por ID local (UUID)
     */
    async getByLocalId(localId: string): Promise<LocalPeca | null> {
        return await databaseService.getFirst<LocalPeca>(
            `SELECT * FROM pecas_os WHERE local_id = ? AND deleted_at IS NULL`,
            [localId]
        );
    },

    /**
     * Buscar peça por server_id
     */
    async getByServerId(serverId: number): Promise<LocalPeca | null> {
        return await databaseService.getFirst<LocalPeca>(
            `SELECT * FROM pecas_os WHERE server_id = ? AND deleted_at IS NULL`,
            [serverId]
        );
    },

    /**
     * Buscar peças por Veículo (ID local do veículo)
     */
    async getByVeiculoId(veiculoId: number): Promise<LocalPeca[]> {
        return await databaseService.runQuery<LocalPeca>(
            `SELECT * FROM pecas_os WHERE veiculo_id = ? AND deleted_at IS NULL AND sync_status != 'PENDING_DELETE'`,
            [veiculoId]
        );
    },

    /**
     * Criar peça local
     */
    async create(data: AddPecaRequest & { veiculoLocalId?: string }): Promise<LocalPeca> {
        console.log('[PecaModel] 🏗️ Creating peca:', JSON.stringify(data));
        const now = Date.now();
        const localId = uuidv4();

        // Lazy import to avoid circular dependency
        const { VeiculoModel } = require('./VeiculoModel');

        // Resolver Veículo
        let veiculoId: number | null = null;
        let veiculoLocalId: string | null = data.veiculoLocalId || null;

        // 1. Prioridade absoluta: Buscar por local_id (UUID)
        if (veiculoLocalId) {
            const veiculo = await databaseService.getFirst<LocalVeiculo>(
                `SELECT * FROM veiculos_os WHERE local_id = ?`,
                [veiculoLocalId]
            );
            if (veiculo) {
                veiculoId = veiculo.id;
                veiculoLocalId = veiculo.local_id;
                console.log(`[PecaModel] 🔗 Vinculado via veiculoLocalId ${veiculoLocalId} -> PK ${veiculoId}`);
            }
        }

        // 2. Fallback: Se não achou por local_id, busca por server_id
        if (!veiculoId && data.veiculoId) {
            // Tenta primeiro como server_id
            const veiculoByServer = await databaseService.getFirst<LocalVeiculo>(
                `SELECT * FROM veiculos_os WHERE server_id = ?`,
                [data.veiculoId]
            );
            if (veiculoByServer) {
                veiculoId = veiculoByServer.id;
                veiculoLocalId = veiculoByServer.local_id;
                console.log(`[PecaModel] 🔗 Vinculado via server_id ${data.veiculoId} -> PK ${veiculoId}`);
            } else {
                // Se não é server_id, pode ser PK local
                const veiculoByPk = await databaseService.getFirst<LocalVeiculo>(
                    `SELECT * FROM veiculos_os WHERE id = ?`,
                    [data.veiculoId]
                );
                if (veiculoByPk) {
                    veiculoId = veiculoByPk.id;
                    veiculoLocalId = veiculoByPk.local_id;
                    console.log(`[PecaModel] 🔗 Vinculado via PK local ${data.veiculoId} -> LocalId ${veiculoLocalId}`);
                }
            }
        }


        if (!veiculoId) {
            console.warn('[PecaModel] ⚠️ Could not resolve veiculo_id for peca. It will be orphaned!');
        }

        // Simpler lookup via VeiculoModel methods if implementation matches
        // For now, let's assume caller provides valid IDs or we rely on sync

        // Nome da peça - DEVE vir do TipoPeca ou ser passado
        // Como AddPecaRequest tem tipoPecaId, precisariamos buscar o nome do tipo
        // Mas por simplicidade, vamos deixar null ou buscar se possível.
        // O app online resolve isso no backend. Offline precisaria do catalogo.
        let nomePeca = '';
        if (data.tipoPecaId) {
            const { TiposPecaModel } = require('./TiposPecaModel');
            const tipos = await TiposPecaModel.getAll();
            const tipo = tipos.find((t: any) => t.id === data.tipoPecaId);
            if (tipo) nomePeca = tipo.nome;
        }


        const id = await databaseService.runInsert(
            `INSERT INTO pecas_os (
        local_id, server_id, version, veiculo_id, veiculo_local_id,
        tipo_peca_id, nome_peca, valor_cobrado, descricao,
        sync_status, updated_at, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CREATE', ?, ?, ?)`,
            [
                localId,
                null, // server_id
                1,
                veiculoId,
                veiculoLocalId,
                data.tipoPecaId,
                nomePeca || 'Peça sem nome', // Fallback
                data.valorCobrado || 0,
                data.descricao || null,
                now,
                now,
                null // deleted_at
            ]
        );

        await this.addToSyncQueue(localId, 'CREATE', { ...data, veiculoLocalId });

        return (await this.getById(id))!;
    },

    async upsertFromServer(peca: any, veiculoLocalId: number): Promise<LocalPeca> {
        const now = Date.now();

        // 1. Tentar buscar por server_id
        let existing = await this.getByServerId(peca.id);

        // 2. Tentar buscar por local_id (UUID)
        if (!existing && peca.localId) {
            existing = await this.getByLocalId(peca.localId);
            console.log(`[PecaModel] 🔗 Matched local record by UUID: ${peca.localId}`);
        }

        // 3. Fallback: Tentar buscar por NOME e VALOR dentro deste veículo
        // Isso resolve se a peça subiu mas o server_id ainda não voltou
        if (!existing && peca.nomePeca) {
            existing = await databaseService.getFirst<LocalPeca>(
                `SELECT * FROM pecas_os WHERE veiculo_id = ? AND nome_peca = ? AND valor_cobrado = ? AND server_id IS NULL`,
                [veiculoLocalId, peca.nomePeca, peca.valorCobrado]
            );
            if (existing) {
                console.log(`[PecaModel] 🛠️ Matched UNSYNCED local peca by Name/Value: ${peca.nomePeca} for Veiculo PK ${veiculoLocalId}`);
            }
        }

        if (existing) {
            // Extrair tipo_peca_id do response da API (pode vir como tipoPecaId ou tipoPeca.id)
            const tipoPecaId = peca.tipoPecaId || peca.tipoPeca?.id || existing.tipo_peca_id || null;

            await databaseService.runUpdate(
                `UPDATE pecas_os SET
          server_id = ?, tipo_peca_id = ?, nome_peca = ?, valor_cobrado = ?, descricao = ?,
          sync_status = 'SYNCED', updated_at = ?, deleted_at = ?
         WHERE id = ?`,
                [peca.id, tipoPecaId, peca.nomePeca || existing.nome_peca, peca.valorCobrado, peca.descricao, now, peca.deletedAt || null, existing.id]
            );
            return (await this.getById(existing.id))!;
        } else {
            const localId = peca.localId || uuidv4();
            // Lazy load to avoid circular dependency
            const { VeiculoModel } = require('./VeiculoModel');

            // Achar veiculo local pelo (PK) veiculoLocalId passado
            const veiculo = await VeiculoModel.getById(veiculoLocalId);
            const veiculoLocalUUID = veiculo?.local_id || null;

            // Extrair tipo_peca_id do response da API
            const tipoPecaId = peca.tipoPecaId || peca.tipoPeca?.id || null;

            const id = await databaseService.runInsert(
                `INSERT INTO pecas_os (
          local_id, server_id, version, veiculo_id, veiculo_local_id,
          tipo_peca_id, nome_peca, valor_cobrado, descricao,
          sync_status, updated_at, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?)`,
                [
                    localId,
                    peca.id,
                    1,
                    veiculoLocalId, // PK Integer
                    veiculoLocalUUID, // UUID string
                    tipoPecaId,
                    peca.nomePeca,
                    peca.valorCobrado,
                    peca.descricao,
                    now,
                    now,
                    peca.deletedAt || null
                ]
            );
            return (await this.getById(id))!;
        }
    },

    /**
     * Adicionar à fila de sync
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        const { SyncQueueModel } = require('./SyncQueueModel'); // Lazy import loop
        await SyncQueueModel.addToQueue({
            entity_type: 'peca',
            entity_local_id: localId,
            operation: operation,
            payload: payload
        });
    },

    /**
     * Marcar como sincronizado
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        console.log(`[PecaModel] markAsSynced: UUID ${localId} → ID ${serverId}`);

        // 1. Atualizar peça com server_id
        await databaseService.runUpdate(
            `UPDATE pecas_os SET server_id = ?, sync_status = 'SYNCED' WHERE local_id = ?`,
            [serverId, localId]
        );

        // 2. Remover da fila de sync
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE resource = 'peca' AND temp_id = ?`,
            [localId]
        );
    },

    /**
     * Deletar peça
     */
    async delete(id: number): Promise<boolean> {
        const existing = await this.getById(id);
        if (!existing) return false;

        if (existing.server_id) {
            // Se já tem no servidor, marcar para deleção remota
            await databaseService.runUpdate(
                `UPDATE pecas_os SET sync_status = 'PENDING_DELETE', updated_at = ? WHERE id = ?`,
                [Date.now(), id]
            );
            await this.addToSyncQueue(existing.local_id, 'DELETE', null);
        } else {
            // Se é apenas local, remover fisicamente
            await databaseService.runDelete(`DELETE FROM pecas_os WHERE id = ?`, [id]);
            await databaseService.runDelete(
                `DELETE FROM sync_queue WHERE resource = 'peca' AND temp_id = ?`,
                [existing.local_id]
            );
        }

        return true;
    }
};
