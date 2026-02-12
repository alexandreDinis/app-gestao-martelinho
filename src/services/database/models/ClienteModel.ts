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
    async getAll(empresaId?: number): Promise<LocalCliente[]> {
        if (empresaId !== undefined && empresaId !== 0) {
            return await databaseService.runQuery<LocalCliente>(
                `SELECT * FROM clientes
                 WHERE empresa_id = ?
                   AND deleted_at IS NULL
                   AND sync_status != 'PENDING_DELETE'
                 ORDER BY razao_social`,
                [empresaId]
            );
        }
        return await databaseService.runQuery<LocalCliente>(
            `SELECT * FROM clientes
             WHERE deleted_at IS NULL
               AND sync_status != 'PENDING_DELETE'
             ORDER BY razao_social`
        );
    },

    /**
     * Obter contagem total de Clientes
     */
    async getCount(): Promise<number> {
        const result = await databaseService.getFirst<{ count: number }>(`SELECT COUNT(*) as count FROM clientes`);
        return result?.count || 0;
    },

    async getCountByEmpresa(empresaId: number): Promise<number> {
        const result = await databaseService.getFirst<{ count: number }>(
            `SELECT COUNT(*) as count FROM clientes WHERE empresa_id = ?`,
            [empresaId]
        );
        return result?.count || 0;
    },

    /**
     * Buscar cliente por ID local
     */
    async getById(id: number): Promise<LocalCliente | null> {
        return await databaseService.getFirst<LocalCliente>(
            `SELECT * FROM clientes WHERE id = ? AND deleted_at IS NULL`,
            [id]
        );
    },

    /**
     * Buscar cliente por server_id
     */
    async getByServerId(serverId: number, empresaId?: number): Promise<LocalCliente | null> {
        if (empresaId !== undefined && empresaId !== 0) {
            return await databaseService.getFirst<LocalCliente>(
                `SELECT * FROM clientes WHERE empresa_id = ? AND server_id = ? AND deleted_at IS NULL LIMIT 1`,
                [empresaId, serverId]
            );
        }
        return await databaseService.getFirst<LocalCliente>(
            `SELECT * FROM clientes WHERE server_id = ? AND deleted_at IS NULL`,
            [serverId]
        );
    },

    /**
     * Buscar cliente por local_id (UUID)
     */
    async getByLocalId(localId: string, empresaId?: number): Promise<LocalCliente | null> {
        if (empresaId !== undefined && empresaId !== 0) {
            return await databaseService.getFirst<LocalCliente>(
                `SELECT * FROM clientes WHERE empresa_id = ? AND local_id = ? AND deleted_at IS NULL LIMIT 1`,
                [empresaId, localId]
            );
        }
        return await databaseService.getFirst<LocalCliente>(
            `SELECT * FROM clientes WHERE local_id = ? AND deleted_at IS NULL`,
            [localId]
        );
    },



    /**
     * Buscar clientes por termo de busca (nome, fantasia, cnpj, cpf)
     */
    async search(termo: string, empresaId?: number): Promise<LocalCliente[]> {
        const searchTerm = `%${termo}%`;
        if (empresaId !== undefined && empresaId !== 0) {
            return await databaseService.runQuery<LocalCliente>(
                `SELECT * FROM clientes
                 WHERE empresa_id = ?
                   AND deleted_at IS NULL
                   AND sync_status != 'PENDING_DELETE'
                   AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR cpf LIKE ?)
                 ORDER BY razao_social
                 LIMIT 50`,
                [empresaId, searchTerm, searchTerm, searchTerm, searchTerm]
            );
        }
        return await databaseService.runQuery<LocalCliente>(
            `SELECT * FROM clientes
             WHERE deleted_at IS NULL
               AND sync_status != 'PENDING_DELETE'
               AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? OR cpf LIKE ?)
             ORDER BY razao_social
             LIMIT 50`,
            [searchTerm, searchTerm, searchTerm, searchTerm]
        );
    },

    /**
     * Criar cliente local (para uso offline)
     */
    async create(data: ClienteRequest & { empresaId?: number }, syncStatus: SyncStatus = 'PENDING_CREATE'): Promise<LocalCliente> {
        const now = Date.now();
        const localId = uuidv4();
        const uuid = localId; // Usando localId como UUID por enquanto ou gerando outro se necessário. O prompt pediu "Adicione colunas... uuid". Vamos usar o mesmo valor de local_id por consistência inicial.

        const id = await databaseService.runInsert(
            `INSERT INTO clientes (
        local_id, uuid, server_id, version, razao_social, nome_fantasia, cnpj, cpf,
        tipo_pessoa, contato, email, status, logradouro, numero, complemento,
        bairro, cidade, estado, cep, sync_status, updated_at, created_at, empresa_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                now,
                data.empresaId || 0
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
        const db = await databaseService.getDatabase();

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
    // ── Helpers (PR3) ──────────────────────────────────────────────

    /**
     * Non-destructive merge: prefere incoming se não for null/undefined.
     * Diferença do || antigo: "" (string vazia) do server AGORA sobrescreve (permite limpar campo).
     */
    pickBest<T>(incoming: T | null | undefined, existing: T | null | undefined): T | null | undefined {
        if (incoming === null || incoming === undefined) return existing;
        return incoming;
    },

    /** ISO string → millis (ou null se inválido). Normaliza LocalDateTime (sem TZ) → UTC. */
    toMillis(iso?: string | null): number | null {
        if (!iso) return null;
        // Se não tiver timezone (LocalDateTime do backend), assumir UTC
        let normalized = iso;
        if (!/[Z+\-]\d{0,2}:?\d{0,2}$/.test(iso)) {
            normalized = iso + 'Z';
        }
        const ms = Date.parse(normalized);
        return Number.isNaN(ms) ? null : ms;
    },

    /** Detecta se o servidor marcou este cliente como deletado */
    isDeletedFromServer(cliente: Cliente): boolean {
        return !!cliente.deletedAt;
    },

    // ── upsertFromServer (PR3 — tombstone + replay + pickBest + tenant) ──

    /**
     * Salvar cliente do servidor no cache local.
     * Cobre todos os gaps de PR3:
     *   Gap 1 — deleted_at / tombstone handling
     *   Gap 3 — lookup tenant-safe (empresa_id)
     *   Gap 4 — pickBest em vez de ||
     *   Gap 5 — replay protection via server_updated_at
     */
    async upsertFromServer(cliente: Cliente): Promise<LocalCliente> {
        const now = Date.now();

        const empresaId = cliente.empresaId ?? 0;
        const serverId = cliente.id;                 // backend PK (number)
        const incomingLocalId = cliente.localId ?? null;

        // 1) Buscar existing — tenant-safe (server_id → local_id fallback)
        let existing: LocalCliente | null = await this.getByServerId(serverId, empresaId);

        if (!existing && incomingLocalId) {
            existing = await this.getByLocalId(incomingLocalId, empresaId);
        }

        // 2) Replay protection (se existir updatedAt do server)
        const incomingServerUpdatedAt = cliente.updatedAt ?? null;
        const incomingMs = this.toMillis(incomingServerUpdatedAt);
        const existingMs = this.toMillis(existing?.server_updated_at ?? null);

        if (existing && incomingMs != null && existingMs != null && incomingMs <= existingMs) {
            console.log(`[ClienteModel] ⏭️ Replay ignored for server_id=${serverId} (remote=${incomingServerUpdatedAt} <= local=${existing.server_updated_at})`);
            return existing;
        }

        // 3) Tombstone handling (soft delete)
        if (this.isDeletedFromServer(cliente)) {
            if (existing) {
                console.log(`[ClienteModel] 🪦 Tombstone: marking local id=${existing.id} as deleted`);
                await databaseService.runUpdate(
                    `UPDATE clientes SET
                       deleted_at = ?,
                       server_updated_at = ?,
                       status = ?,
                       server_id = ?,
                       local_id = COALESCE(local_id, ?),
                       sync_status = 'SYNCED',
                       last_synced_at = ?,
                       updated_at = ?,
                       empresa_id = ?
                     WHERE id = ?`,
                    [
                        cliente.deletedAt ?? new Date().toISOString(),
                        incomingServerUpdatedAt ?? existing.server_updated_at ?? null,
                        cliente.status || existing.status,
                        serverId,
                        incomingLocalId,
                        now,
                        now,
                        empresaId,
                        existing.id
                    ]
                );
                return (await this.getById(existing.id))!;
            }

            // Não existe localmente → ignorar tombstone (não precisa inserir registro deletado)
            console.log(`[ClienteModel] 🪦 Tombstone para server_id=${serverId} ignorado (sem registro local)`);
            return {
                id: 0,
                local_id: incomingLocalId ?? '',
                server_id: serverId,
                version: 0,
                razao_social: cliente.razaoSocial ?? 'DELETED',
                nome_fantasia: null,
                cnpj: null,
                cpf: null,
                tipo_pessoa: null,
                contato: null,
                email: null,
                status: cliente.status || 'INATIVO',
                logradouro: null, numero: null, complemento: null,
                bairro: null, cidade: null, estado: null, cep: null,
                empresa_id: empresaId,
                deleted_at: cliente.deletedAt ?? new Date().toISOString(),
                server_updated_at: incomingServerUpdatedAt,
                sync_status: 'SYNCED',
                last_synced_at: now,
                updated_at: now,
                created_at: now,
            } as LocalCliente;
        }

        // 4) Se existe: respeitar pendências locais (como antes)
        if (existing) {
            console.log(`[ClienteModel] Encontrado local: id=${existing.id}, sync_status=${existing.sync_status}, nome=${existing.razao_social}`);

            if (existing.sync_status !== 'SYNCED') {
                const isReallyPending = await SyncQueueModel.hasPending('cliente', existing.local_id);
                if (isReallyPending) {
                    console.log(`[ClienteModel] 🛡️ Ignorando update do servidor para cliente ${existing.id} (status: ${existing.sync_status}, queue: YES)`);
                    return existing;
                }
                console.log(`[ClienteModel] 🧟 Zombie detected! Status ${existing.sync_status} but not in Queue. Overwriting with Server data.`);
            }

            // 5) Merge não destrutivo (pickBest corrige o || antigo)
            const razaoSocial = this.pickBest(cliente.razaoSocial, existing.razao_social);
            const nomeFantasia = this.pickBest(cliente.nomeFantasia, existing.nome_fantasia);
            const cnpj = this.pickBest(cliente.cnpj, existing.cnpj);
            const cpf = this.pickBest(cliente.cpf, existing.cpf);
            const logradouro = this.pickBest(cliente.logradouro, existing.logradouro);
            const numero = this.pickBest(cliente.numero, existing.numero);
            const complemento = this.pickBest(cliente.complemento, existing.complemento);
            const bairro = this.pickBest(cliente.bairro, existing.bairro);
            const cidade = this.pickBest(cliente.cidade, existing.cidade);
            const estado = this.pickBest(cliente.estado, existing.estado);
            const cep = this.pickBest(cliente.cep, existing.cep);

            await databaseService.runUpdate(
                `UPDATE clientes SET
                   server_id = ?,
                   server_updated_at = ?,
                   deleted_at = NULL,
                   razao_social = ?, nome_fantasia = ?, cnpj = ?, cpf = ?,
                   tipo_pessoa = ?, contato = ?, email = ?, status = ?,
                   logradouro = ?, numero = ?, complemento = ?, bairro = ?,
                   cidade = ?, estado = ?, cep = ?,
                   sync_status = 'SYNCED', last_synced_at = ?, updated_at = ?, empresa_id = ?,
                   local_id = COALESCE(local_id, ?)
                 WHERE id = ?`,
                [
                    serverId,
                    incomingServerUpdatedAt ?? existing.server_updated_at ?? null,
                    razaoSocial,
                    nomeFantasia,
                    cnpj,
                    cpf,
                    this.pickBest(cliente.tipoPessoa, existing.tipo_pessoa),
                    this.pickBest(cliente.contato, existing.contato),
                    this.pickBest(cliente.email, existing.email),
                    this.pickBest(cliente.status, existing.status),
                    logradouro,
                    numero,
                    complemento,
                    bairro,
                    cidade,
                    estado,
                    cep,
                    now,
                    now,
                    empresaId,
                    incomingLocalId,
                    existing.id
                ]
            );
            return (await this.getById(existing.id))!;
        }

        // 6) Não existe: INSERT (com empresa_id + server_updated_at + deleted_at NULL)
        const localId = incomingLocalId || uuidv4();
        const uuid = localId;

        const id = await databaseService.runInsert(
            `INSERT INTO clientes (
               local_id, uuid, server_id, version,
               razao_social, nome_fantasia, cnpj, cpf,
               tipo_pessoa, contato, email, status,
               logradouro, numero, complemento, bairro, cidade, estado, cep,
               deleted_at, server_updated_at,
               sync_status, last_synced_at, updated_at, created_at,
               empresa_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                localId, uuid, serverId, 1,
                cliente.razaoSocial, cliente.nomeFantasia ?? null,
                cliente.cnpj ?? null, cliente.cpf ?? null,
                cliente.tipoPessoa ?? null, cliente.contato, cliente.email, cliente.status,
                cliente.logradouro ?? null, cliente.numero ?? null, cliente.complemento ?? null,
                cliente.bairro ?? null, cliente.cidade ?? null, cliente.estado ?? null, cliente.cep ?? null,
                null, incomingServerUpdatedAt,
                'SYNCED', now, now, now,
                empresaId
            ]
        );
        return (await this.getById(id))!;
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
