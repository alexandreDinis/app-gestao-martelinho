import api from './api';
import { Cliente, ClienteRequest, ClienteFiltros } from '../types';
import { ClienteModel } from './database/models/ClienteModel';
import { OfflineDebug } from '../utils/OfflineDebug';
import { databaseService } from './database/DatabaseService';

// Logger simples inline
const Logger = {
    info: (msg: string, data?: any) => console.log(`[INFO] ${msg}`, data || ''),
    error: (msg: string, data?: any) => console.error(`[ERROR] ${msg}`, data || ''),
    debug: (msg: string, data?: any) => console.log(`[DEBUG] ${msg}`, data || '')
};

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

        // 🔧 Garantir que endereco não esteja vazio (backend exige)
        const payload = {
            ...data,
            endereco: data.endereco || data.logradouro || '' // Fallback para logradouro
        };

        // 🔧 DEBUG: Verificar conectividade (respeita modo forceOffline)
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable;

        Logger.debug('[ClienteService] Network status', { isOnline, isConnected, isInternetReachable });

        if (isOnline) {
            // Tentar criar na API primeiro
            try {
                Logger.info('[ClienteService] Attempting API create (online mode)');
                const response = await api.post<Cliente>('/clientes', payload);

                // Salvar no cache local como SYNCED
                await ClienteModel.upsertFromServer(response.data);

                Logger.info('[ClienteService] Cliente created successfully via API', { id: response.data.id });
                return response.data;
            } catch (error) {
                Logger.error('[ClienteService] API create failed, falling back to offline mode', error);
                // Se falhar, continua para modo offline
            }
        }

        // Modo offline: salvar localmente e adicionar à fila
        Logger.info('[ClienteService] Creating cliente in offline mode');
        const localCliente = await ClienteModel.create(payload, 'PENDING_CREATE');

        Logger.info('[ClienteService] Cliente created locally', {
            localId: localCliente.local_id,
            queuedForSync: true
        });

        // Converter para formato da API para retornar
        return ClienteModel.toApiFormat(localCliente);
    },

    update: async (id: number, data: Partial<ClienteRequest>): Promise<Cliente> => {
        Logger.info('[ClienteService] Updating cliente', { id });

        // 🔧 Garantir que endereco não esteja vazio (backend exige)
        const payload = {
            ...data,
            endereco: data.endereco || data.logradouro || '' // Fallback para logradouro
        };

        // 🔧 OFFLINE FIRST: Se estiver offline, salvar localmente
        // 🔧 OFFLINE FIRST: Se estiver offline, salvar localmente
        if (OfflineDebug.isForceOffline()) {
            Logger.info('[ClienteService] Offline mode - saving locally');

            const localCliente = await ClienteModel.getByServerId(id);
            if (!localCliente) {
                throw new Error('Cliente não encontrado no banco local');
            }

            // Atualizar dados locais usando o Model (que gerencia o status PENDING_UPDATE)
            // Aqui passamos o ID local (Primary Key), não o server_id
            await ClienteModel.update(localCliente.id, {
                ...payload,
                // Garantir que campos obrigatórios não sejam perdidos se não vierem no payload
                razaoSocial: payload.razaoSocial || localCliente.razao_social,
                nomeFantasia: payload.nomeFantasia || localCliente.nome_fantasia,
                contato: payload.contato || localCliente.contato || '',
                email: payload.email || localCliente.email || '',
                status: (payload.status || localCliente.status) as 'ATIVO' | 'INATIVO',
                // Address ...
                logradouro: payload.logradouro || localCliente.logradouro || '',
                numero: payload.numero || localCliente.numero || '',
                bairro: payload.bairro || localCliente.bairro || '',
                cidade: payload.cidade || localCliente.cidade || '',
                estado: payload.estado || localCliente.estado || '',
                cep: payload.cep || localCliente.cep || ''
            });

            Logger.info('[ClienteService] Cliente updated locally via Model.update');

            // Retornar o objeto atualizado (buscando do banco para garantir)
            const updated = await ClienteModel.getById(localCliente.id);
            return ClienteModel.toApiFormat(updated!);
        }

        // Online: fazer update normal na API
        const response = await api.put<Cliente>(`/clientes/${id}`, payload);
        Logger.info('[ClienteService] Cliente updated successfully', { id });

        // Atualizar no cache local também, se existir
        const localCliente = await ClienteModel.getByServerId(id);
        if (localCliente) {
            await ClienteModel.upsertFromServer(response.data);
        }

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
