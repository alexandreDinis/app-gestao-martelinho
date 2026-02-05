import api from './api';
import NetInfo from '@react-native-community/netinfo';
import { Cliente, ClienteRequest, ClienteFiltros } from '../types';
import { ClienteModel } from './database/models/ClienteModel';
import { Logger } from './Logger';

export const clienteService = {
    getAll: async (): Promise<Cliente[]> => {
        const response = await api.get<Cliente[]>('/clientes');
        return response.data;
    },

    getById: async (id: number): Promise<Cliente> => {
        const response = await api.get<Cliente>(`/clientes/${id}`);
        return response.data;
    },

    /**
     * Criar cliente com suporte offline-first
     * - Se online: tenta criar na API e salva localmente
     * - Se offline: salva localmente e adiciona à fila de sync
     */
    create: async (data: ClienteRequest): Promise<Cliente> => {
        Logger.info('[ClienteService] Creating cliente', { razaoSocial: data.razaoSocial });

        // Verificar conectividade
        const netState = await NetInfo.fetch();
        const isOnline = netState.isConnected && netState.isInternetReachable;

        Logger.debug('[ClienteService] Network status', { isOnline });

        if (isOnline) {
            // Tentar criar na API primeiro
            try {
                Logger.info('[ClienteService] Attempting API create (online mode)');
                const response = await api.post<Cliente>('/clientes', data);

                // Salvar no cache local como SYNCED
                await ClienteModel.upsertFromServer(response.data);

                Logger.info('[ClienteService] Cliente created successfully via API', { id: response.data.id });
                return response.data;
            } catch (error) {
                Logger.warn('[ClienteService] API create failed, falling back to offline mode', error);
                // Se falhar, continua para modo offline
            }
        }

        // Modo offline: salvar localmente e adicionar à fila
        Logger.info('[ClienteService] Creating cliente in offline mode');
        const localCliente = await ClienteModel.create(data, 'PENDING_CREATE');

        Logger.info('[ClienteService] Cliente created locally', {
            localId: localCliente.local_id,
            queuedForSync: true
        });

        // Converter para formato da API para retornar
        return ClienteModel.toApiFormat(localCliente);
    },

    update: async (id: number, data: Partial<ClienteRequest>): Promise<Cliente> => {
        const response = await api.put<Cliente>(`/clientes/${id}`, data);
        return response.data;
    },

    search: async (filtros: ClienteFiltros): Promise<Cliente[]> => {
        const params = new URLSearchParams();
        if (filtros.termo) params.append('termo', filtros.termo);
        if (filtros.cidade) params.append('cidade', filtros.cidade);
        if (filtros.bairro) params.append('bairro', filtros.bairro);
        if (filtros.status) params.append('status', filtros.status);

        const response = await api.get<Cliente[]>(`/clientes/search?${params.toString()}`);
        return response.data;
    },
};
