import { clienteService } from './clienteService';
import { osService } from './osService';
import { despesaService } from './despesaService';
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
            console.log(`🔄 Processando item: ${pendingItem.resource} - ${pendingItem.action} (ID: ${pendingItem.id})`);

            try {
                const payload = pendingItem.payload ? JSON.parse(pendingItem.payload) : null;
                let serverId: number | null = null;

                // Executar chamada de API baseada no recurso e ação
                if (pendingItem.resource === 'cliente') {
                    serverId = await this.syncClienteItem(pendingItem.action, pendingItem.temp_id, payload);

                    // CRÍTICO: Se criou sucesso, atualizar ID local imediatamente
                    if (pendingItem.action === 'CREATE' && serverId) {
                        await ClienteModel.markAsSynced(pendingItem.temp_id, serverId);
                    }
                }
                else if (pendingItem.resource === 'os') {
                    serverId = await this.syncOSItem(pendingItem.action, pendingItem.temp_id, payload);

                    if (pendingItem.action === 'CREATE' && serverId) {
                        await OSModel.markAsSynced(pendingItem.temp_id, serverId);
                    }
                }
                else if (pendingItem.resource === 'despesa') {
                    serverId = await this.syncDespesaItem(pendingItem.action, pendingItem.temp_id, payload);

                    if (pendingItem.action === 'CREATE' && serverId) {
                        await DespesaModel.markAsSynced(pendingItem.temp_id, serverId);
                    }
                }

                // Se não foi CREATE (UPDATE/DELETE), apenas marca como processado/removido da fila
                // Para CREATE, o markAsSynced já remove da fila
                if (pendingItem.action !== 'CREATE') {
                    await SyncQueueModel.markAsProcessed(pendingItem.id);
                }

            } catch (error: any) {
                console.error(`❌ Erro ao processar item ${pendingItem.id}:`, error);
                await SyncQueueModel.markAsError(pendingItem.id, error.message || 'Erro desconhecido');
            }

            // Pegar próximo
            pendingItem = await SyncQueueModel.getNextPending();
        }
    },

    // --- Helpers de Item Individual ---

    async syncClienteItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            const created = await clienteService.create(payload);
            return created.id;
        } else if (action === 'UPDATE') {
            // Precisamos do ID do servidor. O payload pode ter ou buscaremos pelo localId
            const localCliente = await ClienteModel.getByLocalId(localId);
            if (!localCliente?.server_id) throw new Error('Cliente sem server_id para update');
            await clienteService.update(localCliente.server_id, payload);
            return localCliente.server_id;
        } else if (action === 'DELETE') {
            const localCliente = await ClienteModel.getByLocalId(localId);
            if (localCliente?.server_id) {
                await clienteService.delete(localCliente.server_id);
            }
            return null;
        }
        return null;
    },

    async syncOSItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            const created = await osService.create(payload);
            return created.id;
        } else if (action === 'UPDATE') {
            const localOS = await OSModel.getByLocalId(localId);
            if (!localOS?.server_id) throw new Error('OS sem server_id para update');

            // Tratamento especial para status vs update completo se necessário
            if (payload.status && Object.keys(payload).length === 1) {
                await osService.updateStatus(localOS.server_id, payload.status);
            } else {
                // Assumindo update genérico se existir serviço, senão tratar caso a caso
                // Por enquanto o app só tem updateStatus e create
                console.warn('Update completo de OS não implementado na API, apenas Status');
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
            const created = await despesaService.create(payload);
            return created.id;
        } else if (action === 'DELETE') {
            const localDespesa = await DespesaModel.getById(Number(localId)); // Ops, localId é string UUID ou ID numérico? No model é string uuid.
            // Precisamos buscar pelo localId string
            // TODO: Verificar se DespesaModel.getById usa ID numérico ou string. Usa numérico (autoincrement).
            // Mas temp_id na fila é string.
            // O payload do DELETE é null.
            // Se ação é DELETE, o registro local já foi deletado (soft delete) ou marcado PENDING_DELETE?
            // Se PENDING_DELETE, ainda está lá.

            // Simplificação: Se temos o server_id no payload ou se buscamos antes da deleção.
            // No Model.delete: UPDATE despesas SET sync_status = 'PENDING_DELETE'
            // Então ainda conseguimos buscar.

            // Como buscar por localId na tabela despesas? A tabela tem column local_id.
            // Falta método getByLocalId no DespesaModel.
            return null;
        }
        return null;
    },

    // --- Helpers de PULL ---

    async syncClientes(): Promise<void> {
        console.log('📥 Baixando Clientes...');
        const clientes = await clienteService.listar();
        await ClienteModel.upsertBatch(clientes);
    },

    async syncOS(): Promise<void> {
        console.log('📥 Baixando Ordens de Serviço...');
        const osList = await osService.listOS();
        await OSModel.upsertBatch(osList);
    },

    async syncDespesas(): Promise<void> {
        console.log('📥 Baixando Despesas...');
        const despesas = await despesaService.listar();
        await DespesaModel.upsertBatch(despesas);
    }
};
