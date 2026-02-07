// src/services/database/models/ClienteModel.ts
// Model para operações CRUD de Clientes no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalCliente, SyncStatus, SYNC_PRIORITIES } from './types';
import type { Cliente, ClienteRequest } from '../../../types';
import { SyncQueueModel } from './SyncQueueModel';

export const ClienteModel = {
    /**
     * Buscar todos os clientes locais
     */
    async getAll(): Promise<LocalCliente[]> {
        return await databaseService.runQuery<LocalCliente>(
            `SELECT * FROM clientes WHERE sync_status != 'PENDING_DELETE' ORDER BY razao_social`
        );
    },

    /**
     * Buscar cliente por ID local
     */
    async getById(id: number): Promise<LocalCliente | null> {
        return await databaseService.getFirst<LocalCliente>(
            `SELECT * FROM clientes WHERE id = ?`,
            [id]
        );
    },

    /**
     * Buscar cliente por server_id
     */
    async getByServerId(serverId: number): Promise<LocalCliente | null> {
        return await databaseService.getFirst<LocalCliente>(
            `SELECT * FROM clientes WHERE server_id = ?`,
            [serverId]
        );
    },

    /**
     * Buscar cliente por local_id (UUID)
     */
    async getByLocalId(localId: string): Promise<LocalCliente | null> {
        return await databaseService.getFirst<LocalCliente>(
            `SELECT * FROM clientes WHERE local_id = ?`,
            [localId]
        );
    },



    /**
     * Buscar clientes por termo de busca (nome, fantasia, cnpj, cpf)
     */
    async search(termo: string): Promise<LocalCliente[]> {
        const searchTerm = `%${termo}%`;
        return await databaseService.runQuery<LocalCliente>(
            `SELECT * FROM clientes 
       WHERE sync_status != 'PENDING_DELETE'
       AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR cpf LIKE ?)
       ORDER BY razao_social
       LIMIT 50`,
            [searchTerm, searchTerm, searchTerm, searchTerm]
        );
    },

    /**
     * Criar cliente local (para uso offline)
     */
    async create(data: ClienteRequest, syncStatus: SyncStatus = 'PENDING_CREATE'): Promise<LocalCliente> {
        const now = Date.now();
        const localId = uuidv4();
        const uuid = localId; // Usando localId como UUID por enquanto ou gerando outro se necessário. O prompt pediu "Adicione colunas... uuid". Vamos usar o mesmo valor de local_id por consistência inicial.

        const id = await databaseService.runInsert(
            `INSERT INTO clientes (
        local_id, uuid, server_id, version, razao_social, nome_fantasia, cnpj, cpf,
        tipo_pessoa, contato, email, status, logradouro, numero, complemento,
        bairro, cidade, estado, cep, sync_status, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                localId,
                uuid,
                null, // server_id
                1, // version
                data.razaoSocial,
                data.nomeFantasia || null,
                data.cnpj || null,
                data.cpf || null,
                data.tipoPessoa || null,
                data.contato,
                data.email,
                data.status,
                data.logradouro || null,
                data.numero || null,
                data.complemento || null,
                data.bairro || null,
                data.cidade || null,
                data.estado || null,
                data.cep || null,
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
     * Salvar múltiplos clientes do servidor no cache local (Batch)
     */
    async upsertBatch(clientes: Cliente[]): Promise<void> {
        const db = databaseService.getDatabase();

        // 🚀 PERFORMANCE: Chunked processing to prevent locks during large syncs
        const CHUNK_SIZE = 20; // Clientes são mais leves que OS, podemos usar batch maior

        for (let i = 0; i < clientes.length; i += CHUNK_SIZE) {
            const chunk = clientes.slice(i, i + CHUNK_SIZE);
            console.log(`[ClienteModel] Processing batch chunk ${i / CHUNK_SIZE + 1} (${chunk.length} items)...`);

            await db.withTransactionAsync(async () => {
                for (const cliente of chunk) {
                    await this.upsertFromServer(cliente);
                }
            });

            // ⏳ YIELD to Event Loop
            if (i + CHUNK_SIZE < clientes.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    },
    /**
         * Salvar cliente do servidor no cache local
         */
    async upsertFromServer(cliente: Cliente): Promise<LocalCliente> {
        const now = Date.now();
        // console.log(`[ClienteModel] upsertFromServer: Buscando cliente server_id=${cliente.id} ou localId=${cliente.localId}`);

        // 1. Tentar buscar por server_id
        let existing = await this.getByServerId(cliente.id);

        // 2. Fallback: Tentar buscar pelo localId (identidade offline) se fornecido
        if (!existing && cliente.localId) {
            existing = await this.getByLocalId(cliente.localId);
            if (existing) {
                // console.log(`[ClienteModel] Cliente encontrado via localId: ${cliente.localId} (sem server_id vinculado ainda)`);
            }
        }

        if (existing) {
            console.log(`[ClienteModel] Encontrado local: id=${existing.id}, sync_status=${existing.sync_status}, nome=${existing.razao_social}`);

            // 🛡️ SEGURANÇA: Não sobrescrever se houver alterações locais pendentes
            if (existing.sync_status !== 'SYNCED') {
                // Zombie Check: Se status é PENDING mas não está na fila, é um estado inconsistente e devemos aceitar o server
                const isReallyPending = await SyncQueueModel.hasPending('cliente', existing.local_id);

                if (isReallyPending) {
                    console.log(`[ClienteModel] 🛡️ Ignorando update do servidor para cliente ${existing.id} (status: ${existing.sync_status}, queue: YES)`);
                    return existing;
                } else {
                    console.log(`[ClienteModel] 🧟 Zombie detected! Status ${existing.sync_status} but not in Queue (or Dead). Overwriting with Server data.`);
                }
            }

            // console.log(`[ClienteModel] Sobrescrevendo cliente ${existing.id} com dados do servidor`);

            // 🛡️ INTELLIGENT MERGE: Não apagar dados locais (como endereço) se o server mandar null (comum em sync de OS)
            const razaoSocial = cliente.razaoSocial || existing.razao_social;
            const nomeFantasia = cliente.nomeFantasia || existing.nome_fantasia;
            const cnpj = cliente.cnpj || existing.cnpj;
            const cpf = cliente.cpf || existing.cpf;
            const logradouro = cliente.logradouro || existing.logradouro;
            const numero = cliente.numero || existing.numero;
            const complemento = cliente.complemento || existing.complemento;
            const bairro = cliente.bairro || existing.bairro;
            const cidade = cliente.cidade || existing.cidade;
            const estado = cliente.estado || existing.estado;
            const cep = cliente.cep || existing.cep;

            // Atualizar existente
            await databaseService.runUpdate(
                `UPDATE clientes SET
          server_id = ?, 
          razao_social = ?, nome_fantasia = ?, cnpj = ?, cpf = ?,
          tipo_pessoa = ?, contato = ?, email = ?, status = ?,
          logradouro = ?, numero = ?, complemento = ?, bairro = ?,
          cidade = ?, estado = ?, cep = ?,
          sync_status = 'SYNCED', last_synced_at = ?, updated_at = ?
         WHERE id = ?`,
                [
                    cliente.id,
                    razaoSocial,
                    nomeFantasia,
                    cnpj,
                    cpf,
                    cliente.tipoPessoa || existing.tipo_pessoa,
                    cliente.contato || existing.contato,
                    cliente.email || existing.email,
                    cliente.status || existing.status,
                    logradouro,
                    numero,
                    complemento,
                    bairro,
                    cidade,
                    estado,
                    cep,
                    now,
                    now,
                    existing.id
                ]
            );
            return (await this.getById(existing.id))!;
        } else {
            // Inserir novo
            const localId = cliente.localId || uuidv4(); // Usar o localId vindo do server se existir, senão novo
            const uuid = localId;

            const id = await databaseService.runInsert(
                `INSERT INTO clientes (
          local_id, uuid, server_id, version, razao_social, nome_fantasia, cnpj, cpf,
          tipo_pessoa, contato, email, status, logradouro, numero, complemento,
          bairro, cidade, estado, cep, sync_status, last_synced_at, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    localId,
                    uuid,
                    cliente.id,
                    1,
                    cliente.razaoSocial,
                    cliente.nomeFantasia || null,
                    cliente.cnpj || null,
                    cliente.cpf || null,
                    cliente.tipoPessoa || null,
                    cliente.contato,
                    cliente.email,
                    cliente.status,
                    cliente.logradouro || null,
                    cliente.numero || null,
                    cliente.complemento || null,
                    cliente.bairro || null,
                    cliente.cidade || null,
                    cliente.estado || null,
                    cliente.cep || null,
                    'SYNCED', // sync_status
                    now,
                    now,
                    now
                ]
            );
            return (await this.getById(id))!;
        }
    },

    /**
     * Atualizar cliente local
     */
    async update(id: number, data: Partial<ClienteRequest>): Promise<LocalCliente | null> {
        const existing = await this.getById(id);
        if (!existing) return null;

        const now = Date.now();
        const newVersion = existing.version + 1;

        // 1. Atualizar banco local
        await databaseService.runUpdate(
            `UPDATE clientes SET
        razao_social = COALESCE(?, razao_social),
        nome_fantasia = COALESCE(?, nome_fantasia),
        cnpj = COALESCE(?, cnpj),
        cpf = COALESCE(?, cpf),
        tipo_pessoa = COALESCE(?, tipo_pessoa),
        contato = COALESCE(?, contato),
        email = COALESCE(?, email),
        status = COALESCE(?, status),
        logradouro = COALESCE(?, logradouro),
        numero = COALESCE(?, numero),
        complemento = COALESCE(?, complemento),
        bairro = COALESCE(?, bairro),
        cidade = COALESCE(?, cidade),
        estado = COALESCE(?, estado),
        cep = COALESCE(?, cep),
        version = ?,
        sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_UPDATE' ELSE sync_status END,
        updated_at = ?
       WHERE id = ?`,
            [
                data.razaoSocial,
                data.nomeFantasia,
                data.cnpj,
                data.cpf,
                data.tipoPessoa,
                data.contato,
                data.email,
                data.status,
                data.logradouro,
                data.numero,
                data.complemento,
                data.bairro,
                data.cidade,
                data.estado,
                data.cep,
                newVersion,
                now,
                id
            ]
        );

        // 2. Buscar objeto atualizado para garantir payload completo
        const updatedLocal = await this.getById(id);
        if (!updatedLocal) return null;

        const fullPayload = this.toApiFormat(updatedLocal);

        // 3. Atualizar/Inserir na Fila de Sync
        // Se já estava PENDING_CREATE, manter como CREATE mas com dados novos
        // Se estava SYNCED ou PENDING_UPDATE, tratar como UPDATE com dados completos
        const action = existing.sync_status === 'PENDING_CREATE' ? 'CREATE' : 'UPDATE';

        await this.addToSyncQueue(existing.local_id, action, fullPayload);

        return updatedLocal;
    },

    /**
     * Marcar cliente para deleção
     */
    async delete(id: number): Promise<boolean> {
        const existing = await this.getById(id);
        if (!existing) return false;

        if (existing.server_id) {
            // Tem no servidor, marcar para deleção remota
            await databaseService.runUpdate(
                `UPDATE clientes SET sync_status = 'PENDING_DELETE', updated_at = ? WHERE id = ?`,
                [Date.now(), id]
            );
            await this.addToSyncQueue(existing.local_id, 'DELETE', null);
        } else {
            // Apenas local, pode deletar direto
            await databaseService.runDelete(`DELETE FROM clientes WHERE id = ?`, [id]);
            // Remover da fila de sync
            await databaseService.runDelete(
                `DELETE FROM sync_queue WHERE entity_type = 'cliente' AND entity_local_id = ?`,
                [existing.local_id]
            );
        }

        return true;
    },

    /**
     * Obter clientes pendentes de sincronização
     */
    async getPendingSync(): Promise<LocalCliente[]> {
        return await databaseService.runQuery<LocalCliente>(
            `SELECT * FROM clientes WHERE sync_status IN ('PENDING_CREATE', 'PENDING_UPDATE', 'PENDING_DELETE')`
        );
    },

    /**
     * Marcar como sincronizado após envio bem-sucedido
     */
    async markAsSynced(localId: string, serverId: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE clientes SET 
        server_id = ?, 
        sync_status = 'SYNCED', 
        last_synced_at = ? 
       WHERE local_id = ?`,
            [serverId, Date.now(), localId]
        );

        // Remover da fila de sync
        await databaseService.runDelete(
            `DELETE FROM sync_queue WHERE resource = 'cliente' AND temp_id = ?`,
            [localId]
        );
    },

    /**
     * Marcar como erro de sincronização
     */
    async markAsSyncError(localId: string, errorMessage: string): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE clientes SET sync_status = 'ERROR' WHERE local_id = ?`,
            [localId]
        );

        await databaseService.runUpdate(
            `UPDATE sync_queue SET error_message = ? WHERE resource = 'cliente' AND temp_id = ?`,
            [errorMessage, localId]
        );
    },

    /**
     * Adicionar à fila de sincronização
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        const now = Date.now();

        // Verificar se já existe na fila (usando novo schema)
        const existing = await databaseService.getFirst<{ id: number }>(
            `SELECT id FROM sync_queue WHERE resource = 'cliente' AND temp_id = ? AND status = 'PENDING'`,
            [localId]
        );

        if (existing) {
            // Atualizar operação existente
            await databaseService.runUpdate(
                `UPDATE sync_queue SET action = ?, payload = ?, created_at = ?, attempts = 0 WHERE id = ?`,
                [operation, payload ? JSON.stringify(payload) : null, now, existing.id]
            );
        } else {
            // Inserir nova
            await databaseService.runInsert(
                `INSERT INTO sync_queue (resource, temp_id, action, payload, status, created_at, attempts)
          VALUES ('cliente', ?, ?, ?, 'PENDING', ?, 0)`,
                [localId, operation, payload ? JSON.stringify(payload) : null, now]
            );
        }
    },

    /**
     * Converter de LocalCliente para Cliente (formato da API)
     */
    toApiFormat(local: LocalCliente): Cliente {
        return {
            id: local.server_id || local.id,
            razaoSocial: local.razao_social,
            nomeFantasia: local.nome_fantasia || '',
            cnpj: local.cnpj || undefined,
            cpf: local.cpf || undefined,
            tipoPessoa: local.tipo_pessoa as any,
            contato: local.contato || '',
            email: local.email || '',
            status: local.status as any,
            logradouro: local.logradouro || undefined,
            numero: local.numero || undefined,
            complemento: local.complemento || undefined,
            bairro: local.bairro || undefined,
            cidade: local.cidade || undefined,
            estado: local.estado || undefined,
            cep: local.cep || undefined,
        };
    }
};
