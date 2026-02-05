import api from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import type {
    Cliente, ClienteRequest, ClienteFiltros,
    OrdemServico, CreateOSRequest,
    AddVeiculoRequest, AddPecaRequest, UpdateOSStatusRequest,
    VeiculoOS, OSStatus
} from '../types';

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
    createOS: async (data: CreateOSRequest): Promise<OrdemServico> => {
        const response = await api.post<OrdemServico>('/ordens-servico', data);
        return response.data;
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
            const userStr = await AsyncStorage.getItem('user');
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
