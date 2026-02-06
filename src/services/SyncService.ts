// Services removed to avoid circular dependencies
// import { clienteService } from './clienteService';
// import { osService } from './osService';
// import { despesaService } from './despesaService';
import { ClienteModel } from './database/models/ClienteModel';
import { OSModel } from './database/models/OSModel';
import { DespesaModel } from './database/models/DespesaModel';
import { SyncQueueModel } from './database/models/SyncQueueModel';
import { NetInfoState } from '@react-native-community/netinfo';

export const SyncService = {
    /**
     * Sincroniza tudo:
     * 1. PUSH: Envia alterações locais para o servidor (CRÍTICO: Isso deve acontecer ANTES do Pull)
     * 2. PULL: Baixa atualizações do servidor
     */
    async syncAll(isConnected: boolean): Promise<void> {
        if (!isConnected) return;

        console.log('🔄 Iniciando Sincronização Completa...');

        try {
            // 0. Recuperar itens falhos (Retry Strategy aggressively)
            await SyncQueueModel.retryAllFailed();

            // 1. PUSH (Local -> Server)
            await this.processQueue();

            // 2. PULL (Server -> Local)
            await this.syncClientes();
            await this.syncOS();
            await this.syncDespesas();

            console.log('✅ Sincronização Completa Finalizada!');
        } catch (error) {
            console.error('❌ Erro na sincronização:', error);
        }
    },

    /**
     * Processa a fila de sincronização (PUSH)
     */
    async processQueue(): Promise<void> {
        console.log('📤 Processando fila de sincronização...');

        let pendingItem = await SyncQueueModel.getNextPending();

        while (pendingItem) {
            console.log(`🔄 Processando item: ${pendingItem.resource} - ${pendingItem.action} (ID: ${pendingItem.id}, tentativa ${pendingItem.attempts + 1})`);

            try {
                const payload = pendingItem.payload ? JSON.parse(pendingItem.payload) : null;
                let serverId: number | null = null;

                // Executar chamada de API baseada no recurso e ação
                if (pendingItem.resource === 'cliente') {
                    serverId = await this.syncClienteItem(pendingItem.action, pendingItem.temp_id, payload);

                    // CRÍTICO: Se criou sucesso, atualizar ID local imediatamente
                    if (pendingItem.action === 'CREATE' && serverId) {
                        console.log(`✅ Cliente sincronizado: UUID ${pendingItem.temp_id} → ID ${serverId}`);
                        await ClienteModel.markAsSynced(pendingItem.temp_id, serverId);
                    }
                }
                else if (pendingItem.resource === 'os') {
                    serverId = await this.syncOSItem(pendingItem.action, pendingItem.temp_id, payload);

                    if (pendingItem.action === 'CREATE' && serverId) {
                        console.log(`✅ OS sincronizada: UUID ${pendingItem.temp_id} → ID ${serverId}`);
                        await OSModel.markAsSynced(pendingItem.temp_id, serverId);
                    }
                }
                else if (pendingItem.resource === 'despesa') {
                    serverId = await this.syncDespesaItem(pendingItem.action, pendingItem.temp_id, payload);

                    if (pendingItem.action === 'CREATE' && serverId) {
                        console.log(`✅ Despesa sincronizada: UUID ${pendingItem.temp_id} → ID ${serverId}`);
                        await DespesaModel.markAsSynced(pendingItem.temp_id, serverId);
                    }
                }

                // Se não foi CREATE (UPDATE/DELETE), apenas marca como processado/removido da fila
                // Para CREATE, o markAsSynced já remove da fila
                if (pendingItem.action !== 'CREATE') {
                    // CRÍTICO: Para UPDATE, precisamos atualizar o status local para SYNCED
                    // caso contrário ele fica travado como PENDING_UPDATE e rejeita pulls futuros
                    if (pendingItem.action === 'UPDATE' && serverId) {
                        if (pendingItem.resource === 'cliente') {
                            await ClienteModel.markAsSynced(pendingItem.temp_id, serverId);
                        } else if (pendingItem.resource === 'os') {
                            // OSModel.markAsSynced cuida do status também
                            await OSModel.markAsSynced(pendingItem.temp_id, serverId);
                        } else if (pendingItem.resource === 'despesa') {
                            await DespesaModel.markAsSynced(pendingItem.temp_id, serverId);
                        }
                    } else {
                        // DELETE ou falha silenciosa em update (sem serverId?), apenas limpa fila
                        await SyncQueueModel.markAsProcessed(pendingItem.id);
                    }
                }

            } catch (error: any) {
                console.error(`❌ Erro ao processar item ${pendingItem.id}:`, error);

                // Detectar tipo de erro
                const errorType = this.detectErrorType(error);

                if (errorType === 'validation') {
                    // Erro de validação - não retry, marcar como ERROR permanente
                    console.error(`🚫 Erro de validação (permanente) para item ${pendingItem.id}:`, error.message);
                    await SyncQueueModel.markAsError(pendingItem.id, `VALIDAÇÃO: ${error.message || 'Dados inválidos'}`);
                } else {
                    // Erro de rede - permitir retry
                    console.warn(`🔄 Erro de rede para item ${pendingItem.id}, será retentado:`, error.message);
                    await SyncQueueModel.markAsError(pendingItem.id, `REDE: ${error.message || 'Erro de conexão'}`);
                }
            }

            // Pegar próximo
            pendingItem = await SyncQueueModel.getNextPending();
        }
    },

    /**
     * Detecta o tipo de erro para decidir se deve fazer retry
     * @returns 'network' para erros de rede (retry), 'validation' para erros de validação (não retry)
     */
    detectErrorType(error: any): 'network' | 'validation' {
        // Erros de rede (retry permitido)
        const networkErrors = [
            'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
            'Network request failed', 'Network Error', 'timeout',
            'ERR_NETWORK', 'ERR_CONNECTION_REFUSED'
        ];

        // Erros de validação (HTTP 400, 422, 409) - não retry
        if (error.response) {
            const status = error.response.status;
            if (status === 400 || status === 422 || status === 409) {
                return 'validation';
            }
        }

        // Checar mensagem de erro
        const errorMessage = error.message || error.toString();
        for (const networkError of networkErrors) {
            if (errorMessage.includes(networkError)) {
                return 'network';
            }
        }

        // Por padrão, tratar como erro de rede (permite retry)
        return 'network';
    },

    // --- Helpers de Item Individual ---

    async syncClienteItem(action: string, localId: string, payload: any): Promise<number | null> {
        console.log(`[SyncService] Syncing cliente: ${action}`, { localId });

        if (action === 'CREATE') {
            // Chamar API diretamente (não usar clienteService.create que tem lógica offline)
            console.log(`[SyncService] 📤 Enviando cliente para servidor:`, JSON.stringify(payload, null, 2));

            try {
                const api = (await import('./api')).default;
                const response = await api.post('/clientes', payload);
                console.log(`[SyncService] ✅ Cliente criado no servidor com ID ${response.data.id}`);
                return response.data.id;
            } catch (error: any) {
                console.error(`[SyncService] ❌ Erro ao criar cliente:`, {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    serverError: error.response?.data,
                    message: error.message,
                    payload: payload
                });
                throw error;
            }
        } else if (action === 'UPDATE') {
            // Precisamos do ID do servidor. O payload pode ter ou buscaremos pelo localId
            const localCliente = await ClienteModel.getByLocalId(localId);
            if (!localCliente?.server_id) throw new Error('Cliente sem server_id para update');

            // Usar API direta para evitar loop com clienteService (que tem lógica offline)
            const api = (await import('./api')).default;
            await api.put(`/clientes/${localCliente.server_id}`, payload);
            console.log(`[SyncService] ✅ Cliente atualizado no servidor: ID ${localCliente.server_id}`);

            return localCliente.server_id;
        } else if (action === 'DELETE') {
            const localCliente = await ClienteModel.getByLocalId(localId);
            if (localCliente?.server_id) {
                // TODO: Implement delete method in clienteService
                // await clienteService.delete(localCliente.server_id);
                console.warn('Cliente delete not implemented in API service');
            }
            return null;
        }
        return null;
    },

    async syncOSItem(action: string, localId: string, payload: any): Promise<number | null> {
        console.log(`[SyncService] Syncing OS: ${action}`, { localId });

        if (action === 'CREATE') {
            // 🆕 Resolve Client FK dynamically
            // O payload persiste o estado do momento da criação (clienteId pode ser null)
            // Precisamos atualizar com o ID real do cliente que acabou de ser sincronizado
            if (payload.clienteLocalId && (!payload.clienteId || payload.clienteId === 0)) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);
                if (client && client.server_id) {
                    payload.clienteId = client.server_id;
                    console.log(`[SyncService] 🔗 Resolved Cliente FK for OS: ${client.server_id}`);
                } else {
                    console.warn(`[SyncService] ⚠️ Could not resolve Cliente FK for OS ${localId}. Client might not be synced yet.`);
                    // Lançar erro para forçar retry (o Cliente deve sincronizar na próxima tentativa)
                    throw new Error('Dependência de Cliente não satisfeita (sem server_id)');
                }
            }

            // Chamar API diretamente (não usar osService.createOS que tem lógica offline)
            const api = (await import('./api')).default;
            const response = await api.post('/ordens-servico', payload);
            console.log(`[SyncService] OS created on server`, { serverId: response.data.id });
            return response.data.id;
        } else if (action === 'UPDATE') {
            const localOS = await OSModel.getByLocalId(localId);

            if (!localOS) {
                console.warn(`[SyncService] ⚠️ Local OS not found for update: ${localId}`);
                return null;
            }

            if (!localOS.server_id) throw new Error('OS sem server_id para update');

            // Tratamento especial para status vs update completo
            const api = (await import('./api')).default;

            if (payload.status && Object.keys(payload).length === 1) {
                await api.patch(`/ordens-servico/${localOS.server_id}/status`, payload);
            } else {
                // Update genérico (PATCH)
                // Remover campos que não devem ir para o servidor se existirem no payload (ex: id, sync_status)
                const { id, sync_status, localId, ...cleanPayload } = payload;
                await api.patch(`/ordens-servico/${localOS.server_id}`, cleanPayload);
                console.log(`[SyncService] ✅ OS atualizada no servidor (PATCH): ID ${localOS.server_id}`);
            }
            return localOS.server_id;
        } else if (action === 'DELETE') {
            const localOS = await OSModel.getByLocalId(localId);
            if (localOS?.server_id) {
                // DELETE não implementado no osService original? Verificar.
                // await osService.delete(localOS.server_id); 
            }
            return null;
        }
        return null;
    },

    async syncDespesaItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            const despesaService = (await import('./despesaService')).despesaService;
            const created = await despesaService.create(payload);
            return created.id;
        } else if (action === 'DELETE') {
            const localDespesa = await DespesaModel.getByLocalId(localId);
            if (localDespesa?.server_id) {
                // await despesaService.delete(localDespesa.server_id);
                console.warn('Despesa delete not implemented in API service');
            }
            return null;
        }
        return null;
    },

    // --- Helpers de PULL ---

    async syncClientes(): Promise<void> {
        console.log('📥 Baixando Clientes...');
        const clienteService = (await import('./clienteService')).clienteService;
        const clientes = await clienteService.getAll();
        await ClienteModel.upsertBatch(clientes);
    },

    async syncOS(): Promise<void> {
        console.log('📥 Baixando Ordens de Serviço...');
        const osService = (await import('./osService')).osService;
        const osList = await osService.listOS();
        await OSModel.upsertBatch(osList);
    },

    async syncDespesas(): Promise<void> {
        console.log('📥 Baixando Despesas...');
        // const despesaService = (await import('./despesaService')).despesaService;
        // const despesas = await despesaService.getAll();
        // await DespesaModel.upsertBatch(despesas);
        console.warn('Despesa sync not implemented - missing getAll method in despesaService');
    }
};
