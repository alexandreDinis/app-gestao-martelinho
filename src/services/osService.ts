import api from './api';
import { OSModel } from './database/models/OSModel';
import { Logger } from './Logger';
import { OfflineDebug } from '../utils/OfflineDebug';
import * as SecureStore from 'expo-secure-store';
import { databaseService } from './database/DatabaseService';
import { Linking } from 'react-native';
import type {
    Cliente, ClienteRequest, ClienteFiltros,
    OrdemServico, CreateOSRequest,
    AddVeiculoRequest, AddPecaRequest, UpdateOSStatusRequest,
    VeiculoOS, OSStatus, PecaOS
} from '../types';

export const osService = {
    // --- Clients ---
    // --- Clients ---
    listClientes: async (filtros?: ClienteFiltros): Promise<Cliente[]> => {
        Logger.info('[OSService] listClientes', filtros);

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        // 1. Fallback Local (Offline) if forced offline or no connection logic wrapper
        // But for consistency with listOS, we might prefer local-first or hybrid.
        // Let's stick to: Try API if online, else Local.

        if (isOnline) {
            try {
                Logger.info('[OSService] Fetching clients from API');
                const params = new URLSearchParams();
                if (filtros) {
                    Object.entries(filtros).forEach(([key, value]) => {
                        if (value) params.append(key, value);
                    });
                }
                const response = await api.get<Cliente[]>(`/clientes?${params.toString()}`);

                // Optional: Background sync/upsert to keep local DB fresh
                // This ensures the next offline usage has this data.
                // Fire and forget or await? Safer to await if we want consistency now.
                const { ClienteModel } = require('./database/models/ClienteModel');
                await ClienteModel.upsertBatch(response.data);

                return response.data;
            } catch (error) {
                Logger.error('[OSService] API client fetch failed, falling back to local', error);
            }
        }

        // 2. Fetch from Local DB
        Logger.info('[OSService] Fetching clients from Local DB');
        const { ClienteModel } = require('./database/models/ClienteModel');
        const localClients = await ClienteModel.search(filtros?.termo || '');

        // Map local format to API format if needed (though they share Cliente interface mostly)
        return localClients.map((c: any) => ({
            id: c.server_id || c.id, // Prefer server_id for compatibility
            localId: c.local_id,
            razaoSocial: c.razao_social,
            nomeFantasia: c.nome_fantasia,
            cnpj: c.cnpj,
            cpf: c.cpf,
            tipoPessoa: c.tipo_pessoa,
            contato: c.contato,
            email: c.email,
            status: c.status,
            logradouro: c.logradouro,
            numero: c.numero,
            complemento: c.complemento,
            bairro: c.bairro,
            cidade: c.cidade,
            estado: c.estado,
            cep: c.cep,
            local_id: c.local_id
        }));
    },

    // --- Ordem de Serviço (Core) ---
    /**
     * Criar OS com suporte offline-first
     * - Se online: tenta criar na API e salva localmente
     * - Se offline: salva localmente (incluindo hierarquia) e adiciona à fila
     */
    createOS: async (data: CreateOSRequest): Promise<OrdemServico> => {
        Logger.info('[OSService] Creating OS', { clienteId: data.clienteId, data: data.data });

        // 🛡️ Secure Context
        const { authService } = require('./authService');
        const session = await authService.getSessionClaims();

        if (!session?.empresaId) {
            throw new Error('Empresa ID não encontrado na sessão. Faça login novamente.');
        }

        const empresaId = session.empresaId;

        // 🔧 DEBUG: Verificar conectividade (respeita modo forceOffline)
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable;

        Logger.debug('[OSService] Network status', { isOnline, isConnected, isInternetReachable });

        if (isOnline) {
            // Tentar criar na API primeiro
            try {
                Logger.info('[OSService] Attempting API create (online mode)');
                const response = await api.post<OrdemServico>('/ordens-servico', data);

                // Salvar no cache local como SYNCED
                await OSModel.upsertFromServer(response.data, empresaId);

                Logger.info('[OSService] OS created successfully via API', { id: response.data.id });
                return response.data;
            } catch (error) {
                Logger.warn('[OSService] API create failed, falling back to offline mode', error);
                // Se falhar, continua para modo offline
            }
        }

        // Modo offline: salvar localmente e adicionar à fila
        Logger.info('[OSService] Creating OS in offline mode');
        const localOS = await OSModel.create({ ...data, empresaId }, 'PENDING_CREATE');

        Logger.info('[OSService] OS created locally', {
            localId: localOS.local_id,
            queuedForSync: true
        });

        // 🔧 Trigger immediate sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.create_fallback').catch(e => console.error(e)));
        }

        // Converter para formato da API para retornar
        // Note: veiculos virão vazios pois ainda não foram adicionados
        return {
            id: localOS.id, // ID local temporário
            data: localOS.data,
            status: localOS.status as OSStatus,
            cliente: {} as any, // Será resolvido quando necessário
            valorTotal: localOS.valor_total || 0,
            veiculos: [],
            tipoDesconto: localOS.tipo_desconto as any,
            valorDesconto: localOS.valor_desconto || undefined,
            valorTotalSemDesconto: localOS.valor_total || 0,
            valorTotalComDesconto: localOS.valor_total || 0,
            dataVencimento: localOS.data_vencimento || undefined,
            atrasado: false,
            usuarioId: session.userId || 0,
            usuarioNome: undefined,
            usuarioEmail: '',
            empresaId: empresaId
        };
    },

    // --- In-flight Promise ---
    _listOSPromise: null as Promise<OrdemServico[]> | null,

    listOS: async (since?: string): Promise<OrdemServico[]> => {
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        // 🛡️ Data Isolation: Get current user context from JWT/session (not local DB)
        const { authService } = require('./authService');
        const session = await authService.getSessionClaims();
        const userId = session?.userId;
        const role = session?.role;

        Logger.info(`[OSService] listOS called (User: ${userId}, Role: ${role})`);

        // 1. Fetch from Local DB (Always Single Source of Truth for UI)
        if (!session?.empresaId) {
            Logger.warn('[OSService] listOS called without empresaId, returning empty list');
            return [];
        }

        const localOS = await OSModel.getAllFull({
            empresaId: session.empresaId,
            userId: userId,
            includeAllUsers: !!role?.includes('ADMIN')
        });

        return localOS;
    },

    /**
     * Fetches OS data from API without persisting.
     * Used by SyncService to handle the "Pull" phase.
     */
    fetchFromApi: async (since?: string): Promise<OrdemServico[]> => {
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (!isConnected || !isInternetReachable || OfflineDebug.isForceOffline()) {
            return [];
        }

        try {
            Logger.info('[OSService] fetchFromApi - fetching from API', { since });
            const response = await api.get<OrdemServico[]>('/ordens-servico', {
                params: { since }
            });
            return response.data || [];
        } catch (error) {
            Logger.error('[OSService] API fetch failed', error);
            throw error;
        }
    },

    getOSById: async (id: number | string): Promise<OrdemServico> => {
        Logger.info('[OSService] getOSById', { id });

        // 🛡️ Data Isolation
        const { authService } = require('./authService');
        const session = await authService.getSessionClaims();

        if (!session?.empresaId) {
            throw new Error('Sessão inválida ou expirada (empresaId missing).');
        }

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        // 1. Online-First: buscar da API para garantir dados frescos (peças, veículos, etc.)
        if (isOnline) {
            try {
                Logger.info('[OSService] Fetching OS from API (online-first)', { id });
                const response = await api.get<OrdemServico>(`/ordens-servico/${id}`);

                // Salvar no cache local para acesso offline futuro
                const localOS = await OSModel.upsertFromServer(response.data, session.empresaId);

                Logger.info('[OSService] OS fetched from API and cached locally');
                return await OSModel.toApiFormat(localOS);
            } catch (error) {
                Logger.error('[OSService] API fetch failed for getOSById, falling back to local', error);
                // Continua para fallback local
            }
        }

        // 2. Fallback: Ler do cache local (JOIN Otimizado)
        try {
            const localFull = await OSModel.getByIdFull(id, session.empresaId);

            if (localFull) {
                Logger.info('[OSService] Found full OS locally (JOIN fallback)');
                return localFull;
            }
        } catch (error) {
            Logger.error('[OSService] Error reading local OS', error);
        }

        throw new Error('Ordem de serviço não encontrada.');
    },

    updateStatus: async (id: number, status: OSStatus): Promise<OrdemServico> => {
        Logger.info('[OSService] updateStatus', { id, status });

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[OSService] Attempting API status update (online mode)');
                const response = await api.patch<OrdemServico>(`/ordens-servico/${id}/status`, { status });
                Logger.info('[OSService] OS status updated successfully via API', { id });

                // Atualizar no cache local como SYNCED
                const localOS = await OSModel.getByServerId(id);
                if (localOS) {
                    await OSModel.updateStatus(id, status); // Local model updates status and marks as SYNCED if no other changes
                    // Força status SYNCED pois acabamos de vir da API
                    await databaseService.runUpdate(
                        `UPDATE ordens_servico SET sync_status = 'SYNCED', last_synced_at = ? WHERE server_id = ?`,
                        [Date.now(), id]
                    );
                }

                return response.data;
            } catch (error) {
                Logger.error('[OSService] API status update failed, falling back to offline mode', error);
                // Continua para offline
            }
        }

        // Offline-First: Salvar status localmente e enfileirar sync
        const localUpdated = await OSModel.updateStatus(id, status);

        if (!localUpdated) {
            throw new Error('OS não encontrada localmente para atualização de status.');
        }

        // Tentar sincronizar imediatamente se estiver online
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.updateStatus').catch(e => console.error(e)));
        }

        return await OSModel.toApiFormat(localUpdated);
    },

    updateOS: async (id: number, data: any): Promise<OrdemServico> => {
        Logger.info('[OSService] updateOS called', { id, data });

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[OSService] Attempting API OS update (online mode)');
                const response = await api.patch<OrdemServico>(`/ordens-servico/${id}`, data);
                Logger.info('[OSService] OS updated successfully via API', { id });

                // Atualizar no cache local
                const { authService } = require('./authService');
                const session = await authService.getSessionClaims();
                if (session?.empresaId) {
                    await OSModel.upsertFromServer(response.data, session.empresaId);
                }

                return response.data;
            } catch (error) {
                Logger.error('[OSService] API OS update failed, falling back to offline mode', error);
                // Continua para offline
            }
        }

        // Map API keys to Local DB keys
        const localData: any = { ...data };
        // ... (existing user resolution logic) ...
        if (data.usuarioId !== undefined) {
            localData.usuario_id = data.usuarioId;
            delete localData.usuarioId;

            if (!data.usuarioNome || !data.usuarioEmail) {
                try {
                    const { UserModel } = require('./database/models/UserModel');
                    const users = await UserModel.getAll();
                    const user = users.find((u: any) => u.id === data.usuarioId);
                    if (user) {
                        localData.usuario_nome = user.name;
                        localData.usuario_email = user.email;
                    }
                } catch (e) { }
            }
        }
        if (data.usuarioNome !== undefined && !localData.usuario_nome) {
            localData.usuario_nome = data.usuarioNome;
            delete localData.usuarioNome;
        }
        if (data.usuarioEmail !== undefined && !localData.usuario_email) {
            localData.usuario_email = data.usuarioEmail;
            delete localData.usuarioEmail;
        }

        // Offline-First: Salvar localmente e enfileirar sync
        const localUpdated = await OSModel.update(id, localData);

        if (!localUpdated) {
            throw new Error('OS não encontrada localmente para atualização.');
        }

        // Tentar sincronizar imediatamente
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.updateOS').catch(e => console.error(e)));
        }

        return await OSModel.toApiFormat(localUpdated);
    },

    addVeiculo: async (data: AddVeiculoRequest): Promise<VeiculoOS> => {
        Logger.info('[OSService] addVeiculo called', data);

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[OSService] Attempting API addVeiculo (online mode)');
                const response = await api.post<any>('/ordens-servico/veiculos', data);

                // DATA É A OS (OrdemServicoResponse), NÃO O VEÍCULO!
                // Precisa achar o veículo criado. Na via online, o último veículo costuma ser o adicionado.
                // Mas para garantir, tentamos achar pela placa (se única)
                const osResponse = response.data;
                const createdVeiculo = osResponse.veiculos?.find(
                    (v: any) => v.placa === data.placa.toUpperCase()
                ) || osResponse.veiculos?.[osResponse.veiculos.length - 1];

                Logger.info('[OSService] Vehicle added successfully via API', { id: createdVeiculo?.id });

                if (createdVeiculo) {
                    // Atualizar cache local
                    const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
                    const os = await OSModel.getByServerId(data.ordemServicoId);

                    // Upsert usando o veículo extraído corretamente
                    await VeiculoModel.upsertFromServer(createdVeiculo, os?.id || 0);

                    return createdVeiculo as VeiculoOS;
                }

                // Fallback se algo muito estranho acontecer
                return response.data; // Vai quebrar tipagem mais pra frente, mas evita crash imediato

            } catch (error) {
                Logger.error('[OSService] API addVeiculo failed, falling back to offline mode', error);
            }
        }

        // 1. Resolver OS Local
        let os = await OSModel.getByServerId(data.ordemServicoId);
        if (!os) {
            os = await OSModel.getById(data.ordemServicoId);
        }

        if (!os) {
            throw new Error(`OS não encontrada para vincular veículo: ${data.ordemServicoId}`);
        }

        // 2. Salvar localmente
        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
        const localVeiculo = await VeiculoModel.create({
            ...data,
            osLocalId: os.local_id
        });

        // 3. Trigger Sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.addVeiculo').catch(e => console.error(e)));
        }

        return {
            id: localVeiculo.server_id || localVeiculo.id,
            placa: localVeiculo.placa,
            modelo: localVeiculo.modelo || '',
            cor: localVeiculo.cor || '',
            valorTotal: localVeiculo.valor_total || 0,
            pecas: []
        };
    },

    // --- PDF Sharing ---
    openOSPdf: async (osId: number) => {
        try {
            const userStr = await SecureStore.getItemAsync('user');
            const token = userStr ? JSON.parse(userStr).token : null;

            // Construct URL matching the backend structure
            // NOTE: api.defaults.baseURL includes /api/v1, but the PDF endpoint might be relative to root or api
            // Web implementation used: `${api.defaults.baseURL}ordens-servico/${osId}/pdf?token=${token}`
            // We need to ensure baseURL doesn't have double slashes if it ends with /

            const baseURL = api.defaults.baseURL?.replace(/\/$/, '');
            const url = `${baseURL}/ordens-servico/${osId}/pdf?token=${token}`;

            const supported = await Linking.canOpenURL(url);
            if (supported) {
                await Linking.openURL(url);
            } else {
                console.error("Don't know how to open URI: " + url);
            }
        } catch (error) {
            console.error("Error opening PDF", error);
        }
    },

    // --- Vehicle Plate Search ---
    verificarPlaca: async (placa: string): Promise<{ existe: boolean; veiculoExistente?: any; mensagem?: string }> => {
        Logger.info('[osService] verificarPlaca', { placa });

        // 1. Tentar API se estiver Online
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            try {
                Logger.info('[osService] Checking plate on API');
                const response = await api.get(`/veiculos/verificar-placa`, {
                    params: { placa }
                });
                return response.data;
            } catch (error) {
                Logger.error('[osService] API plate check failed, falling back to local', error);
            }
        }

        // 2. Fallback Local (Offline)
        Logger.info('[osService] Checking plate on Local DB');
        const localCheck = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel.verificarPlaca(placa));

        if (localCheck.existe && localCheck.veiculoExistente) {
            return {
                existe: true,
                veiculoExistente: {
                    ...localCheck.veiculoExistente,
                    // Adaptar campos locais para o formato esperado pela UI (se necessário)
                    // A API retorna um objeto veiculo resumido
                },
                mensagem: 'Veículo encontrado localmente'
            };
        }

        return { existe: false };
    },

    getHistoricoVeiculo: async (placa: string): Promise<any[]> => {
        Logger.info('[osService] getHistoricoVeiculo', { placa });

        // 1. Tentar API se estiver Online
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            try {
                Logger.info('[osService] Fetching history from API');
                const response = await api.get<any>(`/veiculos/${placa}/historico`);
                return response.data || [];
            } catch (error) {
                Logger.error('[osService] API history fetch failed, falling back to local', error);
            }
        }

        // 2. Fallback Local (Offline)
        Logger.info('[osService] Fetching history from Local DB');
        const localVeiculos = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel.searchByPlaca(placa));

        // Mapear veiculos locais para formato de histórico
        // Precisa buscar a OS pai para pegar data e status
        const historico = await Promise.all(localVeiculos.map(async (v) => {
            if (!v.os_id && !v.os_local_id) return null;

            // Buscar OS pai
            let os = null;
            if (v.os_id) os = await OSModel.getByServerId(v.os_id); // Tenta pelo ID do server primeiro
            if (!os && v.os_local_id) os = await OSModel.getByLocalId(v.os_local_id); // Tenta pelo local ID

            if (!os) return null;

            return {
                ordemServicoId: os.server_id || os.id, // Preferir ID do server se tiver
                data: os.data,
                status: os.status,
                valorTotalServico: v.valor_total || 0,
                placa: v.placa,
                modelo: v.modelo,
                cor: v.cor,
                localId: os.local_id // Identifier extra para debug
            };
        }));

        return historico.filter(h => h !== null);
    },

    // --- Catalog (Tipos de Peça) ---
    listTiposPeca: async (): Promise<any[]> => {
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                const response = await api.get('/tipos-peca');
                // Cache local
                const { TiposPecaModel } = require('./database/models/TiposPecaModel');
                await TiposPecaModel.upsertBatch(response.data);
                return response.data;
            } catch (error) {
                Logger.error('[OSService] API tipos-peca fetch failed, falling back to local', error);
            }
        }

        Logger.info('[OSService] Fetching tipos-peca from Local DB');
        const { TiposPecaModel } = require('./database/models/TiposPecaModel');
        const types = await TiposPecaModel.getAll();
        return types; // Already formatted by model
    },

    // --- Parts/Services ---
    addPeca: async (data: AddPecaRequest): Promise<PecaOS> => {
        Logger.info('[OSService] addPeca called', data);

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[OSService] Attempting API addPeca (online mode)');
                const response = await api.post<PecaOS>('/ordens-servico/pecas', data);
                Logger.info('[OSService] Peca added successfully via API', { id: response.data.id });

                // Atualizar cache local
                const { authService } = require('./authService');
                const session = await authService.getSessionClaims();
                const PecaModel = await import('./database/models/PecaModel').then(m => m.PecaModel);
                const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);

                const veiculo = await VeiculoModel.getByServerId(data.veiculoId);
                await PecaModel.upsertFromServer(response.data, veiculo?.id || 0);

                // Recalcular totais locais
                if (veiculo) {
                    await VeiculoModel.recalculateTotal(veiculo.id);
                    const osIdToRecalc = veiculo.os_id || (veiculo.os_local_id ? (await OSModel.getByLocalId(veiculo.os_local_id))?.id : null);
                    if (osIdToRecalc) await OSModel.recalculateTotal(osIdToRecalc);
                }

                return response.data;
            } catch (error) {
                Logger.error('[OSService] API addPeca failed, falling back to offline mode', error);
            }
        }

        // 1. Resolver Veículo Local
        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
        let veiculo = await VeiculoModel.getByServerId(data.veiculoId);
        if (!veiculo) veiculo = await VeiculoModel.getById(data.veiculoId);

        if (!veiculo) {
            throw new Error(`Veículo não encontrado: ${data.veiculoId}`);
        }

        // 2. Salvar localmente
        const PecaModel = await import('./database/models/PecaModel').then(m => m.PecaModel);
        const localPeca = await PecaModel.create({
            ...data,
            veiculoLocalId: veiculo.local_id
        });

        // 3. Recalcular Totais
        try {
            await VeiculoModel.recalculateTotal(veiculo.id);
            const osIdToRecalc = veiculo.os_id || (veiculo.os_local_id ? (await OSModel.getByLocalId(veiculo.os_local_id))?.id : null);
            if (osIdToRecalc) await OSModel.recalculateTotal(osIdToRecalc);
        } catch (e) { }

        // 4. Trigger Sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.addPeca').catch(e => console.error(e)));
        }

        return {
            id: localPeca.server_id || localPeca.id,
            nomePeca: localPeca.nome_peca || '',
            valorCobrado: localPeca.valor_cobrado || 0,
            descricao: localPeca.descricao || ''
        };
    },

    deletePeca: async (id: number): Promise<void> => {
        Logger.info('[OSService] deletePeca called', { id });

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        // 1. Resolver peça local
        const PecaModel = await import('./database/models/PecaModel').then(m => m.PecaModel);
        let peca = await PecaModel.getByServerId(id);
        if (!peca) peca = await PecaModel.getById(id);

        if (!peca) {
            console.warn(`[OSService] Peca ${id} not found for deletion, maybe already deleted?`);
            return;
        }

        const veiculoId = peca.veiculo_id;

        // 2. Online-First: Tentar deletar na API primeiro
        if (isOnline && peca.server_id) {
            try {
                Logger.info('[OSService] Attempting API deletePeca (online mode)', { serverId: peca.server_id });
                await api.delete(`/ordens-servico/pecas/${peca.server_id}`);
                Logger.info('[OSService] Peca deleted successfully via API');

                // Remover fisicamente do banco local (já foi deletada no servidor)
                const { databaseService } = require('./database/DatabaseService');
                await databaseService.runDelete(`DELETE FROM pecas_os WHERE id = ?`, [peca.id]);
                await databaseService.runDelete(
                    `DELETE FROM sync_queue WHERE resource = 'peca' AND temp_id = ?`,
                    [peca.local_id]
                );
            } catch (error) {
                Logger.error('[OSService] API deletePeca failed, falling back to offline mode', error);
                // Fallback: marcar localmente para deleção
                await PecaModel.delete(peca.id);
            }
        } else {
            // Offline: marcar localmente para deleção + sync queue
            await PecaModel.delete(peca.id);
        }

        // 3. Recalcular Totais
        if (veiculoId) {
            try {
                const veiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
                const osModel = await import('./database/models/OSModel').then(m => m.OSModel);

                await veiculoModel.recalculateTotal(veiculoId);

                const v = await veiculoModel.getById(veiculoId);
                let osId = v?.os_id;
                if (!osId && v?.os_local_id) {
                    const osLocal = await osModel.getByLocalId(v.os_local_id);
                    if (osLocal) osId = osLocal.id;
                }

                if (osId) {
                    await osModel.recalculateTotal(osId);
                }
            } catch (e) {
                console.error('[OSService] Error recalculating after deletePeca', e);
            }
        }

        // 4. Trigger Sync (para itens offline pendentes)
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.deletePeca').catch(e => console.error(e)));
        }
    },

    deleteVeiculo: async (id: number): Promise<void> => {
        Logger.info('[OSService] deleteVeiculo called', { id });

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
        let v = await VeiculoModel.getByServerId(id);
        if (!v) v = await VeiculoModel.getById(id);

        if (!v) {
            console.warn(`[OSService] Veiculo ${id} not found for deletion`);
            return;
        }

        const osIdLocal = v.os_id;
        const osUUID = v.os_local_id;

        // 1. Online-First: Tentar deletar na API primeiro
        if (isOnline && v.server_id) {
            try {
                Logger.info('[OSService] Attempting API deleteVeiculo (online mode)', { serverId: v.server_id });
                await api.delete(`/ordens-servico/veiculos/${v.server_id}`);
                Logger.info('[OSService] Veiculo deleted successfully via API');

                // Remover fisicamente do banco local
                const { databaseService } = require('./database/DatabaseService');
                await databaseService.runDelete(`DELETE FROM pecas_os WHERE veiculo_id = ?`, [v.id]);
                await databaseService.runDelete(`DELETE FROM veiculos_os WHERE id = ?`, [v.id]);
                await databaseService.runDelete(
                    `DELETE FROM sync_queue WHERE resource = 'veiculo' AND temp_id = ?`,
                    [v.local_id]
                );
            } catch (error) {
                Logger.error('[OSService] API deleteVeiculo failed, falling back to offline mode', error);
                // Fallback: marcar localmente para deleção
                await VeiculoModel.delete(v.id);
            }
        } else {
            // Offline: marcar localmente para deleção + sync queue
            await VeiculoModel.delete(v.id);
        }

        // 2. Recalcular Total da OS
        try {
            const osModel = await import('./database/models/OSModel').then(m => m.OSModel);
            let osIdToRecalc = osIdLocal;
            if (!osIdToRecalc && osUUID) {
                const os = await osModel.getByLocalId(osUUID);
                if (os) osIdToRecalc = os.id;
            }

            if (osIdToRecalc) {
                await osModel.recalculateTotal(osIdToRecalc);
            }
        } catch (e) {
            console.error('[OSService] Error recalculating after deleteVeiculo', e);
        }

        // 3. Trigger Sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.deleteVeiculo').catch(e => console.error(e)));
        }
    },

    deleteOS: async (id: number): Promise<void> => {
        Logger.info('[OSService] deleteOS', { id });

        // Tentar resolver o localId primeiro, pois precisamos dele para a operação offline
        // (lembrando que 'id' pode ser PK local ou server ID, nossa lógica de getOSById hibrida já lida com isso)
        // Mas para deletar, precisamos saber qual é o registro no banco local para marcar PENDING_DELETE

        // Estratégia: Buscar no banco local para garantir que temos o local_id
        let localOS = await OSModel.getByServerId(id);
        if (!localOS) localOS = await OSModel.getById(id);

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[OSService] Deleting OS via API');
                await api.delete(`/ordens-servico/${id}`);

                // Se sucesso na API, deletar localmente também via Model
                if (localOS) {
                    await OSModel.physicalDelete(localOS.local_id);
                }
                return;
            } catch (error) {
                Logger.error('[OSService] API delete failed, falling back to local', error);
            }
        }

        // Offline mode
        if (localOS) {
            Logger.info('[OSService] Deleting OS locally (queueing)', { localId: localOS.local_id });
            await OSModel.markAsDeleted(localOS.local_id);

            // 🔧 Trigger immediate sync
            if (!OfflineDebug.isForceOffline()) {
                import('./SyncService').then(m => m.SyncService.processQueue('OS.deleteOS_fallback').catch(e => console.error(e)));
            }
        } else {
            console.warn('[OSService] OS not found locally for deletion', id);
        }
    },
};
