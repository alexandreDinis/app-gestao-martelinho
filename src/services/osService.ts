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
    VeiculoOS, OSStatus
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

    listOS: async (): Promise<OrdemServico[]> => {
        // 1. Fetch from Local DB (always fast)
        Logger.info('[OSService] listOS - fetching from local DB');
        let localOSList = await OSModel.getAll();

        // 2. If Online & Not Force Offline, Sync with API
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            try {
                Logger.info('[OSService] listOS - fetching from API');

                // Fetch from API
                const response = await api.get<OrdemServico[]>('/ordens-servico');

                if (response.data) {
                    Logger.info(`[OSService] Received ${response.data.length} OSs from API`);

                    // Update Local DB with fresh data
                    await OSModel.upsertBatch(response.data);

                    // Re-fetch from Local DB to ensure consistency (and include any pending local changes via zombie check logic in upsert)
                    // This way we return the "Merged" view of Reality (Server + Local Edits)
                    localOSList = await OSModel.getAll();
                }
            } catch (error) {
                Logger.error('[OSService] API fetch failed, using local data', error);
                // Continue with local data
            }
        } else {
            Logger.info('[OSService] listOS - Force Offline is ON, skipping API');
        }

        // 3. Map to API Format
        console.log(`[OSService] 🔄 Mapping ${localOSList.length} local records to API format...`);
        const mappedList = await Promise.all(localOSList.map(async (local) => {
            return await OSModel.toApiFormat(local);
        }));

        console.log(`[OSService] ✅ Returning ${mappedList.length} OS items to UI`);
        return mappedList;
    },

    getOSById: async (id: number): Promise<OrdemServico> => {
        Logger.info('[OSService] getOSById', { id });

        // 1. Tentar local primeiro (Pelo Server ID)
        let local = await OSModel.getByServerId(id);

        // 2. Se não achar pelo Server ID, tentar pelo ID Local (caso seja uma OS criada offline)
        if (!local) {
            local = await OSModel.getById(id);
            if (local) {
                Logger.info('[OSService] Found locally via Local ID (Offline created)');
            }
        } else {
            Logger.info('[OSService] Found locally via Server ID');
        }

        if (local) {
            return await OSModel.toApiFormat(local);
        }

        // 3. Se não achar local e estiver online, buscar API
        // Mas idealmente o sync já deve ter trazido.
        // Fallback API apenas se não for forceOffline
        if (!OfflineDebug.isForceOffline()) {
            Logger.info('[OSService] Not found locally, fetching from API');
            const response = await api.get<OrdemServico>(`/ordens-servico/${id}`);
            // Salvar no cache? Talvez.
            await OSModel.upsertFromServer(response.data);
            return response.data;
        }

        throw new Error('OS não encontrada localmente e modo offline ativo');
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

        // Offline-First: Salvar localmente e enfileirar sync
        const localUpdated = await OSModel.update(id, data);
        console.log('[OSService] 💾 OS Updated locally:', localUpdated ? 'SUCCESS' : 'not found');

        if (!localUpdated) {
            throw new Error('OS não encontrada localmente para atualização.');
        }

        // Tentar sincronizar imediatamente se estiver online
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        if (isConnected && isInternetReachable && !OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue().catch(e => console.error(e)));
        }

        return await OSModel.toApiFormat(localUpdated);
    },

    addVeiculo: async (data: AddVeiculoRequest): Promise<VeiculoOS> => {
        // 1. Resolver OS local para obter IDs corretos (Server vs Local)
        // data.ordemServicoId aqui é o ID Local (PK) vindo da navegação
        const localOS = await import('./database/models/OSModel').then(m => m.OSModel.getById(data.ordemServicoId));

        if (!localOS) {
            // Se não existir localmente, é um erro crítico de estado da UI
            throw new Error('OS não encontrada localmente.');
        }

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        // 2. Tentar API se estiver Online E a OS já estiver sincronizada (tem server_id)
        if (isOnline && localOS.server_id) {
            try {
                Logger.info('[osService] Adding vehicle to API');
                // IMPORTANTE: Enviar server_id para a API
                const apiData = { ...data, ordemServicoId: localOS.server_id! };
                const response = await api.post<VeiculoOS>('/ordens-servico/veiculos', apiData);

                // Salvar/Atualizar localmente para manter coerência
                await import('./database/models/VeiculoModel').then(m => m.VeiculoModel.upsertFromServer(response.data, localOS.id));

                return response.data;
            } catch (error) {
                Logger.error('[osService] Failed to add vehicle online, falling back to local queue', error);
                // Fallback para lógica offline abaixo se falhar rede
            }
        }

        // 3. Fallback Offline (ou OS não sincronizada)
        Logger.info('[osService] Adding vehicle locally (Queue/Offline)');
        const VeiculoModel = await import('./database/models/VeiculoModel').then(m => m.VeiculoModel);

        const localVeiculo = await VeiculoModel.create({
            ...data,
            // Se tiver server_id usa, senão null. O VeiculoModel vai tentar resolver.
            ordemServicoId: localOS.server_id || 0, // Fallback safe if unresolved, likely won't sync if 0 but valid type
            osLocalId: localOS.local_id
        });

        // Converter para formato API para a UI não quebrar
        return {
            id: localVeiculo.id, // Retorna ID local temporariamente
            placa: localVeiculo.placa,
            modelo: localVeiculo.modelo || '',
            cor: localVeiculo.cor || '',
            valorTotal: localVeiculo.valor_total || 0,
            // Outros campos se necessário
        } as VeiculoOS;
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
    addPeca: async (data: AddPecaRequest): Promise<any> => {
        const response = await api.post('/ordens-servico/pecas', data);
        return response.data;
    },

    deletePeca: async (id: number): Promise<OrdemServico> => {
        const response = await api.delete<OrdemServico>(`/ordens-servico/pecas/${id}`);
        return response.data;
    },

    deleteVeiculo: async (id: number): Promise<void> => {
        await api.delete(`/ordens-servico/veiculos/${id}`);
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
