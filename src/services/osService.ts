import api, { safeRequest } from './api';
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

        const fetchLocal = async () => {
            Logger.info('[OSService] Fetching clients from Local DB');
            const { ClienteModel } = require('./database/models/ClienteModel');

            // 1. Fetch from DB with DISTINCT (via model search)
            const localClients = await ClienteModel.search(filtros?.termo || '');

            const mapped: Cliente[] = localClients.map((c: any) => ({
                id: c.server_id || c.id,
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

            // 2. DIAGNOSTICS: Check for duplicates by server_id
            const dupeCheck = mapped.reduce((acc: any, c: any) => {
                if (c.id) acc[c.id] = (acc[c.id] || 0) + 1;
                return acc;
            }, {});
            const hasDupes = Object.entries(dupeCheck).filter(([_, count]: any) => count > 1);
            if (hasDupes.length > 0) {
                Logger.info('⚠️ [OSService] DUPLICATAS ENCONTRADAS (server_id):', hasDupes);
            }

            // 3. Force unique by localId AND server_id (Safety fallback for React Keys)
            const uniqueByLocalId = Array.from(new Map(mapped.map((item: Cliente) => [item.localId, item])).values());

            // Second pass: deduplicate by server_id (id) if present
            const finalUnique = Array.from(new Map(uniqueByLocalId.map((item: Cliente) => [item.id || item.localId, item])).values());

            return finalUnique;
        };

        if (isOnline) {
            return await safeRequest(
                async () => {
                    Logger.info('[OSService] Fetching clients from API');
                    const params = new URLSearchParams();
                    if (filtros) {
                        Object.entries(filtros).forEach(([key, value]) => {
                            if (value) params.append(key, value);
                        });
                    }
                    const response = await api.get<Cliente[]>(`/clientes?${params.toString()}`);

                    // Cache side-effect
                    if (response.data) {
                        const { ClienteModel } = require('./database/models/ClienteModel');
                        await ClienteModel.upsertBatch(response.data);
                    }
                    return response;
                },
                fetchLocal,
                'OSService.listClientes'
            );
        }

        return await fetchLocal();
    },

    // --- Ordem de Serviço (Core) ---
    /**
     * Criar OS com suporte offline-first
     * - Se online: tenta criar na API e salva localmente
     * - Se offline: salva localmente (incluindo hierarquia) e adiciona à fila
     */
    createOS: async (data: CreateOSRequest): Promise<OrdemServico> => {
        Logger.info('[OSService] Creating OS (Strict UUID Linkage Pattern)', {
            clienteLocalId: data.clienteLocalId,
            data: data.data
        });

        // 🛡️ Secure Context
        const { authService } = require('./authService');
        const session = await authService.getSessionClaims();

        if (!session?.empresaId) {
            throw new Error('Empresa ID não encontrado na sessão. Faça login novamente.');
        }

        const empresaId = session.empresaId;

        // 1. Resolve o cliente para garantir vínculo via Local ID (UUID)
        const { ClienteModel } = require('./database/models/ClienteModel');
        const cliente = await ClienteModel.getByLocalId(data.clienteLocalId);
        if (!cliente) {
            throw new Error(`Cliente local não encontrado: ${data.clienteLocalId}`);
        }

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        // 2. Criar Localmente (Priorizando cliente_local_id)
        const localOS = await OSModel.create({
            ...data,
            clienteId: cliente.server_id || undefined, // Atachamos o server_id se já existir
            clienteLocalId: cliente.local_id,
            empresaId
        }, 'PENDING_CREATE');

        Logger.info('[OSService] OS created locally (Strict Link)', {
            localId: localOS.local_id,
            clienteLocalId: localOS.cliente_local_id
        });

        // 3. Se Online, Tentar Sincronizar Imediatamente
        if (isOnline) {
            try {
                Logger.info('[OSService] Attempting immediate API sync...');
                // Preparamos o payload para o backend. 
                // Se o cliente já tem server_id, enviamos. Senão, o backend criará a OS pendente.
                const apiPayload = {
                    ...data,
                    clienteId: cliente.server_id // Pode ser null se cliente for offline-only
                };

                const response = await api.post<OrdemServico>('/ordens-servico', apiPayload);

                // 4. Sucesso: Anexar Server ID e Marcar como Syncado
                Logger.info('[OSService] Immediate Sync Success. Attaching Server ID:', response.data.id);
                await OSModel.attachServerId(localOS.local_id, response.data.id, response.data.updatedAt);

                return response.data;
            } catch (error) {
                Logger.warn('[OSService] Immediate sync failed, staying in offline mode', error);
            }
        }

        // 5. Trigger Background Sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.create_strict').catch(e => console.error(e)));
        }

        return await OSModel.toApiFormat(localOS);
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

        const { authService } = require('./authService');
        const session = await authService.getSessionClaims();

        if (!session?.empresaId) {
            throw new Error('Sessão inválida ou expirada (empresaId missing).');
        }

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        const fetchLocal = async () => {
            Logger.info('[OSService] Attempting to find OS locally (fallback)');
            const localFull = await OSModel.getByIdFull(id, session.empresaId);
            if (localFull) return localFull;
            throw new Error('Ordem de serviço não encontrada no banco local.');
        };

        if (isOnline) {
            return await safeRequest(
                async () => {
                    Logger.info('[OSService] Fetching OS from API (online-first)', { id });
                    const response = await api.get<OrdemServico>(`/ordens-servico/${id}`);

                    if (response.data) {
                        await OSModel.upsertFromServer(response.data, session.empresaId);
                    }

                    // We return converted local format to ensure UI consistency
                    // OR we could return response.data directly. 
                    // To follow the plan "return local always", we'll do:
                    const localOS = await OSModel.upsertFromServer(response.data, session.empresaId);
                    return { data: await OSModel.toApiFormat(localOS) };
                },
                fetchLocal,
                'OSService.getOSById'
            );
        }

        return await fetchLocal();
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

        // 🚀 Event-Based Refresh: Notify listeners (OSListScreen) to refresh immediately
        const { DeviceEventEmitter } = require('react-native');
        DeviceEventEmitter.emit('osStatusChanged', { id, status });

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

                if (!response || !response.data) {
                    throw new Error('Invalid API response for addVeiculo');
                }

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

        // 1. Resolver OS Local (Grampo de UUID é prioritário para evitar bagunça)
        let os = null;
        if (data.osLocalId) {
            os = await OSModel.getByLocalId(data.osLocalId);
        }

        // Se não achou por UUID, tenta pelos IDs numéricos (podem ser ambíguos)
        if (!os) {
            os = await OSModel.getByServerId(data.ordemServicoId);
        }
        if (!os) {
            os = await OSModel.getById(data.ordemServicoId);
        }

        if (!os) {
            throw new Error(`OS não encontrada para vincular veículo (ID: ${data.ordemServicoId} / UUID: ${data.osLocalId})`);
        }

        // 2. Salvar localmente
        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);

        let localVeiculo;
        try {
            console.log('[OSService] Calling VeiculoModel.create...');
            localVeiculo = await VeiculoModel.create({
                ...data,
                osLocalId: os.local_id
            });
            console.log('[OSService] VeiculoModel.create success');
        } catch (e: any) {
            console.error('[OSService] ❌ CRASH in VeiculoModel.create:', e.message);
            console.error('[OSService] Stack:', e.stack);
            throw e;
        }

        // 3. Recalcular Totais (Novidade: Garantir que a OS reflita o novo veículo)
        try {
            await OSModel.recalculateTotal(os.local_id);
        } catch (e) {
            console.error('[osService] Failed to recalculate OS total:', e);
        }

        // 4. Trigger Sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('OS.addVeiculo').catch(e => console.error(e)));
        }

        return {
            id: localVeiculo.server_id || localVeiculo.id,
            localId: localVeiculo.local_id, // Incluir localId no retorno para o UI
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

        // 1. Resolver Veículo Local (Prioridade UUID)
        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
        let veiculo = null;
        if (data.veiculoLocalId) {
            veiculo = await VeiculoModel.getByLocalId(data.veiculoLocalId);
        }

        if (!veiculo) {
            veiculo = await VeiculoModel.getByServerId(data.veiculoId);
        }
        if (!veiculo) {
            veiculo = await VeiculoModel.getById(data.veiculoId);
        }

        if (!veiculo) {
            throw new Error(`Veículo não encontrado (ID: ${data.veiculoId} / UUID: ${data.veiculoLocalId})`);
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
            localId: localPeca.local_id,
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
