// src/services/sync/SyncEngine.ts
// Motor de sincronização offline-online

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { databaseService } from '../database/DatabaseService';
import { SyncQueueModel, ClienteModel, OSModel, VeiculoModel, DespesaModel, AuditLogModel } from '../database/models';
import type { SyncQueueItem } from '../database/models/types';
import api from '../api';

export interface SyncStatus {
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    errorCount: number;
    lastSyncTime: Date | null;
    currentOperation?: string;
}

export interface SyncResult {
    success: number;
    failed: number;
    errors: string[];
}

class SyncEngine {
    private isOnline: boolean = false;
    private isSyncing: boolean = false;
    private lastSyncTime: Date | null = null;
    private listeners: Set<(status: SyncStatus) => void> = new Set();
    private unsubscribeNetInfo: (() => void) | null = null;

    /**
     * Inicializar o motor de sync e começar a monitorar conexão
     */
    async initialize(): Promise<void> {
        console.log('[SyncEngine] Initializing...');

        // Inicializar banco de dados
        await databaseService.initialize();

        // Verificar estado inicial da conexão
        const state = await NetInfo.fetch();
        this.isOnline = state.isConnected === true && state.isInternetReachable === true;

        // Monitorar mudanças de conexão
        this.unsubscribeNetInfo = NetInfo.addEventListener(this.handleNetworkChange.bind(this));

        console.log(`[SyncEngine] Initialized. Online: ${this.isOnline}`);

        // Se online, tentar sincronizar
        if (this.isOnline) {
            this.trySyncInBackground();
        }
    }

    /**
     * Handler para mudanças de rede
     */
    private handleNetworkChange(state: NetInfoState): void {
        const wasOnline = this.isOnline;
        this.isOnline = state.isConnected === true && state.isInternetReachable === true;

        console.log(`[SyncEngine] Network changed: ${wasOnline} -> ${this.isOnline}`);

        // Se voltou online, tentar sincronizar
        if (!wasOnline && this.isOnline) {
            console.log('[SyncEngine] Back online! Starting sync...');
            this.trySyncInBackground();
        }

        this.notifyListeners();
    }

    /**
     * Registrar listener para mudanças de status
     */
    subscribe(listener: (status: SyncStatus) => void): () => void {
        this.listeners.add(listener);
        // Notificar estado inicial
        listener(this.getStatus());
        return () => this.listeners.delete(listener);
    }

    /**
     * Notificar todos os listeners
     */
    private async notifyListeners(): Promise<void> {
        const status = await this.getStatusAsync();
        this.listeners.forEach(listener => listener(status));
    }

    /**
     * Obter status atual (síncrono, usa cache)
     */
    getStatus(): SyncStatus {
        return {
            isOnline: this.isOnline,
            isSyncing: this.isSyncing,
            pendingCount: 0, // Será atualizado assincronamente
            errorCount: 0,
            lastSyncTime: this.lastSyncTime
        };
    }

    /**
     * Obter status atual (assíncrono, consulta DB)
     */
    async getStatusAsync(): Promise<SyncStatus> {
        const counts = await SyncQueueModel.getCounts();
        return {
            isOnline: this.isOnline,
            isSyncing: this.isSyncing,
            pendingCount: counts.total,
            errorCount: counts.errors,
            lastSyncTime: this.lastSyncTime
        };
    }

    /**
     * Verificar se está online
     */
    isConnected(): boolean {
        return this.isOnline;
    }

    /**
     * Tentar sync em background (não bloqueia)
     */
    trySyncInBackground(): void {
        if (this.isSyncing) return;

        // Executar em background
        this.syncAll().catch(err => {
            console.error('[SyncEngine] Background sync failed:', err);
        });
    }

    /**
     * Sincronizar tudo (método principal)
     */
    async syncAll(): Promise<SyncResult> {
        if (this.isSyncing) {
            console.log('[SyncEngine] Already syncing, skipping...');
            return { success: 0, failed: 0, errors: ['Already syncing'] };
        }

        if (!this.isOnline) {
            console.log('[SyncEngine] Offline, cannot sync');
            return { success: 0, failed: 0, errors: ['Offline'] };
        }

        this.isSyncing = true;
        this.notifyListeners();

        const result: SyncResult = { success: 0, failed: 0, errors: [] };

        try {
            console.log('[SyncEngine] Starting sync...');
            const items = await SyncQueueModel.getPending();
            console.log(`[SyncEngine] Found ${items.length} items to sync`);

            for (const item of items) {
                try {
                    await this.syncItem(item);
                    result.success++;
                } catch (err: any) {
                    result.failed++;
                    result.errors.push(`${item.entity_type}/${item.entity_local_id}: ${err.message}`);
                    await SyncQueueModel.markAttempt(item.id, false, err.message);
                }
            }

            this.lastSyncTime = new Date();
            await databaseService.setMetadata('last_sync', this.lastSyncTime.toISOString());

            console.log(`[SyncEngine] Sync complete. Success: ${result.success}, Failed: ${result.failed}`);
        } catch (err: any) {
            console.error('[SyncEngine] Sync error:', err);
            result.errors.push(err.message);
        } finally {
            this.isSyncing = false;
            this.notifyListeners();
        }

        return result;
    }

    /**
     * Sincronizar um item específico
     */
    private async syncItem(item: SyncQueueItem): Promise<void> {
        console.log(`[SyncEngine] Syncing ${item.entity_type}/${item.operation}...`);

        const payload = item.payload ? JSON.parse(item.payload) : null;

        switch (item.entity_type) {
            case 'cliente':
                await this.syncCliente(item, payload);
                break;
            case 'os':
                await this.syncOS(item, payload);
                break;
            case 'veiculo':
                await this.syncVeiculo(item, payload);
                break;
            case 'despesa':
                await this.syncDespesa(item, payload);
                break;
            default:
                throw new Error(`Unknown entity type: ${item.entity_type}`);
        }

        // Remover da fila após sucesso
        await SyncQueueModel.remove(item.id);
    }

    /**
     * Sincronizar cliente
     */
    private async syncCliente(item: SyncQueueItem, payload: any): Promise<void> {
        const local = await ClienteModel.getByLocalId(item.entity_local_id);
        if (!local) throw new Error('Local cliente not found');

        switch (item.operation) {
            case 'CREATE': {
                const response = await api.post('/clientes', {
                    razaoSocial: local.razao_social,
                    nomeFantasia: local.nome_fantasia,
                    cnpj: local.cnpj,
                    cpf: local.cpf,
                    tipoPessoa: local.tipo_pessoa,
                    contato: local.contato,
                    email: local.email,
                    status: local.status,
                    logradouro: local.logradouro,
                    numero: local.numero,
                    complemento: local.complemento,
                    bairro: local.bairro,
                    cidade: local.cidade,
                    estado: local.estado,
                    cep: local.cep
                });
                await ClienteModel.markAsSynced(item.entity_local_id, response.data.id);
                break;
            }
            case 'UPDATE': {
                if (!local.server_id) throw new Error('No server ID for update');
                await api.put(`/clientes/${local.server_id}`, payload);
                await ClienteModel.markAsSynced(item.entity_local_id, local.server_id);
                break;
            }
            case 'DELETE': {
                if (local.server_id) {
                    await api.delete(`/clientes/${local.server_id}`);
                }
                await databaseService.runDelete('DELETE FROM clientes WHERE local_id = ?', [item.entity_local_id]);
                break;
            }
        }
    }

    /**
     * Sincronizar OS
     */
    private async syncOS(item: SyncQueueItem, payload: any): Promise<void> {
        const local = await OSModel.getByLocalId(item.entity_local_id);
        if (!local) throw new Error('Local OS not found');

        switch (item.operation) {
            case 'CREATE': {
                // Resolver cliente server_id
                let clienteServerId: number | null = null;
                if (local.cliente_local_id) {
                    const cliente = await ClienteModel.getByLocalId(local.cliente_local_id);
                    clienteServerId = cliente?.server_id || null;
                }
                if (!clienteServerId) throw new Error('Cliente not synced yet');

                const response = await api.post('/ordens-servico', {
                    clienteId: clienteServerId,
                    data: local.data,
                    dataVencimento: local.data_vencimento
                });
                await OSModel.markAsSynced(item.entity_local_id, response.data.id);
                break;
            }
            case 'UPDATE': {
                if (!local.server_id) throw new Error('No server ID for update');
                // Update de status
                if (payload?.status) {
                    await api.patch(`/ordens-servico/${local.server_id}/status`, { status: payload.status });
                }
                await OSModel.markAsSynced(item.entity_local_id, local.server_id);
                break;
            }
            case 'DELETE': {
                if (local.server_id) {
                    await api.delete(`/ordens-servico/${local.server_id}`);
                }
                await databaseService.runDelete('DELETE FROM ordens_servico WHERE local_id = ?', [item.entity_local_id]);
                break;
            }
        }
    }

    /**
     * Sincronizar veículo
     */
    private async syncVeiculo(item: SyncQueueItem, payload: any): Promise<void> {
        const local = await VeiculoModel.getById(
            (await databaseService.getFirst<{ id: number }>('SELECT id FROM veiculos_os WHERE local_id = ?', [item.entity_local_id]))?.id || 0
        );
        if (!local) throw new Error('Local veiculo not found');

        switch (item.operation) {
            case 'CREATE': {
                // Resolver OS server_id
                let osServerId: number | null = null;
                if (local.os_local_id) {
                    const os = await OSModel.getByLocalId(local.os_local_id);
                    osServerId = os?.server_id || null;
                }
                if (!osServerId) throw new Error('OS not synced yet');

                const response = await api.post('/ordens-servico/veiculos', {
                    ordemServicoId: osServerId,
                    placa: local.placa,
                    modelo: local.modelo,
                    cor: local.cor
                });
                await VeiculoModel.markAsSynced(item.entity_local_id, response.data.id);
                break;
            }
            case 'DELETE': {
                if (local.server_id) {
                    await api.delete(`/ordens-servico/veiculos/${local.server_id}`);
                }
                await databaseService.runDelete('DELETE FROM veiculos_os WHERE local_id = ?', [item.entity_local_id]);
                break;
            }
        }
    }

    /**
     * Sincronizar despesa
     */
    private async syncDespesa(item: SyncQueueItem, payload: any): Promise<void> {
        const local = await DespesaModel.getById(
            (await databaseService.getFirst<{ id: number }>('SELECT id FROM despesas WHERE local_id = ?', [item.entity_local_id]))?.id || 0
        );
        if (!local) throw new Error('Local despesa not found');

        switch (item.operation) {
            case 'CREATE': {
                // Usando o mesmo endpoint do frontend web: /despesas
                const response = await api.post('/despesas', {
                    descricao: local.descricao,
                    valor: local.valor,
                    dataDespesa: local.data_despesa,
                    dataVencimento: local.data_despesa,
                    categoria: local.categoria || 'OUTROS',
                    meioPagamento: local.meio_pagamento || 'PIX',
                    pagoAgora: local.pago_agora === 1,
                    cartaoId: local.cartao_id
                });
                await DespesaModel.markAsSynced(item.entity_local_id, response.data.id);
                break;
            }
            case 'DELETE': {
                if (local.server_id) {
                    await api.delete(`/despesas/${local.server_id}`);
                }
                await databaseService.runDelete('DELETE FROM despesas WHERE local_id = ?', [item.entity_local_id]);
                break;
            }
        }
    }

    /**
     * Força sincronização manual
     */
    async forceSync(): Promise<SyncResult> {
        // Atualizar estado da rede
        const state = await NetInfo.fetch();
        this.isOnline = state.isConnected === true && state.isInternetReachable === true;

        if (!this.isOnline) {
            return { success: 0, failed: 0, errors: ['Sem conexão com internet'] };
        }

        return await this.syncAll();
    }

    /**
     * Destruir engine (limpar listeners)
     */
    destroy(): void {
        if (this.unsubscribeNetInfo) {
            this.unsubscribeNetInfo();
            this.unsubscribeNetInfo = null;
        }
        this.listeners.clear();
    }
}

export const syncEngine = new SyncEngine();
