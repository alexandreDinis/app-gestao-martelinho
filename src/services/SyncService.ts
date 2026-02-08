// Services removed to avoid circular dependencies
// import { clienteService } from './clienteService';
// import { osService } from './osService';
// import { despesaService } from './despesaService';
import { ClienteModel } from './database/models/ClienteModel';
import { OSModel } from './database/models/OSModel';
import { VeiculoModel } from './database/models/VeiculoModel';
import { PecaModel } from './database/models/PecaModel';
import { DespesaModel } from './database/models/DespesaModel';
import { SyncQueueModel } from './database/models/SyncQueueModel';
import * as SecureStore from 'expo-secure-store';
import { NetInfoState } from '@react-native-community/netinfo';
import api from './api';

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
            try {
                await this.syncMetadata(); // Users and Part Types FIRST
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar metadados:', err);
            }

            try {
                await this.syncClientes();
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar clientes:', err);
            }

            try {
                await this.syncOS();
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar OS:', err);
            }

            try {
                await this.syncDespesas();
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar despesas:', err);
            }

            console.log('✅ Sincronização Completa Finalizada!');
        } catch (error) {
            console.error('❌ Erro na sincronização:', error);
        }
    },

    async syncMetadata(): Promise<void> {
        console.log('📥 Baixando Metadados (Usuários e Tipos de Peça)...');
        try {
            await this.syncUsers();
            await this.syncTiposPeca();
        } catch (error) {
            console.error('❌ Erro ao baixar metadados:', error);
        }
    },

    /**
     * Sincroniza Clientes (Incremental)
     */
    async syncClientes(): Promise<void> {
        // 🛡️ REPAIR MAGIC: Forçar re-sync se o usuário estiver com problemas de endereço null
        // Isso roda uma vez e depois o SecureStore garante que não roda mais (a menos que apaguem o dado)
        const hasForcedRepair = await SecureStore.getItemAsync('has_forced_address_repair_v1');
        if (!hasForcedRepair) {
            console.log('🧹 REPAIR: Forçando re-sync de clientes para corrigir endereços nulos...');
            await SecureStore.deleteItemAsync('last_sync_clientes');
            await SecureStore.setItemAsync('has_forced_address_repair_v1', 'true');
        }

        const lastSync = await SecureStore.getItemAsync('last_sync_clientes');
        console.log(`📥 Baixando Clientes (Incremental)... Last: ${lastSync || 'NEVER'}`);

        try {
            const response = await api.get('/clientes', {
                params: { since: lastSync }
            });

            const { data, deletedIds } = response.data;

            if (data.length > 0 || deletedIds?.length > 0) {
                await ClienteModel.upsertBatch(data);

                // Process deletes if any
                if (deletedIds?.length > 0) {
                    // Implementar deleção lógica ou física se necessário
                    // await ClienteModel.deleteBatch(deletedIds);
                }

                // Salvar novo timestamp
                await SecureStore.setItemAsync('last_sync_clientes', new Date().toISOString());
                console.log(`✅ Clientes sincronizados: ${data.length} novos/atualizados`);
            } else {
                console.log('✅ Clientes já atualizados.');
            }
        } catch (error) {
            console.error('❌ Erro ao baixar clientes:', error);
            throw error;
        }
    },


    /**
     * Processa a fila de sincronização (PUSH)
     */
    async processQueue(): Promise<void> {
        console.log('📤 Processando fila de sincronização...');

        let pendingItem = await SyncQueueModel.getNextPending();

        while (pendingItem) {
            console.log(`🔄 Processando item: ${pendingItem.entity_type} - ${pendingItem.operation} (ID: ${pendingItem.id}, tentativa ${pendingItem.attempts + 1})`);

            try {
                const payload = pendingItem.payload ? JSON.parse(pendingItem.payload) : null;
                let serverId: number | null = null;

                // Executar chamada de API baseada no recurso e ação
                if (pendingItem.entity_type === 'cliente') {
                    serverId = await this.syncClienteItem(pendingItem.operation, pendingItem.entity_local_id, payload);

                    // CRÍTICO: Se criou sucesso, atualizar ID local imediatamente
                    if (pendingItem.operation === 'CREATE' && serverId) {
                        console.log(`✅ Cliente sincronizado: UUID ${pendingItem.entity_local_id} → ID ${serverId}`);
                        await ClienteModel.markAsSynced(pendingItem.entity_local_id, serverId);
                    }
                }
                else if (pendingItem.entity_type === 'os') {
                    serverId = await this.syncOSItem(pendingItem.operation, pendingItem.entity_local_id, payload);

                    if (pendingItem.operation === 'CREATE' && serverId) {
                        console.log(`✅ OS sincronizada: UUID ${pendingItem.entity_local_id} → ID ${serverId}`);
                        await OSModel.markAsSynced(pendingItem.entity_local_id, serverId);
                    }
                }
                else if (pendingItem.entity_type === 'veiculo') {
                    serverId = await this.syncVeiculoItem(pendingItem.operation, pendingItem.entity_local_id, payload);

                    if (pendingItem.operation === 'CREATE' && serverId) {
                        console.log(`✅ Veículo sincronizado: UUID ${pendingItem.entity_local_id} → ID ${serverId}`);
                        await VeiculoModel.markAsSynced(pendingItem.entity_local_id, serverId);
                    }
                }
                else if (pendingItem.entity_type === 'peca') {
                    serverId = await this.syncPecaItem(pendingItem.operation, pendingItem.entity_local_id, payload);

                    if (pendingItem.operation === 'CREATE' && serverId) {
                        console.log(`✅ Peça sincronizada: UUID ${pendingItem.entity_local_id} → ID ${serverId}`);
                        await PecaModel.markAsSynced(pendingItem.entity_local_id, serverId);
                    }
                }
                else if (pendingItem.entity_type === 'despesa') {
                    serverId = await this.syncDespesaItem(pendingItem.operation, pendingItem.entity_local_id, payload);

                    if (pendingItem.operation === 'CREATE' && serverId) {
                        console.log(`✅ Despesa sincronizada: UUID ${pendingItem.entity_local_id} → ID ${serverId}`);
                        await DespesaModel.markAsSynced(pendingItem.entity_local_id, serverId);
                    }
                }

                // Se não foi CREATE (UPDATE/DELETE), apenas marca como processado/removido da fila
                // Para CREATE, o markAsSynced já remove da fila
                if (pendingItem.operation !== 'CREATE') {
                    // CRÍTICO: Para UPDATE, precisamos atualizar o status local para SYNCED
                    // caso contrário ele fica travado como PENDING_UPDATE e rejeita pulls futuros
                    if (pendingItem.operation === 'UPDATE' && serverId) {
                        if (pendingItem.entity_type === 'cliente') {
                            await ClienteModel.markAsSynced(pendingItem.entity_local_id, serverId);
                        } else if (pendingItem.entity_type === 'os') {
                            await OSModel.markAsSynced(pendingItem.entity_local_id, serverId);
                        } else if (pendingItem.entity_type === 'veiculo') {
                            await VeiculoModel.markAsSynced(pendingItem.entity_local_id, serverId);
                        } else if (pendingItem.entity_type === 'peca') {
                            await PecaModel.markAsSynced(pendingItem.entity_local_id, serverId);
                        } else if (pendingItem.entity_type === 'despesa') {
                            await DespesaModel.markAsSynced(pendingItem.entity_local_id, serverId);
                        }
                    } else {
                        // DELETE ou falha silenciosa em update (sem serverId?), apenas limpa fila
                        await SyncQueueModel.markAsProcessed(pendingItem.id);
                    }
                }

            } catch (error: any) {
                const api = (await import('./api')).default;
                const baseURL = api.defaults.baseURL;
                console.error(`❌ Erro ao processar item ${pendingItem.id} [Resource: ${pendingItem.entity_type}]:`, {
                    message: error.message,
                    code: error.code,
                    status: error.response?.status,
                    baseURL: baseURL
                });

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
                const response = await api.post('/clientes', {
                    ...payload,
                    localId: localId // 🆔 IMPORTANTE
                });
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
            if (payload.clienteLocalId && (!payload.clienteId || payload.clienteId === 0)) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);
                if (client && client.server_id) {
                    payload.clienteId = client.server_id;
                    console.log(`[SyncService] 🔗 Resolved Cliente FK for OS: ${client.server_id}`);
                } else {
                    console.warn(`[SyncService] ⚠️ Could not resolve Cliente FK for OS ${localId}. Client might not be synced yet.`);
                    throw new Error('Dependência de Cliente não satisfeita (sem server_id)');
                }
            }

            const api = (await import('./api')).default;
            const response = await api.post('/ordens-servico', {
                ...payload,
                localId: localId // 🆔 IMPORTANTE
            });
            console.log(`[SyncService] OS created on server`, { serverId: response.data.id });
            return response.data.id;
        } else if (action === 'UPDATE') {
            const localOS = await OSModel.getByLocalId(localId);

            if (!localOS) {
                console.warn(`[SyncService] ⚠️ Local OS not found for update: ${localId}`);
                return null;
            }

            if (!localOS.server_id) throw new Error('OS sem server_id para update');

            const api = (await import('./api')).default;

            if (payload.status && Object.keys(payload).length === 1) {
                await api.patch(`/ordens-servico/${localOS.server_id}/status`, payload);
            } else {
                const { id, sync_status, localId, ...cleanPayload } = payload;

                if (cleanPayload.usuario_id !== undefined) {
                    cleanPayload.usuarioId = cleanPayload.usuario_id;
                    delete cleanPayload.usuario_id;
                }
                if (cleanPayload.usuario_nome !== undefined) {
                    cleanPayload.usuarioNome = cleanPayload.usuario_nome;
                    delete cleanPayload.usuario_nome;
                }
                if (cleanPayload.usuario_email !== undefined) {
                    cleanPayload.usuarioEmail = cleanPayload.usuario_email;
                    delete cleanPayload.usuario_email;
                }

                await api.patch(`/ordens-servico/${localOS.server_id}`, cleanPayload);
                console.log(`[SyncService] ✅ OS atualizada no servidor (PATCH): ID ${localOS.server_id}`);
            }
            return localOS.server_id;
        } else if (action === 'DELETE') {
            const localOS = await OSModel.getByLocalId(localId);
            if (localOS?.server_id) {
                const api = (await import('./api')).default;
                // await api.delete(`/ordens-servico/${localOS.server_id}`);
            }
            return null;
        }
        return null;
    },

    async syncVeiculoItem(action: string, localId: string, payload: any): Promise<number | null> {
        console.log(`[SyncService] Syncing veículo: ${action}`, { localId });

        if (action === 'CREATE') {
            // 🆕 Resolve OS FK dynamically
            if (payload.osLocalId && (!payload.ordemServicoId || payload.ordemServicoId === 0)) {
                const os = await OSModel.getByLocalId(payload.osLocalId);
                if (os && os.server_id) {
                    payload.ordemServicoId = os.server_id;
                    console.log(`[SyncService] 🔗 Resolved OS FK for Veiculo: ${os.server_id}`);
                } else {
                    console.warn(`[SyncService] ⚠️ Could not resolve OS FK for Veiculo ${localId}. OS might not be synced yet.`);
                    throw new Error('Dependência de OS não satisfeita (sem server_id)');
                }
            }

            const api = (await import('./api')).default;
            const response = await api.post('/ordens-servico/veiculos', {
                ...payload,
                localId: localId // 🆔 IMPORTANTE
            });
            console.log(`[SyncService] Veículo created on server`, { serverId: response.data.id });
            return response.data.id;
        } else if (action === 'UPDATE') {
            const localVeiculo = await VeiculoModel.getByLocalId(localId);
            if (!localVeiculo?.server_id) throw new Error('Veículo sem server_id para update');

            const api = (await import('./api')).default;
            await api.patch(`/ordens-servico/veiculos/${localVeiculo.server_id}`, payload);
            return localVeiculo.server_id;
        } else if (action === 'DELETE') {
            const api = (await import('./api')).default;
            const VeiculoModel = (await import('./database/models/VeiculoModel')).VeiculoModel;
            const item = await VeiculoModel.getByLocalId(localId);
            if (item?.server_id) {
                await api.delete(`/ordens-servico/veiculos/${item.server_id}`);
            }
        }
        return null;
    },

    async syncPecaItem(action: string, localId: string, payload: any): Promise<number | null> {
        console.log(`[SyncService] Syncing peça: ${action}`, { localId });

        if (action === 'CREATE') {
            // 🆕 Resolve Veiculo FK dynamically
            if (payload.veiculoLocalId && (!payload.veiculoId || payload.veiculoId === 0)) {
                const veiculo = await VeiculoModel.getByLocalId(payload.veiculoLocalId);
                if (veiculo && veiculo.server_id) {
                    payload.veiculoId = veiculo.server_id;
                    console.log(`[SyncService] 🔗 Resolved Veiculo FK for Peca: ${veiculo.server_id}`);
                } else {
                    console.warn(`[SyncService] ⚠️ Could not resolve Veiculo FK for Peca ${localId}. Veiculo might not be synced yet.`);
                    throw new Error('Dependência de Veículo não satisfeita (sem server_id)');
                }
            }

            const api = (await import('./api')).default;
            const response = await api.post('/ordens-servico/pecas', {
                ...payload,
                localId: localId // 🆔 IMPORTANTE
            });
            console.log(`[SyncService] Peça created on server`, { serverId: response.data.id });
            return response.data.id;
        } else if (action === 'UPDATE') {
            const localPeca = await PecaModel.getByLocalId(localId);
            if (!localPeca?.server_id) throw new Error('Peça sem server_id para update');

            const api = (await import('./api')).default;
            await api.patch(`/ordens-servico/pecas/${localPeca.server_id}`, payload);
            return localPeca.server_id;
        } else if (action === 'DELETE') {
            const { PecaModel } = require('./database/models/PecaModel');
            const item = await PecaModel.getByLocalId(localId);
            if (item?.server_id) {
                const api = (await import('./api')).default;
                await api.delete(`/ordens-servico/pecas/${item.server_id}`);
            }
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

    // syncClientes movido para cima

    async syncOS(): Promise<void> {
        console.log('📥 Baixando Ordens de Serviço (Incremental)...');
        const lastSync = await SecureStore.getItemAsync('last_sync_os');
        const osService = (await import('./osService')).osService;
        const osList = await osService.listOS(lastSync || undefined);

        if (osList.length > 0) {
            await OSModel.upsertBatch(osList);
            console.log(`✅ ${osList.length} ordens de serviço sincronizadas.`);
        } else {
            console.log('ℹ️ Nenhuma OS nova/alterada.');
        }

        await SecureStore.setItemAsync('last_sync_os', new Date().toISOString());
    },

    async syncDespesas(): Promise<void> {
        console.log('📥 Baixando Despesas...');
        // const despesaService = (await import('./despesaService')).despesaService;
        // const despesas = await despesaService.getAll();
        // await DespesaModel.upsertBatch(despesas);
        console.warn('Despesa sync not implemented - missing getAll method in despesaService');
    },

    async syncUsers(): Promise<void> {
        console.log('📥 Baixando Usuários...');
        const { userService } = await import('./userService');
        await userService.getUsers(); // This already handles API fetch + DB upsert
    },

    async syncTiposPeca(): Promise<void> {
        console.log('📥 Baixando Tipos de Peça...');
        const { osService } = await import('./osService');
        await osService.listTiposPeca(); // This already handles API fetch + DB upsert
        console.log('✅ Tipos de Peça sincronizados.');
    }
};
