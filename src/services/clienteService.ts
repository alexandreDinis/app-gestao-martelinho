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
    getAll: async (since?: string): Promise<Cliente[]> => {
        const response = await api.get<Cliente[]>('/clientes', {
            params: { since }
        });
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

        // 🔧 Trigger immediate sync attempt if not in forced offline mode
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('Cliente.create_fallback').catch(e => console.error(e)));
        }

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

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            // Tentar update na API primeiro
            try {
                Logger.info('[ClienteService] Attempting API update (online mode)');
                const response = await api.put<Cliente>(`/clientes/${id}`, payload);
                Logger.info('[ClienteService] Cliente updated successfully via API', { id });

                // Atualizar no cache local como SYNCED
                const localCliente = await ClienteModel.getByServerId(id);
                if (localCliente) {
                    await ClienteModel.upsertFromServer(response.data);
                }

                return response.data;
            } catch (error) {
                Logger.error('[ClienteService] API update failed, falling back to offline mode', error);
                // Continua para modo offline
            }
        }

        // Modo offline: salvar localmente via Model (que gerencia o status PENDING_UPDATE e fila)
        Logger.info('[ClienteService] Updating cliente in offline mode');

        const localCliente = await ClienteModel.getByServerId(id);
        if (!localCliente) {
            throw new Error('Cliente não encontrado no banco local para atualização');
        }

        const updated = await ClienteModel.update(localCliente.id, {
            ...payload,
            // Garantir que campos obrigatórios não sejam perdidos
            razaoSocial: payload.razaoSocial || localCliente.razao_social,
            nomeFantasia: payload.nomeFantasia || localCliente.nome_fantasia || undefined,
            contato: payload.contato || localCliente.contato || '',
            email: payload.email || localCliente.email || '',
            status: (payload.status || localCliente.status) as 'ATIVO' | 'INATIVO',
            logradouro: payload.logradouro || localCliente.logradouro || '',
            numero: payload.numero || localCliente.numero || '',
            bairro: payload.bairro || localCliente.bairro || '',
            cidade: payload.cidade || localCliente.cidade || '',
            estado: payload.estado || localCliente.estado || '',
            cep: payload.cep || localCliente.cep || ''
        });

        Logger.info('[ClienteService] Cliente updated locally', { localId: localCliente.local_id });

        // 🔧 Trigger immediate sync attempt if not in forced offline mode
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('Cliente.update_fallback').catch(e => console.error(e)));
        }

        return ClienteModel.toApiFormat(updated!);
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
