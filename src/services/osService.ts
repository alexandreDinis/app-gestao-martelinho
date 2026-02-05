import api from './api';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { Linking } from 'react-native';
import type {
    Cliente, ClienteRequest, ClienteFiltros,
    OrdemServico, CreateOSRequest,
    AddVeiculoRequest, AddPecaRequest, UpdateOSStatusRequest,
    VeiculoOS, OSStatus
} from '../types';
import { OSModel } from './database/models/OSModel';
import { Logger } from './Logger';

export const osService = {
    // --- Clients ---
    listClientes: async (filtros?: ClienteFiltros): Promise<Cliente[]> => {
        const params = new URLSearchParams();
        if (filtros) {
            Object.entries(filtros).forEach(([key, value]) => {
                if (value) params.append(key, value);
            });
        }
        const response = await api.get<Cliente[]>(`/clientes?${params.toString()}`);
        return response.data;
    },

    // --- Ordem de Serviço (Core) ---
    /**
     * Criar OS com suporte offline-first
     * - Se online: tenta criar na API e salva localmente
     * - Se offline: salva localmente (incluindo hierarquia) e adiciona à fila
     */
    createOS: async (data: CreateOSRequest): Promise<OrdemServico> => {
        Logger.info('[OSService] Creating OS', { clienteId: data.clienteId, data: data.data });

        // Verificar conectividade
        const netState = await NetInfo.fetch();
        const isOnline = netState.isConnected && netState.isInternetReachable;

        Logger.debug('[OSService] Network status', { isOnline });

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
            deletedAt: null,
            updatedAt: new Date(localOS.updated_at).toISOString()
        };
    },

    listOS: async (): Promise<OrdemServico[]> => {
        const response = await api.get<OrdemServico[]>('/ordens-servico');
        return response.data;
    },

    getOSById: async (id: number): Promise<OrdemServico> => {
        const response = await api.get<OrdemServico>(`/ordens-servico/${id}`);
        return response.data;
    },

    updateStatus: async (id: number, status: OSStatus): Promise<OrdemServico> => {
        const payload: UpdateOSStatusRequest = { status };
        // Assuming PATCH is supported, otherwise use PUT if backend specifically needs it
        const response = await api.patch<OrdemServico>(`/ordens-servico/${id}/status`, payload);
        return response.data;
    },

    updateOS: async (id: number, data: any): Promise<OrdemServico> => {
        const response = await api.patch<OrdemServico>(`/ordens-servico/${id}`, data);
        return response.data;
    },

    addVeiculo: async (data: AddVeiculoRequest): Promise<VeiculoOS> => {
        const response = await api.post<VeiculoOS>('/ordens-servico/veiculos', data);
        return response.data;
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
        const response = await api.get(`/veiculos/verificar-placa`, {
            params: { placa }
        });
        return response.data;
    },

    getHistoricoVeiculo: async (placa: string): Promise<any[]> => {
        console.log('[osService] Fetching history for placa:', placa);
        const response = await api.get<any>(`/veiculos/${placa}/historico`);
        console.log('[osService] History response:', JSON.stringify(response.data, null, 2));
        // API returns HistoricoItem[] directly - array of { ordemServicoId, data, status, valorTotalServico, pecasOuServicos }
        return response.data || [];
    },

    // --- Catalog (Tipos de Peça) ---
    listTiposPeca: async (): Promise<any[]> => {
        const response = await api.get('/tipos-peca');
        return response.data;
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
        await api.delete(`/ordens-servico/${id}`);
    },
};
