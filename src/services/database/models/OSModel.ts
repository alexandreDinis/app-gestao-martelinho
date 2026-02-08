// src/services/database/models/OSModel.ts
// Model para operações CRUD de Ordens de Serviço no banco local

import { databaseService } from '../DatabaseService';
import { v4 as uuidv4 } from 'uuid';
import { LocalOS, SyncStatus, SYNC_PRIORITIES } from './types';
import type { OrdemServico, CreateOSRequest, OSStatus, Cliente } from '../../../types';
// Lazy imports for circular dependencies handled inside functions
import type { ClienteModel as ClienteModelType } from './ClienteModel';
import type { VeiculoModel as VeiculoModelType } from './VeiculoModel';
import type { PecaModel as PecaModelType } from './PecaModel';
import type { LocalCliente, LocalVeiculo, LocalPeca } from './types';

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
     * Obter contagem total de OS
     */
    async getCount(): Promise<number> {
        const result = await databaseService.getFirst<{ count: number }>(`SELECT COUNT(*) as count FROM ordens_servico`);
        return result?.count || 0;
    },

    /**
     * Buscar todas as OS completas (JOIN) para evitar N+1 queries
     */
    /**
     * Buscar todas as OS completas (JOIN) para evitar N+1 queries
     * Suporta filtro por usuário (Data Isolation)
     */
    async getAllFull(userId?: number, role?: string): Promise<OrdemServico[]> {
        let whereClause = "WHERE os.sync_status != 'PENDING_DELETE'";
        const params: any[] = [];

        // 🛡️ Data Isolation:
        // Se role NÂO for ADMIN e userId for válido, filtrar por usuário.
        // Regra adicional: Se role NÂO for Admin, não ver OS sem usuario_id (unassigned).
        if (role !== 'ADMIN' && userId) {
            whereClause += " AND (os.usuario_id = ?)";
            params.push(userId);
        }

        const query = `
            SELECT 
                os.id as os_id, os.local_id as os_local_id, os.server_id as os_server_id, os.data as os_data, 
                os.status as os_status, os.valor_total as os_valor_total, os.tipo_desconto as os_tipo_desconto, 
                os.valor_desconto as os_valor_desconto, os.cliente_id as os_cliente_id, os.cliente_local_id as os_cliente_local_id,
                os.usuario_id, os.usuario_nome, os.usuario_email, os.sync_status as os_sync_status,
                c.id as c_id, c.local_id as c_local_id, c.server_id as c_server_id, c.razao_social as c_razao_social, 
                c.nome_fantasia as c_nome_fantasia, c.cpf as c_cpf, c.cnpj as c_cnpj, c.tipo_pessoa as c_tipo_pessoa,
                c.contato as c_contato, c.email as c_email, c.status as c_status,
                c.logradouro as c_logradouro, c.numero as c_numero, c.complemento as c_complemento,
                c.bairro as c_bairro, c.cidade as c_cidade, c.estado as c_estado, c.cep as c_cep,
                v.id as v_id, v.local_id as v_local_id, v.server_id as v_server_id, v.placa as v_placa, 
                v.modelo as v_modelo, v.cor as v_cor, v.valor_total as v_valor_total,
                p.id as p_id, p.local_id as p_local_id, p.server_id as p_server_id, p.nome_peca as p_nome_peca, 
                p.valor_cobrado as p_valor_cobrado, p.descricao as p_descricao
            FROM ordens_servico os
            LEFT JOIN clientes c ON (os.cliente_id = c.id OR os.cliente_local_id = c.local_id)
            LEFT JOIN veiculos_os v ON (os.id = v.os_id OR os.local_id = v.os_local_id)
            LEFT JOIN pecas_os p ON (v.id = p.veiculo_id OR v.local_id = p.veiculo_local_id)
            ${whereClause}
            ORDER BY os.data DESC, os.id DESC
        `;

        const rows = await databaseService.runQuery<any>(query, params);

        const osMap = new Map<string, OrdemServico>();

        for (const row of rows) {
            const osKey = row.os_local_id || `id_${row.os_id}`;
            let os = osMap.get(osKey);

            if (!os) {
                const newOS: OrdemServico = {
                    id: row.os_server_id || row.os_id,
                    localId: row.os_local_id,
                    data: row.os_data,
                    status: row.os_status as OSStatus,
                    cliente: {
                        id: row.c_server_id || row.c_id || 0,
                        razaoSocial: row.c_razao_social || 'Cliente não encontrado',
                        nomeFantasia: row.c_nome_fantasia || '',
                        cpf: row.c_cpf || undefined,
                        cnpj: row.c_cnpj || undefined,
                        tipoPessoa: row.c_tipo_pessoa as any,
                        contato: row.c_contato || '',
                        email: row.c_email || '',
                        status: row.c_status as any,
                        logradouro: row.c_logradouro || undefined,
                        numero: row.c_numero || undefined,
                        complemento: row.c_complemento || undefined,
                        bairro: row.c_bairro || undefined,
                        cidade: row.c_cidade || undefined,
                        estado: row.c_estado || undefined,
                        cep: row.c_cep || undefined,
                    } as Cliente,
                    valorTotal: row.os_valor_total || 0,
                    veiculos: [],
                    tipoDesconto: row.os_tipo_desconto as any,
                    valorDesconto: row.os_valor_desconto || undefined,
                    valorTotalSemDesconto: row.os_valor_total || 0,
                    valorTotalComDesconto: row.os_valor_total || 0,
                    usuarioId: row.usuario_id || undefined,
                    usuarioNome: row.usuario_nome || undefined,
                    usuarioEmail: row.usuario_email || undefined,
                    syncStatus: row.os_sync_status as any,
                    empresaId: 1,
                    atrasado: false
                } as any;
                os = newOS;
                osMap.set(osKey, os);
            }

            if (row.v_id) {
                const vSearchId = row.v_server_id || row.v_id;
                let veiculo = os.veiculos.find((v: any) => v.id === vSearchId);

                if (!veiculo) {
                    veiculo = {
                        id: vSearchId,
                        placa: row.v_placa,
                        modelo: row.v_modelo || '',
                        cor: row.v_cor || '',
                        valorTotal: row.v_valor_total || 0,
                        pecas: []
                    };
                    os.veiculos.push(veiculo);
                }

                if (row.p_id) {
                    veiculo.pecas.push({
                        id: row.p_server_id || row.p_id,
                        nomePeca: row.p_nome_peca || '',
                        valorCobrado: row.p_valor_cobrado || 0,
                        descricao: row.p_descricao || undefined
                    });
                }
            }
        }

        return Array.from(osMap.values());
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
     * Buscar OS completa por ID ou LocalID (JOIN)
     */
    async getByIdFull(id: number | string): Promise<OrdemServico | null> {
        const query = `
            SELECT 
                os.id as os_id, os.local_id as os_local_id, os.server_id as os_server_id, os.data as os_data, 
                os.status as os_status, os.valor_total as os_valor_total, os.tipo_desconto as os_tipo_desconto, 
                os.valor_desconto as os_valor_desconto, os.cliente_id as os_cliente_id, os.cliente_local_id as os_cliente_local_id,
                os.usuario_id, os.usuario_nome, os.usuario_email, os.sync_status as os_sync_status,
                c.id as c_id, c.local_id as c_local_id, c.server_id as c_server_id, c.razao_social as c_razao_social, 
                c.nome_fantasia as c_nome_fantasia, c.cpf as c_cpf, c.cnpj as c_cnpj, c.tipo_pessoa as c_tipo_pessoa,
                c.contato as c_contato, c.email as c_email, c.status as c_status,
                c.logradouro as c_logradouro, c.numero as c_numero, c.complemento as c_complemento,
                c.bairro as c_bairro, c.cidade as c_cidade, c.estado as c_estado, c.cep as c_cep,
                v.id as v_id, v.local_id as v_local_id, v.server_id as v_server_id, v.placa as v_placa, 
                v.modelo as v_modelo, v.cor as v_cor, v.valor_total as v_valor_total,
                p.id as p_id, p.local_id as p_local_id, p.server_id as p_server_id, p.nome_peca as p_nome_peca, 
                p.valor_cobrado as p_valor_cobrado, p.descricao as p_descricao
            FROM ordens_servico os
            LEFT JOIN clientes c ON (os.cliente_id = c.id OR os.cliente_local_id = c.local_id)
            LEFT JOIN veiculos_os v ON (os.id = v.os_id OR os.local_id = v.os_local_id)
            LEFT JOIN pecas_os p ON (v.id = p.veiculo_id OR v.local_id = p.veiculo_local_id)
            WHERE os.id = ? OR os.local_id = ?
        `;

        const rows = await databaseService.runQuery<any>(query, [id, id]);

        if (rows.length === 0) return null;

        let os: OrdemServico | null = null;

        for (const row of rows) {
            if (!os) {
                os = {
                    id: row.os_server_id || row.os_id,
                    localId: row.os_local_id,
                    data: row.os_data,
                    status: row.os_status as OSStatus,
                    cliente: {
                        id: row.c_server_id || row.c_id || 0,
                        razaoSocial: row.c_razao_social || 'Cliente não encontrado',
                        nomeFantasia: row.c_nome_fantasia || '',
                        cpf: row.c_cpf || undefined,
                        cnpj: row.c_cnpj || undefined,
                        tipoPessoa: row.c_tipo_pessoa as any,
                        contato: row.c_contato || '',
                        email: row.c_email || '',
                        status: row.c_status as any,
                        logradouro: row.c_logradouro || undefined,
                        numero: row.c_numero || undefined,
                        complemento: row.c_complemento || undefined,
                        bairro: row.c_bairro || undefined,
                        cidade: row.c_cidade || undefined,
                        estado: row.c_estado || undefined,
                        cep: row.c_cep || undefined,
                    } as Cliente,
                    valorTotal: row.os_valor_total || 0,
                    veiculos: [],
                    tipoDesconto: row.os_tipo_desconto as any,
                    valorDesconto: row.os_valor_desconto || undefined,
                    valorTotalSemDesconto: row.os_valor_total || 0,
                    valorTotalComDesconto: row.os_valor_total || 0,
                    usuarioId: row.usuario_id || undefined,
                    usuarioNome: row.usuario_nome || undefined,
                    usuarioEmail: row.usuario_email || undefined,
                    syncStatus: row.os_sync_status as any,
                    empresaId: 1,
                    atrasado: false
                } as any;
            }

            if (os && row.v_id) {
                const vSearchId = row.v_server_id || row.v_id;
                let veiculo = os.veiculos.find((v: any) => v.id === vSearchId);

                if (!veiculo) {
                    veiculo = {
                        id: vSearchId,
                        placa: row.v_placa,
                        modelo: row.v_modelo || '',
                        cor: row.v_cor || '',
                        valorTotal: row.v_valor_total || 0,
                        pecas: []
                    };
                    os.veiculos.push(veiculo);
                }

                if (row.p_id) {
                    veiculo.pecas.push({
                        id: row.p_server_id || row.p_id,
                        nomePeca: row.p_nome_peca || '',
                        valorCobrado: row.p_valor_cobrado || 0,
                        descricao: row.p_descricao || undefined
                    });
                }
            }
        }

        return os;
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
        const { SyncQueueModel } = require('./SyncQueueModel');
        return await SyncQueueModel.hasPending('os', localId);
    },

    /**
     * Converter LocalOS para formato API (OrdemServico)
     * Resolve Cliente e Veículos
     */
    async toApiFormat(local: LocalOS): Promise<OrdemServico> {
        const { ClienteModel } = require('./ClienteModel');
        const { VeiculoModel } = require('./VeiculoModel');
        const { PecaModel } = require('./PecaModel');

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
        // Buscamos pelo ID local da OS (PK), pois é isso que o os_id do veículo referencia
        const veiculos = await VeiculoModel.getByOSId(local.id);
        console.log(`[OSModel] toApiFormat: OS Local PK ${local.id} (UUID: ${local.local_id}) has ${veiculos.length} veiculos`);

        return {
            id: local.server_id || local.id, // Preferência server_id se synced, senão ID local
            localId: local.local_id, // Importante para referência futura
            cliente: cliente, // <--- ADICIONADO
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
            veiculos: await Promise.all(veiculos.map(async (v: LocalVeiculo) => {
                const pecas = await PecaModel.getByVeiculoId(v.id);
                console.log(`[OSModel] toApiFormat: Veiculo Local PK ${v.id} (Placa: ${v.placa}) has ${pecas.length} pecas. Raw Pecas:`, JSON.stringify(pecas));
                return {
                    id: v.server_id || v.id,
                    placa: v.placa,
                    modelo: v.modelo || '',
                    cor: v.cor || '',
                    valorTotal: v.valor_total || 0,
                    pecas: pecas.map((p: LocalPeca) => ({
                        id: p.server_id || p.id,
                        nomePeca: p.nome_peca || '',
                        valorCobrado: p.valor_cobrado || 0,
                        descricao: p.descricao || undefined
                    }))
                };
            })),
            usuarioId: local.usuario_id || undefined,
            usuarioNome: local.usuario_nome || undefined,
            usuarioEmail: local.usuario_email || undefined,
            syncStatus: local.sync_status
        } as unknown as OrdemServico;
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
    async create(data: CreateOSRequest & { clienteLocalId?: string; usuarioId?: number }, syncStatus: SyncStatus = 'PENDING_CREATE'): Promise<LocalOS> {
        const now = Date.now();
        const localId = uuidv4();

        // Resolver cliente (pode ser por server_id ou local_id)
        let clienteId: number | null = null;
        let clienteLocalId: string | null = data.clienteLocalId || null;

        if (data.clienteId) {
            const { ClienteModel } = require('./ClienteModel');
            const cliente = await ClienteModel.getByServerId(data.clienteId);
            if (cliente) {
                clienteId = cliente.id;
                clienteLocalId = cliente.local_id;
            }
        }

        // 👤 Resolver Responsável (Técnico) vindo do dropdown
        let usuarioId = data.usuarioId || null;
        let usuarioNome = null;
        let usuarioEmail = null;

        if (usuarioId) {
            try {
                const { UserModel } = require('./UserModel');
                const users = await UserModel.getAll();
                const user = users.find((u: any) => u.id === usuarioId || u.server_id === usuarioId);
                if (user) {
                    usuarioNome = user.name;
                    usuarioEmail = user.email;
                    console.log(`[OSModel] 👤 Responsável resolvido offline: ${usuarioId} -> ${usuarioNome}`);
                }
            } catch (e) {
                console.error('[OSModel] Erro ao resolver info de usuário na criação offline', e);
            }
        }

        const uuid = localId; // Usando localId como UUID

        const id = await databaseService.runInsert(
            `INSERT INTO ordens_servico (
        local_id, uuid, server_id, version, cliente_id, cliente_local_id,
        data, data_vencimento, status, valor_total,
        sync_status, updated_at, created_at,
        usuario_id, usuario_nome, usuario_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                now,
                usuarioId,
                usuarioNome,
                usuarioEmail
            ]
        );

        // Adicionar à fila de sync se for pendente
        if (syncStatus === 'PENDING_CREATE') {
            await this.addToSyncQueue(localId, 'CREATE', {
                ...data,
                usuarioId,
                usuarioNome,
                usuarioEmail
            });
        }

        return (await this.getById(id))!;
    },

    /**
     * Salvar múltiplas OS do servidor no cache local (Batch)
     */
    async upsertBatch(osList: OrdemServico[]): Promise<void> {
        const db = databaseService.getDatabase();

        // 🚀 PERFORMANCE: Process in chunks to avoid "database is locked"
        // This allows the UI to read from the DB in between write transactions
        // REDUCED TO 1 to absolutely minimize transaction contention during debugging
        const CHUNK_SIZE = 1;

        for (let i = 0; i < osList.length; i += CHUNK_SIZE) {
            const chunk = osList.slice(i, i + CHUNK_SIZE);
            console.log(`[OSModel] Processing batch chunk ${i / CHUNK_SIZE + 1} (${chunk.length} items)...`);

            await db.withTransactionAsync(async () => {
                for (const os of chunk) {
                    await this.upsertFromServer(os);
                }
            });

            // ⏳ YIELD: Give 200ms breathing room for other operations (like UI reads)
            if (i + CHUNK_SIZE < osList.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    },

    /**
     * Salvar OS do servidor no cache local
     */
    async upsertFromServer(os: OrdemServico): Promise<LocalOS> {
        console.log(`[OSModel] 📥 UPSERT from Server: ID ${os.id}`, JSON.stringify(os, null, 2));

        // Column existence is ensured at DatabaseService initialization.

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
        const { ClienteModel } = require('./ClienteModel');
        let clienteId: number | null = null;
        let clienteLocalId: string | null = null;
        if (os.cliente) {
            // Ensure client exists locally
            const clienteLocal = await ClienteModel.upsertFromServer(os.cliente);
            if (clienteLocal) {
                clienteId = clienteLocal.id;
                clienteLocalId = clienteLocal.local_id;
                console.log(`[OSModel] 🔗 Resolved Cliente Local ID: ${clienteId} (Server ID: ${os.cliente.id})`);
            } else {
                console.warn(`[OSModel] ⚠️ ClienteModel.upsertFromServer returned null for Server ID ${os.cliente.id}`);
            }
        } else if ((os as any).clienteId && !clienteId) {
            // Fallback: se veio apenas o ID do cliente mas não o objeto (payload parcial)
            const cid = (os as any).clienteId;
            const clienteLocal = await ClienteModel.getByServerId(cid);
            if (clienteLocal) {
                clienteId = clienteLocal.id;
                clienteLocalId = clienteLocal.local_id;
                console.log(`[OSModel] 🔗 Resolved Cliente Local ID via clienteId: ${clienteId} (Server ID: ${cid})`);
            }
        }

        let localOS: LocalOS;

        if (existing) {
            // 🛡️ SEGURANÇA: Não sobrescrever se houver alterações locais pendentes
            if (existing.sync_status !== 'SYNCED') {
                const { SyncQueueModel } = require('./SyncQueueModel');
                const isReallyPending = await SyncQueueModel.hasPending('os', existing.local_id);

                if (isReallyPending) {
                    console.log(`[OSModel] 🛡️ Ignorando update do servidor para OS ${existing.id} (status: ${existing.sync_status}, queue: YES)`);
                    return existing;
                } else {
                    console.log(`[OSModel] 🧟 Zombie detected! Status ${existing.sync_status} but not in Queue. Overwriting with Server data.`);
                }
            }

            let usuarioNome = os.usuarioNome;
            let usuarioEmail = os.usuarioEmail;

            // Se o servidor mandou nome/email nulo mas temos o ID, tenta resolver localmente
            // (Isso funciona bem agora porque puxamos metadados ANTES das OS no SyncService)
            if (os.usuarioId && (!usuarioNome || !usuarioEmail)) {
                try {
                    const { UserModel } = require('./UserModel');
                    const users = await UserModel.getAll();
                    const user = users.find((u: any) => u.id === os.usuarioId || u.server_id === os.usuarioId);
                    if (user) {
                        usuarioNome = usuarioNome || user.name;
                        usuarioEmail = usuarioEmail || user.email;
                        console.log(`[OSModel] 👤 Resolvido responsável ${os.usuarioId} via UserModel: ${usuarioNome}`);
                    }
                } catch (e) {
                    console.error('[OSModel] Erro ao resolver info de usuário', e);
                }
            }

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
                    os.usuarioId || existing.usuario_id || (usuarioEmail ? 0 : null),
                    usuarioNome || existing.usuario_nome || null,
                    usuarioEmail || existing.usuario_email || null,
                    existing.id
                ]
            );
            localOS = (await this.getById(existing.id))!;
        } else {
            // Inserir novo
            const localId = os.localId || uuidv4();
            const uuid = localId;

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
                    'SYNCED',
                    now,
                    now,
                    now,
                    os.usuarioId || (os.usuarioEmail ? 0 : null),
                    os.usuarioNome || null,
                    os.usuarioEmail || null
                ]
            );
            console.log(`[OSModel] ✅ Inserted New OS: Local ID ${localId} / Server ID ${os.id}`);
            localOS = (await this.getById(id))!;
        }

        // 🚛 SYNC VEÍCULOS
        if (os.veiculos && os.veiculos.length > 0) {
            const { VeiculoModel } = require('./VeiculoModel');
            console.log(`[OSModel] Syncing ${os.veiculos.length} vehicles for OS ${localOS.id}`);
            // Usando Promise.all para performance, mas cuidado com locks do SQLite (driver expo-sqlite handle bem?)
            // Melhor sequencial para segurança
            for (const v of os.veiculos) {
                await VeiculoModel.upsertFromServer(v, localOS.id);
            }
        }

        return localOS;
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
     * Recalcular valor total da OS baseado nos veículos
     */
    async recalculateTotal(osId: number): Promise<number> {
        const result = await databaseService.getFirst<{ total: number }>(
            `SELECT SUM(valor_total) as total FROM veiculos_os 
             WHERE (os_id = ? OR os_local_id = (SELECT local_id FROM ordens_servico WHERE id = ?))
             AND sync_status != 'PENDING_DELETE'`,
            [osId, osId]
        );
        const total = result?.total || 0;

        await databaseService.runUpdate(
            `UPDATE ordens_servico SET valor_total = ?, updated_at = ? WHERE id = ?`,
            [total, Date.now(), osId]
        );

        console.log(`[OSModel] Recalculated total for OS ${osId}: ${total}`);
        return total;
    },

    /**
     * Atualizar valor total da OS (Manual/API)
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
            `DELETE FROM sync_queue WHERE resource = 'os' AND temp_id = ?`,
            [localId]
        );
    },

    /**
     * Adicionar à fila de sincronização
     */
    async addToSyncQueue(localId: string, operation: 'CREATE' | 'UPDATE' | 'DELETE', payload: any): Promise<void> {
        const { SyncQueueModel } = require('./SyncQueueModel');
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
            await databaseService.runDelete(`DELETE FROM sync_queue WHERE resource = 'os' AND temp_id = ?`, [localId]);
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
        await databaseService.runDelete(`DELETE FROM sync_queue WHERE resource = 'os' AND temp_id = ?`, [localId]);
    }
};
