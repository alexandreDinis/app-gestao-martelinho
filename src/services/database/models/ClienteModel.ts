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
                `SELECT DISTINCT * FROM clientes
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
            `SELECT DISTINCT * FROM clientes
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
        const uuid = localId; // Usando localId como UUID por enquanto
        const correlationId = localId; // Definitive: correlation_id = local_id

        const id = await databaseService.runInsert(
            `INSERT INTO clientes (
        local_id, uuid, correlation_id, server_id, version, razao_social, nome_fantasia, cnpj, cpf,
        tipo_pessoa, contato, email, status, logradouro, numero, complemento,
        bairro, cidade, estado, cep, sync_status, updated_at, created_at, empresa_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                localId,
                uuid,
                correlationId,
                null, // server_id
                1, // version
                data.razaoSocial,
                data.nomeFantasia || null,
                this.normalizeCnpjCpf(data.cnpj), // Salvar NORMALIZADO
                this.normalizeCnpjCpf(data.cpf),  // Salvar NORMALIZADO
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
     */
    pickBest<T>(incoming: T | null | undefined, existing: T | null | undefined): T | null | undefined {
        if (incoming === null || incoming === undefined) return existing;
        return incoming;
    },

    /** ISO string → millis (ou null se inválido). Normaliza LocalDateTime (sem TZ) → UTC. */
    toMillis(iso?: string | null): number | null {
        if (!iso) return null;
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

    /**
     * Remove caracteres não numéricos de CNPJ/CPF
     */
    normalizeCnpjCpf(value?: string | null): string | null {
        if (!value) return null;
        const nums = value.replace(/\D/g, '');
        return nums.length > 0 ? nums : null;
    },

    /**
     * Salvar cliente do servidor no cache local.
     * Lógica DEFINITIVA de prevenção de duplicatas:
     * 1. Busca por server_id (strict number)
     * 2. Busca por Correlation ID (local_id/uuid) - "Anonymous Match"
     * 3. Busca por CNPJ/CPF normalizado (se válido: 11 ou 14 dígitos)
     * 4. Update se encontrar, Insert se não.
     */
    async upsertFromServer(data: Cliente): Promise<LocalCliente> {
        try {
            // Strict number conversion for serverId
            const serverId = typeof data.id === 'string' ? parseInt(data.id, 10) : data.id;

            // 1️⃣ Tentativa 1: Match por server_id (Strict)
            let existing = await databaseService.getFirst<LocalCliente>(
                `SELECT * FROM clientes WHERE server_id = ? LIMIT 1`,
                [serverId]
            );

            if (existing) {
                console.log(`[ClienteModel] ✅ MATCH por server_id: ${serverId} -> UPDATE local_id: ${existing.local_id}`);
            }

            // 2️⃣ Tentativa 2: Match por Correlation ID (local_id via uuid column)
            if (!existing) {
                // O backend pode retornar 'correlationId' ou 'localId' no payload
                const correlationId = (data as any).correlationId || (data as any).localId;
                if (correlationId) {
                    existing = await databaseService.getFirst<LocalCliente>(
                        `SELECT * FROM clientes WHERE correlation_id = ? LIMIT 1`,
                        [correlationId]
                    );
                    // Fallback para local_id se migration V9 recém rodou e não houve tempo de update (incomum, mas seguro)
                    if (!existing) {
                        existing = await databaseService.getFirst<LocalCliente>(
                            `SELECT * FROM clientes WHERE local_id = ? AND server_id IS NULL LIMIT 1`,
                            [correlationId]
                        );
                    }

                    if (existing) {
                        console.log(`[ClienteModel] 🎯 Match encontrado por Correlation ID! LocalID=${existing.local_id} <-> ServerID=${serverId}`);
                    }
                }
            }

            // 3️⃣ Tentativa 3: Match por CNPJ/CPF (Documento Único) - Fallback
            if (!existing) {
                const doc = data.cnpj || data.cpf;
                const normalizedDoc = this.normalizeCnpjCpf(doc);

                if (normalizedDoc && (normalizedDoc.length === 11 || normalizedDoc.length === 14)) {
                    if (normalizedDoc.length === 14) {
                        existing = await databaseService.getFirst<LocalCliente>(
                            `SELECT * FROM clientes WHERE cnpj = ? AND server_id IS NULL LIMIT 1`,
                            [normalizedDoc]
                        );
                    } else {
                        existing = await databaseService.getFirst<LocalCliente>(
                            `SELECT * FROM clientes WHERE cpf = ? AND server_id IS NULL LIMIT 1`,
                            [normalizedDoc]
                        );
                    }

                    if (existing) {
                        console.log(`[ClienteModel] 🎯 Match encontrado por Documento! LocalID=${existing.local_id} <-> ServerID=${serverId}`);
                    }
                }
            }

            const now = Date.now();
            const normalizedCnpj = this.normalizeCnpjCpf(data.cnpj);
            const normalizedCpf = this.normalizeCnpjCpf(data.cpf);

            if (existing) {
                // UPDATE
                await databaseService.runUpdate(
                    `UPDATE clientes SET
                       server_id = ?,
                       server_updated_at = ?,
                       deleted_at = NULL,
                       razao_social = ?, nome_fantasia = ?, cnpj = ?, cpf = ?,
                       tipo_pessoa = ?, contato = ?, email = ?, status = ?,
                       logradouro = ?, numero = ?, complemento = ?, bairro = ?,
                       cidade = ?, estado = ?, cep = ?,
                       sync_status = 'SYNCED',
                       last_synced_at = ?
                       WHERE id = ?`,
                    [
                        serverId,
                        new Date().toISOString(),
                        data.razaoSocial,
                        data.nomeFantasia || null,
                        normalizedCnpj,
                        normalizedCpf,
                        data.tipoPessoa || 'JURIDICA',
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
                        now,
                        existing.id
                    ]
                );
                // Garantir atualizar o correlation_id se veio do server e não tínhamos ou estava defasado?
                // Se o match foi por server_id, o correlation pode estar faltando no local
                if (!existing.correlation_id && (data as any).correlationId) {
                    await databaseService.runUpdate(
                        `UPDATE clientes SET correlation_id = ? WHERE id = ?`,
                        [(data as any).correlationId, existing.id]
                    );
                }

                return (await this.getById(existing.id))!;
            } else {
                // INSERT
                const localId = uuidv4();
                const correlationId = (data as any).correlationId || localId;

                console.log(`[ClienteModel] 🆕 INSERT novo cliente server_id: ${serverId} / local_id: ${localId}`);

                await databaseService.runInsert(
                    `INSERT INTO clientes (
                        local_id, uuid, correlation_id, server_id, version, razao_social, nome_fantasia, cnpj, cpf,
                        tipo_pessoa, contato, email, status, logradouro, numero, complemento,
                        bairro, cidade, estado, cep, sync_status, last_synced_at, created_at, empresa_id,
                        server_updated_at
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        localId,
                        localId, // uuid legacy
                        correlationId,
                        serverId,
                        1,
                        data.razaoSocial,
                        data.nomeFantasia || null,
                        normalizedCnpj,
                        normalizedCpf,
                        data.tipoPessoa || 'JURIDICA',
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
                        'SYNCED',
                        now,
                        now,
                        data.empresaId || 0,
                        new Date().toISOString()
                    ]
                );

                const created = await databaseService.getFirst<LocalCliente>(
                    `SELECT * FROM clientes WHERE server_id = ? LIMIT 1`,
                    [serverId]
                );
                if (!created) throw new Error('Falha ao buscar cliente recém criado via server_id');
                return created;
            }
        } catch (error) {
            console.error('[ClienteModel] ❌ Erro no upsertFromServer:', error);
            throw error;
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
                data.cnpj ? this.normalizeCnpjCpf(data.cnpj) : data.cnpj, // Normalizar update se vier
                data.cpf ? this.normalizeCnpjCpf(data.cpf) : data.cpf,    // Normalizar update se vier
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
                `DELETE FROM sync_queue WHERE resource = 'cliente' AND temp_id = ?`,
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
     * Anexar Server ID a um cliente local (usado no Self-Healing e Create)
     */
    async attachServerId(localId: string, serverId: number): Promise<void> {
        await databaseService.runUpdate(
            `UPDATE clientes SET
                server_id = ?,
                sync_status = 'SYNCED',
                last_synced_at = ?
            WHERE local_id = ?`,
            [serverId, Date.now(), localId]
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
            localId: local.local_id, // Ensure localId is mapped for React Keys
            correlationId: local.correlation_id || local.local_id, // Definitive: correlation_id
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
