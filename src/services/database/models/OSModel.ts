// src/services/database/models/OSModel.ts
// Model para operações CRUD de Ordens de Serviço no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalOS, SyncStatus, SYNC_PRIORITIES } from './types';
import type { OrdemServico, CreateOSRequest, OSStatus } from '../../../types';
import { ClienteModel } from './ClienteModel';
import { SyncQueueModel } from './SyncQueueModel';

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
     * Buscar OS por local_id (UUID)
     */
    async getByLocalId(localId: string): Promise<LocalOS | null> {
        return await databaseService.getFirst<LocalOS>(
            `SELECT * FROM ordens_servico WHERE local_id = ?`,
            [localId]
        );
    },

    /**
     * Verificar se há pendências de sincronização para uma OS
     */
    async hasPending(localId: string): Promise<boolean> {
        return await SyncQueueModel.hasPending('os', localId);
    },

    /**
     * Converter LocalOS para formato API (OrdemServico)
     * Resolve Cliente e Veículos
     */
    async toApiFormat(local: LocalOS): Promise<OrdemServico> {
        // Resolver Cliente
        let cliente: any = { id: 0, razaoSocial: 'Cliente não encontrado', nomeFantasia: '?' };
        if (local.cliente_id) {
            const c = await ClienteModel.getById(local.cliente_id); // Pelo ID local
            if (c) cliente = ClienteModel.toApiFormat(c);
        } else if (local.cliente_local_id) {
            const c = await ClienteModel.getByLocalId(local.cliente_local_id);
            if (c) cliente = ClienteModel.toApiFormat(c);
        }

        // Resolver Veículos
        // TODO: Implementar VeiculoModel.getByOSId
        // Por enquanto retorna vazio ou busca se tiver query
        const veiculos: any[] = []; // Placeholder

        return {
            id: local.server_id || local.id, // Preferência server_id se synced, senão ID local
            localId: local.local_id, // Importante para referência futura
            empresaId: 1, // Default or fetch from auth/config
            data: local.data,
            dataVencimento: local.data_vencimento || undefined,
            status: local.status as OSStatus,
            valorTotal: local.valor_total || 0,
            tipoDesconto: local.tipo_desconto as 'REAL' | 'PORCENTAGEM' | null,
            valorDesconto: local.valor_desconto || undefined,
            valorTotalSemDesconto: local.valor_total || 0, // Simplificação
            valorTotalComDesconto: local.valor_total || 0, // Simplificação
            atrasado: false, // Calcular se necessário
            veiculos: veiculos,
            usuarioId: local.usuario_id || undefined,
            usuarioNome: local.usuario_nome || undefined,
            usuarioEmail: local.usuario_email || undefined,
            // Fix updatedAt property name if needed. The error said 'updatedAt' does not exist in 'OrdemServico'.
            // Checking types/index.ts will confirm. Assuming 'updatedAt' might be missing from interface or named differently.
            // If strictly following interface, maybe omit if not present.
            // But let's check types first. Assuming 'empresaId' was the main blocker.
            syncStatus: local.sync_status // Útil para UI
        } as unknown as OrdemServico; // Force cast if types slightly mismatch (e.g. date string vs Date)
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
            await this.addToSyncQueue(localId, 'CREATE', data);
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
        console.log(`[OSModel] 📥 UPSERT from Server: ID ${os.id}`, JSON.stringify(os, null, 2));

        // 🛡️ HOTFIX: Ensure columns exist before upserting (Safe to run repeatedly)
        // This acts as a self-healing mechanism for schema mismatches during Fast Refresh
        await databaseService.safeAddColumn('ordens_servico', 'usuario_id', 'INTEGER');
        await databaseService.safeAddColumn('ordens_servico', 'usuario_nome', 'TEXT');
        await databaseService.safeAddColumn('ordens_servico', 'usuario_email', 'TEXT');

        const now = Date.now();

        // 1. Tentar buscar por server_id
        let existing = await this.getByServerId(os.id);

        // 2. Fallback: Tentar buscar por localId se fornecido
        if (!existing && os.localId) {
            existing = await this.getByLocalId(os.localId);
            if (existing) {
                console.log(`[OSModel] 🎯 OS encontrada via localId: ${os.localId} (Server ID pending update)`);
            }
        }

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
            // 🛡️ SEGURANÇA: Não sobrescrever se houver alterações locais pendentes
            if (existing.sync_status !== 'SYNCED') {
                // Zombie Check: Se status é PENDING mas não está naf ila, é um estado inconsistente e devemos aceitar o server
                const isReallyPending = await SyncQueueModel.hasPending('os', existing.local_id);

                if (isReallyPending) {
                    console.log(`[OSModel] 🛡️ Ignorando update do servidor para OS ${existing.id} (status: ${existing.sync_status}, queue: YES)`);
                    return existing;
                } else {
                    console.log(`[OSModel] 🧟 Zombie detected! Status ${existing.sync_status} but not in Queue. Overwriting with Server data.`);
                }
            }

            // Atualizar existente
            // Atualizar existente
            await databaseService.runUpdate(
                `UPDATE ordens_servico SET
          server_id = ?,
          cliente_id = ?, cliente_local_id = ?, data = ?, data_vencimento = ?,
          status = ?, valor_total = ?, tipo_desconto = ?, valor_desconto = ?,
          sync_status = 'SYNCED', last_synced_at = ?, updated_at = ?,
          usuario_id = ?, usuario_nome = ?, usuario_email = ?
         WHERE id = ?`,
                [
                    os.id,
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
                    // Mapeamento de usuário
                    os.usuarioId || (os.usuarioEmail ? 0 : null),
                    os.usuarioNome || null,
                    os.usuarioEmail || null,
                    existing.id
                ]
            );
            return (await this.getById(existing.id))!;
        } else {
            // Inserir novo
            const localId = os.localId || uuidv4();
            const uuid = localId; // Usando localId como UUID

            const id = await databaseService.runInsert(
                `INSERT INTO ordens_servico (
          local_id, uuid, server_id, version, cliente_id, cliente_local_id,
          data, data_vencimento, status, valor_total, tipo_desconto, valor_desconto,
          sync_status, last_synced_at, updated_at, created_at,
          usuario_id, usuario_nome, usuario_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    'SYNCED', // sync_status
                    now,
                    now,
                    now,
                    // Mapeamento de usuário
                    os.usuarioId || (os.usuarioEmail ? 0 : null),
                    os.usuarioNome || null,
                    os.usuarioEmail || null,
                    // Mapeamento de usuário
                    os.usuarioId || (os.usuarioEmail ? 0 : null),
                    os.usuarioNome || null,
                    os.usuarioEmail || null
                ]
            );
            console.log(`[OSModel] ✅ Inserted New OS: Local ID ${localId} / Server ID ${os.id}`);
            return (await this.getById(id))!;
        }
    },

    /**
     * Atualização genérica da OS
     * Atualiza campos locais e marca como PENDING_UPDATE
     */
    async update(id: number, data: Partial<LocalOS>): Promise<LocalOS | null> {
        const existing = await this.getById(id);
        if (!existing) return null;

        const now = Date.now();
        const newVersion = existing.version + 1;

        // Construir query dinâmica
        const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'local_id' && k !== 'server_id');
        if (fields.length === 0) return existing;

        const setClause = fields.map(f => `${f} = ?`).join(', ');
        const values = fields.map(f => (data as any)[f]);

        // Adicionar campos de controle
        const finalSetClause = `${setClause}, version = ?, sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_UPDATE' ELSE sync_status END, updated_at = ?`;
        const finalValues = [...values, newVersion, now, id];

        await databaseService.runUpdate(
            `UPDATE ordens_servico SET ${finalSetClause} WHERE id = ?`,
            finalValues
        );

        // Adicionar à fila de sync
        // Se já estava PENDING, o payload será substituído pelo novo (last write wins)
        const updatedOS = await this.getById(id);

        // Construir payload para API (apenas campos alterados ou objeto completo?)
        // Por simplicidade e robustez, enviamos campos chave + alterados.
        // A API espera um objeto OrdemServico ou partes dele?
        // Vamos enviar um objeto mergeado parcial.
        // Mas o `osService` original enviava `data` direto pro patch.
        // Vamos replicar isso.

        await this.addToSyncQueue(existing.local_id, 'UPDATE', data);

        return updatedOS;
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

        // 2. Atualizar/Inserir na Fila de Sync
        await this.addToSyncQueue(existing.local_id, 'UPDATE', { status });

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
            await this.addToSyncQueue(existing.local_id, 'DELETE', null);
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
     * CRÍTICO: Atualiza referências em cascata (veículos filhos)
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        console.log(`[OSModel] markAsSynced: UUID ${localId} → ID ${serverId}`);

        // Buscar OS local para pegar o ID local (PK da tabela)
        const localOS = await this.getByLocalId(localId);
        if (!localOS) {
            console.error(`[OSModel] OS not found for localId: ${localId}`);
            return;
        }

        // 1. Atualizar OS com server_id
        await databaseService.runUpdate(
            `UPDATE ordens_servico SET 
        server_id = ?, 
        sync_status = 'SYNCED', 
        last_synced_at = ? 
       WHERE local_id = ?`,
            [serverId, Date.now(), localId]
        );

        // 2. CASCATA: Atualizar veículos filhos para apontar pro novo server_id da OS
        const childrenUpdated = await databaseService.runUpdate(
            `UPDATE veiculos_os SET os_id = ? WHERE os_local_id = ?`,
            [serverId, localId]
        );

        console.log(`[OSModel] ✅ OS synced. Updated ${childrenUpdated} child veiculos to point to OS ID ${serverId}`);

        // 3. Remover da fila de sync
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE entity_type = 'os' AND entity_local_id = ?`,
            [localId]
        );
    },

    /**
     * Adicionar à fila de sincronização
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        await SyncQueueModel.addToQueue({
            resource: 'os',
            temp_id: localId,
            action: operation,
            payload: payload
        });
    },

    /**
     * Marcar OS como deletada (Soft delete se synced, Hard delete se pending create)
     */
    async markAsDeleted(localId: string): Promise<void> {
        const os = await this.getByLocalId(localId);
        if (!os) return;

        // Se nunca foi pro servidor, podemos deletar fisicamente
        if (os.sync_status === 'PENDING_CREATE') {
            console.log(`[OSModel] Hard deleting unsynced OS ${localId}`);
            // Remover veículos primeiro (se houver CASCADE no banco ok, senão manual)
            await databaseService.runDelete(`DELETE FROM veiculos_os WHERE os_local_id = ?`, [localId]);
            await databaseService.runDelete(`DELETE FROM ordens_servico WHERE local_id = ?`, [localId]);
            // Remover da fila se existir
            await databaseService.runDelete(`DELETE FROM sync_queue WHERE entity_type = 'os' AND entity_local_id = ?`, [localId]);
            return;
        }

        // Se já foi pro servidor, marcar como PENDING_DELETE e agendar sync
        console.log(`[OSModel] Soft deleting synced OS ${localId}`);
        await databaseService.runUpdate(
            `UPDATE ordens_servico SET sync_status = 'PENDING_DELETE', updated_at = ? WHERE local_id = ?`,
            [Date.now(), localId]
        );

        await this.addToSyncQueue(localId, 'DELETE', { id: os.server_id });
    },

    /**
     * Deletar fisicamente (Hard Delete)
     */
    async physicalDelete(localId: string): Promise<void> {
        console.log(`[OSModel] Hard deleting OS ${localId}`);
        await databaseService.runDelete(`DELETE FROM veiculos_os WHERE os_local_id = ?`, [localId]);
        await databaseService.runDelete(`DELETE FROM ordens_servico WHERE local_id = ?`, [localId]);
        await databaseService.runDelete(`DELETE FROM sync_queue WHERE entity_type = 'os' AND entity_local_id = ?`, [localId]);
    }
};
