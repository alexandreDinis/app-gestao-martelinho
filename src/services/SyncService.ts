// Services removed to avoid circular dependencies
import { ClienteModel } from './database/models/ClienteModel';
import { OSModel } from './database/models/OSModel';
import { VeiculoModel } from './database/models/VeiculoModel';
import { PecaModel } from './database/models/PecaModel';
import { DespesaModel } from './database/models/DespesaModel';
import { SyncQueueModel } from './database/models/SyncQueueModel';
import * as SecureStore from 'expo-secure-store';
import api from './api';

export const SyncService = {
    // --- MUTEX STATE ---
    _syncPromise: null as Promise<void> | null,
    _syncPending: false,

    /**
     * Executes a task exclusively (Mutex Coalesce Pattern).
     */
    async runExclusive(task: () => Promise<void>): Promise<void> {
        if (this._syncPromise) {
            console.log('⏳ Sync already in progress, marking partial as pending next run.');
            this._syncPending = true;
            return this._syncPromise;
        }

        this._syncPromise = (async () => {
            do {
                this._syncPending = false;
                try {
                    await task();
                } catch (e) {
                    console.error('❌ Error executing exclusive sync task:', e);
                }
            } while (this._syncPending);
        })().finally(() => {
            this._syncPromise = null;
        });

        return this._syncPromise;
    },

    /**
     * Sincroniza tudo (SERIALIZED)
     */
    async syncAll(isConnected: boolean, caller = 'unknown'): Promise<void> {
        if (!isConnected) return;
        return this.runExclusive(() => this._syncAllNoLock(isConnected, caller));
    },

    async _syncAllNoLock(isConnected: boolean, caller: string): Promise<void> {
        if (!isConnected) return;

        console.log(`🔄 Iniciando Sincronização Completa (Locked) [Caller: ${caller}]...`);

        try {
            // 0. Retry Strategy
            await SyncQueueModel.retryAllFailed();

            // 1. PUSH
            await this._processQueueNoLock();

            // 2. PULL Metadata
            try {
                await this.syncMetadata();
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar metadados:', err);
            }

            // 3. PULL Clientes
            try {
                await this._syncClientesNoLock();
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar clientes:', err);
            }

            // 4. PULL OS
            try {
                await this._syncOSNoLock();
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar OS:', err);
            }

            // 5. PULL Despesas
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

    // --- In-flight Promises & Throttling ---
    _checkForUpdatesPromise: null as Promise<{ hasServerUpdates: boolean; serverTime: string | null }> | null,
    _lastCheckForUpdates: 0,

    /**
     * Verifica se há atualizações no servidor (Lightweight Check)
     */
    async checkForUpdates(force = false, caller = 'unknown'): Promise<{ hasServerUpdates: boolean; serverTime: string | null }> {
        if (this._checkForUpdatesPromise) {
            console.log(`[SyncService] checkForUpdates [Caller: ${caller}] - returning in-flight promise`);
            return this._checkForUpdatesPromise;
        }

        const now = Date.now();
        const THROTTLE_MS = 10 * 60 * 1000;
        if (!force && this._lastCheckForUpdates > 0 && (now - this._lastCheckForUpdates < THROTTLE_MS)) {
            console.log(`[SyncService] Check throttled [Caller: ${caller}]. Last check: ${((now - this._lastCheckForUpdates) / 1000).toFixed(0)}s ago.`);
            return { hasServerUpdates: false, serverTime: null };
        }

        console.log(`[SyncService] Checking for updates [Caller: ${caller}]...`);

        this._checkForUpdatesPromise = (async () => {
            try {
                // 🛡️ SANITY CHECK: Se o banco estiver vazio, força update
                const localCount = await OSModel.getCount();
                if (localCount === 0) {
                    console.log(`[SyncService] ⚠️ Local DB is empty (OS=0). Forcing 'Updates Available'.`);
                    return { hasServerUpdates: true, serverTime: null };
                }

                const response = await api.get('/sync/status');
                const status = response.data;
                this._lastCheckForUpdates = Date.now();

                const lastSyncClientes = await SecureStore.getItemAsync('last_sync_clientes');
                const lastSyncOS = await SecureStore.getItemAsync('last_sync_os');

                let hasUpdates = false;

                if (status.clientesUpdatedAtMax) {
                    if (!lastSyncClientes) hasUpdates = true;
                    else if (new Date(status.clientesUpdatedAtMax).getTime() > new Date(lastSyncClientes).getTime()) hasUpdates = true;
                }

                if (status.osUpdatedAtMax) {
                    if (!lastSyncOS) hasUpdates = true;
                    else if (new Date(status.osUpdatedAtMax).getTime() > new Date(lastSyncOS).getTime()) hasUpdates = true;
                }

                console.log(`[SyncService] Updates Available: ${hasUpdates}`);
                return { hasServerUpdates: hasUpdates, serverTime: status.serverTime || null };
            } catch (error) {
                console.error('❌ Falha ao verificar atualizações:', error);
                return { hasServerUpdates: false, serverTime: null };
            } finally {
                this._checkForUpdatesPromise = null;
            }
        })();

        return this._checkForUpdatesPromise;
    },

    /**
     * Boot Logic
     */
    async tryBootSync(isConnected: boolean): Promise<void> {
        if (!isConnected) return;

        const lastFullSync = await SecureStore.getItemAsync('last_full_sync_at');
        const localCount = await OSModel.getCount();

        if (!lastFullSync || localCount === 0) {
            console.log(`🚀 BOOTSTRAP: Start full sync... (LastSync: ${!!lastFullSync}, Count: ${localCount})`);
            await this.syncAll(true, 'SyncEngine.bootstrap');
            await SecureStore.setItemAsync('last_full_sync_at', new Date().toISOString());
        } else {
            console.log('⚡ FAST BOOT: Checking updates only...');
            await this.checkForUpdates(false, 'SyncEngine.boot');
        }
    },

    async getLocalPendingCount(): Promise<number> {
        try {
            const counts = await SyncQueueModel.getCounts();
            return counts.total;
        } catch (error) {
            console.error('❌ Erro ao obter contagem pendente:', error);
            return 0;
        }
    },

    async syncClientes(): Promise<void> {
        return this.runExclusive(() => this._syncClientesNoLock());
    },

    async _syncClientesNoLock(): Promise<void> {
        const hasForcedRepair = await SecureStore.getItemAsync('has_forced_address_repair_v1');
        if (!hasForcedRepair) {
            console.log('🧹 REPAIR: Forçando re-sync de clientes para corrigir endereços nulos...');
            await SecureStore.deleteItemAsync('last_sync_clientes');
            await SecureStore.setItemAsync('has_forced_address_repair_v1', 'true');
        }

        const lastSync = await SecureStore.getItemAsync('last_sync_clientes');
        const syncStart = new Date().toISOString();

        try {
            const response = await api.get('/clientes', { params: { since: lastSync } });
            const rawData = response.data;
            const data = Array.isArray(rawData) ? rawData : (rawData?.content || rawData?.data || rawData?.items || []);

            if (data.length > 0) {
                await ClienteModel.upsertBatch(data);
                console.log(`✅ Clientes sincronizados: ${data.length} novos/atualizados`);
            }
            await SecureStore.setItemAsync('last_sync_clientes', syncStart);
        } catch (error) {
            console.error('❌ Erro ao baixar clientes:', error);
            throw error;
        }
    },

    async processQueue(): Promise<void> {
        return this.runExclusive(() => this._processQueueNoLock());
    },

    async _processQueueNoLock(): Promise<void> {
        console.log('📤 Processando fila de sincronização (Robust Sync V2)...');

        // 1. Fetch All Pending Items
        const pendingItems = await SyncQueueModel.getAllPending();
        if (pendingItems.length === 0) {
            console.log('✅ Fila vazia.');
            return;
        }

        console.log(`📋 Itens pendentes: ${pendingItems.length}`);

        // 2. Sort by Priority (Phase-Based)
        // Order: CLIENTE (0) > OS (1) > VEICULO (2) > PECA (3) > DESPESA (4)
        const PRIORITY_MAP: Record<string, number> = {
            'cliente': 0,
            'os': 1,
            'veiculo': 2,
            'peca': 3,
            'despesa': 4
        };

        const sortedItems = pendingItems.sort((a, b) => {
            const pA = PRIORITY_MAP[a.entity_type] ?? 99;
            const pB = PRIORITY_MAP[b.entity_type] ?? 99;
            if (pA !== pB) return pA - pB;
            return a.created_at - b.created_at; // FIFO within same type
        });

        // 3. Process Loop
        for (const item of sortedItems) {
            // 3.1 Check Backoff
            if (item.attempts > 0 && item.last_attempt) {
                const backoffMs = this.calculateBackoff(item.attempts);
                const nextRetry = item.last_attempt + backoffMs;
                if (Date.now() < nextRetry) {
                    console.log(`⏳ Skipping item ${item.id} (Backoff). Retry in ${((nextRetry - Date.now()) / 1000).toFixed(0)}s`);
                    continue;
                }
            }

            try {
                const payload = item.payload ? JSON.parse(item.payload) : null;

                // 3.2 Check Dependencies (Parent Existence)
                const isReady = await this.checkDependencies(item, payload);
                if (!isReady) {
                    // Dep not ready? Skip silently (wait for next sync cycle where parent might be synced)
                    console.log(`⏸️ Skipping item ${item.id} (Dependency not ready)`);
                    continue;
                }

                let serverId: number | null = null;
                console.log(`🔄 Processing ${item.entity_type} ${item.operation} (ID: ${item.id})...`);

                // 3.3 Execute
                if (item.entity_type === 'cliente') {
                    serverId = await this.syncClienteItem(item.operation, item.entity_local_id, payload);
                } else if (item.entity_type === 'os') {
                    serverId = await this.syncOSItem(item.operation, item.entity_local_id, payload);
                } else if (item.entity_type === 'veiculo') {
                    serverId = await this.syncVeiculoItem(item.operation, item.entity_local_id, payload);
                } else if (item.entity_type === 'peca') {
                    serverId = await this.syncPecaItem(item.operation, item.entity_local_id, payload);
                } else if (item.entity_type === 'despesa') {
                    serverId = await this.syncDespesaItem(item.operation, item.entity_local_id, payload);
                }

                // 3.4 Success Mapping
                if (serverId) {
                    console.log(`✅ Success ${item.entity_type} -> ServerID: ${serverId}`);
                    await this.updateLocalEntityId(item.entity_type, item.entity_local_id, serverId);
                    await SyncQueueModel.markAsProcessed(item.id);
                } else {
                    // Start DELETE operations or others that don't return ID
                    await SyncQueueModel.markAsProcessed(item.id);
                }

            } catch (error: any) {
                console.error(`❌ Erro item ${item.id}:`, error.message);
                const errorType = this.detectErrorType(error);
                await SyncQueueModel.markAttempt(item.id, false, `${errorType}: ${error.message}`);
            }
        }
    },

    calculateBackoff(attempts: number): number {
        // 1: 2s, 2: 10s, 3: 60s, 4+: 10min
        if (attempts <= 1) return 2000;
        if (attempts === 2) return 10000;
        if (attempts === 3) return 60000;
        return 10 * 60 * 1000;
    },

    async checkDependencies(item: any, payload: any): Promise<boolean> {
        // Rule: Child cannot be sent if Parent has no server_id
        if (item.entity_type === 'veiculo' && item.operation === 'CREATE') {
            // Check OS
            // Payload might have osLocalId.
            // If payload.ordemServicoId is set, it's fine.
            // If not, we need to check if we can resolve it.
            if (!payload.ordemServicoId && payload.osLocalId) {
                const os = await OSModel.getByLocalId(payload.osLocalId);
                if (!os || !os.server_id) {
                    console.log(`   -> Missing Parent OS ServerID for Veiculo ${item.entity_local_id}`);
                    return false;
                }
            }
        }

        if (item.entity_type === 'peca' && item.operation === 'CREATE') {
            if (!payload.veiculoId && payload.veiculoLocalId) {
                const v = await VeiculoModel.getByLocalId(payload.veiculoLocalId);
                if (!v || !v.server_id) {
                    console.log(`   -> Missing Parent Veiculo ServerID for Peca ${item.entity_local_id}`);
                    return false;
                }
            }
        }
        return true;
    },

    async updateLocalEntityId(type: string, localId: string, serverId: number): Promise<void> {
        if (type === 'cliente') await ClienteModel.markAsSynced(localId, serverId);
        else if (type === 'os') await OSModel.markAsSynced(localId, serverId);
        else if (type === 'veiculo') await VeiculoModel.markAsSynced(localId, serverId);
        else if (type === 'peca') await PecaModel.markAsSynced(localId, serverId);
        else if (type === 'despesa') await DespesaModel.markAsSynced(localId, serverId);
    },

    detectErrorType(error: any): 'network' | 'validation' {
        const networkErrors = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'Network request failed', 'Network Error', 'timeout', 'ERR_NETWORK', 'ERR_CONNECTION_REFUSED'];
        if (error.response && [400, 422, 409].includes(error.response.status)) return 'validation';
        const msg = (error.message || '').toString();
        return networkErrors.some(ne => msg.includes(ne)) ? 'network' : 'network';
    },

    async syncClienteItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            const res = await api.post('/clientes', { ...payload, localId });
            return res.data.id;
        } else if (action === 'UPDATE') {
            const local = await ClienteModel.getByLocalId(localId);
            if (!local?.server_id) throw new Error('Cliente sem server_id');
            await api.put(`/clientes/${local.server_id}`, payload);
            return local.server_id;
        }
        return null;
    },

    async syncOSItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            if (payload.clienteLocalId && (!payload.clienteId || payload.clienteId === 0)) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);
                if (client?.server_id) payload.clienteId = client.server_id;
                else throw new Error('Dependência de Cliente não satisfeita');
            }
            const res = await api.post('/ordens-servico', { ...payload, localId });
            return res.data.id;
        } else if (action === 'UPDATE') {
            const local = await OSModel.getByLocalId(localId);
            if (!local?.server_id) throw new Error('OS sem server_id');
            if (payload.status && Object.keys(payload).length === 1) {
                await api.patch(`/ordens-servico/${local.server_id}/status`, payload);
            } else {
                const { id, sync_status, localId: lid, ...clean } = payload;
                if (clean.usuario_id !== undefined) { clean.usuarioId = clean.usuario_id; delete clean.usuario_id; }
                await api.patch(`/ordens-servico/${local.server_id}`, clean);
            }
            return local.server_id;
        }
        return null;
    },

    async syncVeiculoItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            if (payload.osLocalId && (!payload.ordemServicoId || payload.ordemServicoId === 0)) {
                const os = await OSModel.getByLocalId(payload.osLocalId);
                if (os?.server_id) payload.ordemServicoId = os.server_id;
                else throw new Error('Dependência de OS não satisfeita');
            }
            const res = await api.post('/ordens-servico/veiculos', { ...payload, localId });
            return res.data.id;
        } else if (action === 'UPDATE') {
            const local = await VeiculoModel.getByLocalId(localId);
            if (local?.server_id) {
                await api.patch(`/ordens-servico/veiculos/${local.server_id}`, payload);
                return local.server_id;
            }
        } else if (action === 'DELETE') {
            const item = await VeiculoModel.getByLocalId(localId);
            if (item?.server_id) await api.delete(`/ordens-servico/veiculos/${item.server_id}`);
        }
        return null;
    },

    async syncPecaItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            if (payload.veiculoLocalId && (!payload.veiculoId || payload.veiculoId === 0)) {
                const v = await VeiculoModel.getByLocalId(payload.veiculoLocalId);
                if (v?.server_id) payload.veiculoId = v.server_id;
                else throw new Error('Dependência de Veículo não satisfeita');
            }
            const res = await api.post('/ordens-servico/pecas', { ...payload, localId });
            return res.data.id;
        } else if (action === 'UPDATE') {
            const local = await PecaModel.getByLocalId(localId);
            if (local?.server_id) {
                await api.patch(`/ordens-servico/pecas/${local.server_id}`, payload);
                return local.server_id;
            }
        } else if (action === 'DELETE') {
            const item = await PecaModel.getByLocalId(localId);
            if (item?.server_id) await api.delete(`/ordens-servico/pecas/${item.server_id}`);
        }
        return null;
    },

    async syncDespesaItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            const { despesaService } = await import('./despesaService');
            const created = await despesaService.create(payload);
            return created.id;
        }
        return null;
    },

    async syncOS(): Promise<void> {
        return this.runExclusive(() => this._syncOSNoLock());
    },

    async _syncOSNoLock(): Promise<void> {
        console.log('📥 Baixando Ordens de Serviço (Incremental)...');
        const lastSync = await SecureStore.getItemAsync('last_sync_os');
        const syncStart = new Date().toISOString();
        try {
            const { osService } = await import('./osService');
            const osList = await osService.fetchFromApi(lastSync || undefined);
            if (osList.length > 0) {
                await OSModel.upsertBatch(osList);
                console.log(`✅ ${osList.length} ordens de serviço sincronizadas.`);
            }
            await SecureStore.setItemAsync('last_sync_os', syncStart);
        } catch (error) {
            console.error('❌ Erro ao sincronizar OS (Pull):', error);
        }
    },

    async syncDespesas(): Promise<void> {
        console.warn('Despesa sync not implemented');
    },

    async syncUsers(): Promise<void> {
        const { userService } = await import('./userService');
        await userService.getUsers();
    },

    async syncTiposPeca(): Promise<void> {
        const { osService } = await import('./osService');
        await osService.listTiposPeca();
    }
};
