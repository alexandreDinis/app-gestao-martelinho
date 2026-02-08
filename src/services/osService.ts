import api from './api';
import { OSModel } from './database/models/OSModel';
import { Logger } from './Logger';
import { OfflineDebug } from '../utils/OfflineDebug';
import * as SecureStore from 'expo-secure-store';
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
                await OSModel.upsertFromServer(response.data);

                Logger.info('[OSService] OS created successfully via API', { id: response.data.id });
                return response.data;
            } catch (error) {
                Logger.warn('[OSService] API create failed, falling back to offline mode', error);
                // Se falhar, continua para modo offline
            }
        }

        // Modo offline: salvar localmente e adicionar à fila
        Logger.info('[OSService] Creating OS in offline mode');
        const localOS = await OSModel.create(data, 'PENDING_CREATE');

        Logger.info('[OSService] OS created locally', {
            localId: localOS.local_id,
            queuedForSync: true
        });

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
            usuarioId: 0,
            usuarioNome: undefined,
            usuarioEmail: '',
            empresaId: 1 // Default or from context
        };
    },

    // --- In-flight Promise ---
    _listOSPromise: null as Promise<OrdemServico[]> | null,

    listOS: async (): Promise<OrdemServico[]> => {
        // Deduplication: If a read is already in progress, return it
        if (osService._listOSPromise) {
            Logger.info('[OSService] listOS - returning in-flight promise');
            return osService._listOSPromise;
        }

        osService._listOSPromise = (async () => {
            try {
                // Pure Read-Only implementation
                Logger.info('[OSService] listOS - fetching full hierarchy from Local DB (JOIN)');
                const mappedList = await OSModel.getAllFull();
                console.log(`[OSService] ✅ Returning ${mappedList.length} OS items to UI`);
                return mappedList;
            } finally {
                osService._listOSPromise = null;
            }
        })();

        return osService._listOSPromise;
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

        try {
            // 1. Tentar local primeiro (JOIN Otimizado) - Suporta ID numérico ou UUID
            const localFull = await OSModel.getByIdFull(id);

            if (localFull) {
                Logger.info('[OSService] Found full OS locally (JOIN)');
                // Recalcular total por segurança (ainda local)
                // Usamos o ID numérico do objeto local para o recálculo se necessário
                const localId = (localFull as any).local_id_pk || localFull.id;
                // Nota: O getByIdFull retorna formato OrdemServico. Se precisarmos recalcular, 
                // precisaríamos do ID interno do SQLite. Por enquanto, assumimos que o JOIN trouxe dados frescos.
                return localFull;
            }

            // 2. Se não achar local e estiver online, buscar API
            if (!OfflineDebug.isForceOffline()) {
                Logger.info('[OSService] Not found locally, fetching from API');
                const response = await api.get<OrdemServico>(`/ordens-servico/${id}`);

                // Salvar no cache para acesso futuro offline
                const localOS = await OSModel.upsertFromServer(response.data);

                // Retornar formato consistente
                return await OSModel.toApiFormat(localOS);
            }
        } catch (error) {
            Logger.error('[OSService] Error in getOSById', error);
        }

        throw new Error('Ordem de serviço não encontrada.');
    },

    updateStatus: async (id: number, status: OSStatus): Promise<OrdemServico> => {
        Logger.info('[OSService] updateStatus', { id, status });

        // Offline-First: Salvar status localmente e enfileirar sync
        const localUpdated = await OSModel.updateStatus(id, status);

        if (!localUpdated) {
            throw new Error('OS não encontrada localmente para atualização de status.');
        }

        // Tentar sincronizar imediatamente se estiver online
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            // Disparar sync em background para não bloquear UI, ou await se quisermos garantir envio
            // Como a UI já atualizou com o retorno local, podemos deixar background.
            // Mas para garantir feedbacks de erro, pode ser útil.
            // Vamos chamar processQueue() que processa itens pendentes
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
        }

        return await OSModel.toApiFormat(localUpdated);
    },

    updateOS: async (id: number, data: any): Promise<OrdemServico> => {
        Logger.info('[OSService] updateOS called', { id, data });

        // Map API keys to Local DB keys if necessary
        const localData: any = { ...data };
        if (data.usuarioId !== undefined) {
            localData.usuario_id = data.usuarioId;
            delete localData.usuarioId;

            // Resolve name/email if missing to ensure UI displays correctly
            if (!data.usuarioNome || !data.usuarioEmail) {
                try {
                    const { UserModel } = require('./database/models/UserModel');
                    const users = await UserModel.getAll();
                    const user = users.find((u: any) => u.id === data.usuarioId);
                    if (user) {
                        localData.usuario_nome = user.name;
                        localData.usuario_email = user.email;
                        console.log(`[OSService] 👤 Resolved details for responsible user ${data.usuarioId}: ${user.name}`);
                    }
                } catch (e) {
                    console.error('[OSService] Failed to resolve user details', e);
                }
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
        console.log('[OSService] 💾 OS Updated locally:', localUpdated ? 'SUCCESS' : 'not found');

        if (!localUpdated) {
            throw new Error('OS não encontrada localmente para atualização.');
        }

        // Tentar sincronizar imediatamente se estiver online
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            // Trigger process queue
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
        }

        return await OSModel.toApiFormat(localUpdated);
    },

    addVeiculo: async (data: AddVeiculoRequest): Promise<VeiculoOS> => {
        Logger.info('[OSService] addVeiculo called', data);

        // 1. Resolver OS Local (para garantir vínculo correto offline)
        // O ID vindo da UI pode ser ServerID ou LocalID
        let os = await import('./database/models/OSModel').then(m => m.OSModel.getByServerId(data.ordemServicoId));
        if (!os) {
            os = await import('./database/models/OSModel').then(m => m.OSModel.getById(data.ordemServicoId));
        }

        if (!os) {
            throw new Error(`OS não encontrada para vincular veículo: ${data.ordemServicoId}`);
        }

        Logger.info(`[OSService] Adding vehicle to OS: ${os.id} (Server: ${os.server_id}, LocalUUID: ${os.local_id})`);

        // 2. Salvar localmente
        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
        const localVeiculo = await VeiculoModel.create({
            ...data,
            osLocalId: os.local_id
        });

        console.log('[OSService] 💾 Veiculo saved locally:', localVeiculo.id);

        // 3. Trigger Sync (se online)
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            // Trigger background sync
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
        }

        // 4. Retornar formato exigido pela UI (VeiculoOS)
        return {
            id: localVeiculo.server_id || localVeiculo.id,
            placa: localVeiculo.placa,
            modelo: localVeiculo.modelo || '',
            cor: localVeiculo.cor || '',
            valorTotal: localVeiculo.valor_total || 0,
            pecas: [] // Recém criado não tem peças
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

        // 1. Resolver Veículo Local
        // O ID pode ser ServerID ou LocalID (PK)
        let veiculo = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel.getByServerId(data.veiculoId));
        if (!veiculo) {
            veiculo = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel.getById(data.veiculoId));
        }

        if (!veiculo) {
            throw new Error(`Veículo não encontrado: ${data.veiculoId}`);
        }

        // 2. Salvar localmente
        const PecaModel = await import('./database/models/PecaModel').then(m => m.PecaModel);
        const localPeca = await PecaModel.create({
            ...data,
            veiculoLocalId: veiculo.local_id
        });

        console.log('[OSService] 💾 Peca saved locally:', localPeca.id);

        // 3. Recalcular Totais (Cascada)
        try {
            const osModel = await import('./database/models/OSModel').then(m => m.OSModel);
            const veiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);

            await veiculoModel.recalculateTotal(veiculo.id);

            // Resolver ID da OS
            let osId = veiculo.os_id;
            if (!osId && veiculo.os_local_id) {
                const osLocal = await osModel.getByLocalId(veiculo.os_local_id);
                if (osLocal) osId = osLocal.id;
            }

            if (osId) {
                await osModel.recalculateTotal(osId);
            }
        } catch (recalcError) {
            console.error('[OSService] ⚠️ Error recalculating totals:', recalcError);
        }

        // 4. Trigger Sync (se online)
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
        }

        // 4. Retornar formato API (PecaOS)
        return {
            id: localPeca.server_id || localPeca.id,
            nomePeca: localPeca.nome_peca || '',
            valorCobrado: localPeca.valor_cobrado || 0,
            descricao: localPeca.descricao || ''
        };
    },

    deletePeca: async (id: number): Promise<void> => {
        Logger.info('[OSService] deletePeca called', { id });

        // 1. Resolver peça local
        // O ID pode ser ServerID ou LocalID
        const PecaModel = await import('./database/models/PecaModel').then(m => m.PecaModel);
        let peca = await PecaModel.getByServerId(id);
        if (!peca) peca = await PecaModel.getById(id);

        if (!peca) {
            console.warn(`[OSService] Peca ${id} not found for deletion, maybe already deleted?`);
            return;
        }

        const veiculoId = peca.veiculo_id;

        // 2. Deletar localmente
        await PecaModel.delete(peca.id);

        // 3. Recalcular Totais
        if (veiculoId) {
            try {
                const veiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
                const osModel = await import('./database/models/OSModel').then(m => m.OSModel);

                const newVeiculoTotal = await veiculoModel.recalculateTotal(veiculoId);

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

        // 4. Trigger Sync (se online)
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
        }
    },

    deleteVeiculo: async (id: number): Promise<void> => {
        Logger.info('[OSService] deleteVeiculo called', { id });

        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);
        let v = await VeiculoModel.getByServerId(id);
        if (!v) v = await VeiculoModel.getById(id);

        if (!v) {
            console.warn(`[OSService] Veiculo ${id} not found for deletion`);
            return;
        }

        const osIdLocal = v.os_id;
        const osUUID = v.os_local_id;

        // 1. Deletar localmente
        await VeiculoModel.delete(v.id);

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
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
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
        } else {
            console.warn('[OSService] OS not found locally for deletion', id);
        }
    },
};
