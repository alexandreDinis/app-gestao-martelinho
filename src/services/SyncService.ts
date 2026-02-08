// Services removed to avoid circular dependencies
import { ClienteModel } from './database/models/ClienteModel';
import { OSModel } from './database/models/OSModel';
import { VeiculoModel } from './database/models/VeiculoModel';
import { PecaModel } from './database/models/PecaModel';
import { DespesaModel } from './database/models/DespesaModel';
import { SyncQueueModel } from './database/models/SyncQueueModel';
import * as SecureStore from 'expo-secure-store';
import api from './api';
import { authService } from './authService';

export const SyncService = {
    // --- MUTEX STATE ---
    _syncLock: false,
    _syncAllPromise: null as Promise<void> | null,
    _processQueuePromise: null as Promise<void> | null,

    /**
     * Executes a task exclusively (Mutex Pattern for Writes).
     * Only one write operation can run at a time.
     */
    async runExclusive<T>(task: () => Promise<T>): Promise<T> {
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        // Spin-wait mechanism (simple mutex)
        let attempts = 0;
        while (this._syncLock && attempts < 50) { // Max 10s wait
            await wait(200);
            attempts++;
        }

        if (this._syncLock) {
            console.warn('⚠️ Sync Mutex Timeout - operation aborted to preserve integrity.');
            throw new Error('SYNC_MUTEX_TIMEOUT');
        }

        this._syncLock = true;
        try {
            return await task();
        } finally {
            this._syncLock = false;
        }
    },

    /**
     * Helper: Generate unique marker key for Multi-tenancy & Multi-environment
     * Format: {key}_{baseHash}_{empresaId}
     */
    getMarkerKey(key: string, baseHash: string, empresaId: number): string {
        return `${key}_${baseHash}_${empresaId}`;
    },

    /**
     * Helper: Generate Base Hash from API URL
     */
    getBaseHash(): string {
        const url = api.defaults.baseURL || '';
        // Simple hash function (or just clean string)
        // Remove protocol and special chars
        return url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_');
    },

    /**
     * Sincroniza tudo (SERIALIZED & COALESCED)
     */
    async syncAll(isConnected: boolean, caller = 'unknown'): Promise<void> {
        if (!isConnected) return;

        // In-flight coalescing: Return existing promise if already running
        if (this._syncAllPromise) {
            console.log(`⏳ SyncAll already in progress [Caller: ${caller}], returning in-flight promise.`);
            return this._syncAllPromise;
        }

        this._syncAllPromise = (async () => {
            try {
                // Use Mutex for the write-heavy part
                await this.runExclusive(() => this._syncAllNoLock(isConnected, caller));
            } catch (e) {
                console.error(`❌ SyncAll failed [Caller: ${caller}]:`, e);
            } finally {
                this._syncAllPromise = null;
            }
        })();

        return this._syncAllPromise;
    },

    async _syncAllNoLock(isConnected: boolean, caller: string): Promise<void> {
        if (!isConnected) return;

        console.log(`🔄 Iniciando Sincronização Completa (Locked) [Caller: ${caller}]...`);

        // 🔐 Security: Get Session Claims
        const session = await authService.getSessionClaims();
        if (!session) {
            console.warn('⚠️ Sync skipped: No active session found.');
            return;
        }

        const baseHash = this.getBaseHash();
        const { empresaId } = session;

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
                await this._syncClientesNoLock(session);
            } catch (err) {
                console.error('⚠️ Falha ao sincronizar clientes:', err);
            }

            // 4. PULL OS
            try {
                await this._syncOSNoLock(session);
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

            // Set Global Marker (Multi-tenant)
            const globalMarkerKey = this.getMarkerKey('last_full_sync_at', baseHash, empresaId);
            await SecureStore.setItemAsync(globalMarkerKey, new Date().toISOString());

        } catch (error) {
            console.error('❌ Erro na sincronização:', error);
            throw error; // Propagate to let caller know it failed
        }
    },

    async syncMetadata(): Promise<void> {
        console.log('📥 Baixando Metadados (Usuários e Tipos de Peça)...');
        try {
            await this.syncUsers();
            await this.syncTiposPeca();
        } catch (error) {
            console.error('❌ Erro ao baixar metadados:', error);
            throw error;
        }
    },

    // --- In-flight Promises & Throttling ---
    _checkForUpdatesPromise: null as Promise<{ status: 'BOOTSTRAP_REQUIRED' | 'UPDATES_AVAILABLE' | 'UP_TO_DATE'; serverTime: string | null }> | null,
    _lastCheckForUpdates: 0,

    /**
     * Verifica se há atualizações no servidor (Lightweight Check)
     */
    async checkForUpdates(force = false, caller = 'unknown'): Promise<{ status: 'BOOTSTRAP_REQUIRED' | 'UPDATES_AVAILABLE' | 'UP_TO_DATE'; serverTime: string | null }> {
        if (this._checkForUpdatesPromise) {
            console.log(`[SyncService] checkForUpdates [Caller: ${caller}] - returning in-flight promise`);
            return this._checkForUpdatesPromise;
        }

        const now = Date.now();
        const THROTTLE_MS = 30 * 1000; // 30 seconds throttle
        if (!force && this._lastCheckForUpdates > 0 && (now - this._lastCheckForUpdates < THROTTLE_MS)) {
            console.log(`[SyncService] Check throttled [Caller: ${caller}]. Last check: ${((now - this._lastCheckForUpdates) / 1000).toFixed(0)}s ago.`);
            return { status: 'UP_TO_DATE', serverTime: null };
        }

        console.log(`[SyncService] Checking for updates [Caller: ${caller}]...`);

        this._checkForUpdatesPromise = (async () => {
            try {
                // 🔐 Security: Session Check
                const session = await authService.getSessionClaims();
                if (!session) {
                    console.log(`[SyncService] No session. Updates unavailable.`);
                    return { status: 'UP_TO_DATE', serverTime: null };
                }

                const baseHash = this.getBaseHash();
                const { empresaId } = session;

                // 🛡️ SANITY CHECK: Se banco local desta empresa estiver vazio, força bootstrap
                const localCount = await OSModel.getCountByEmpresa(empresaId);

                if (localCount === 0) {
                    console.log(`[SyncService] ⚠️ Local OS count for Empresa ${empresaId} is 0. Forcing BOOTSTRAP_REQUIRED.`);
                    return { status: 'BOOTSTRAP_REQUIRED', serverTime: null };
                }

                const markerKey = this.getMarkerKey('last_full_sync_at', baseHash, empresaId);
                const lastFullSync = await SecureStore.getItemAsync(markerKey);

                if (!lastFullSync) {
                    console.log(`[SyncService] ⚠️ Missing full sync marker (${markerKey}). BOOTSTRAP REQUIRED.`);
                    return { status: 'BOOTSTRAP_REQUIRED', serverTime: null };
                }

                const response = await api.get('/sync/status');
                const status = response.data;
                this._lastCheckForUpdates = Date.now();

                const clientesKey = this.getMarkerKey('last_sync_clientes', baseHash, empresaId);
                const osKey = this.getMarkerKey('last_sync_os', baseHash, empresaId);

                const lastSyncClientes = await SecureStore.getItemAsync(clientesKey);
                const lastSyncOS = await SecureStore.getItemAsync(osKey);

                let hasUpdates = false;

                // Handle null timestamps from server (e.g., empty backend DB)
                // Treat null server timestamp as epoch 0 (no data)
                const serverClientesMax = status.clientesUpdatedAtMax ? new Date(status.clientesUpdatedAtMax).getTime() : 0;
                const localClientesMax = lastSyncClientes ? new Date(lastSyncClientes).getTime() : 0;

                const serverOSMax = status.osUpdatedAtMax ? new Date(status.osUpdatedAtMax).getTime() : 0;
                const localOSMax = lastSyncOS ? new Date(lastSyncOS).getTime() : 0;

                if (serverClientesMax > localClientesMax) hasUpdates = true;
                if (serverOSMax > localOSMax) hasUpdates = true;

                console.log(`[SyncService] Updates: ${hasUpdates} (C: ${serverClientesMax > localClientesMax}, OS: ${serverOSMax > localOSMax})`);

                const resultStatus: 'BOOTSTRAP_REQUIRED' | 'UPDATES_AVAILABLE' | 'UP_TO_DATE' = hasUpdates ? 'UPDATES_AVAILABLE' : 'UP_TO_DATE';

                return { status: resultStatus, serverTime: status.serverTime || null };
            } catch (error) {
                console.error('[SyncService] Check for updates failed:', error);
                return { status: 'UP_TO_DATE', serverTime: null };
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

        const session = await authService.getSessionClaims();
        if (!session) return;

        const baseHash = this.getBaseHash();
        const markerKey = this.getMarkerKey('last_full_sync_at', baseHash, session.empresaId);

        const lastFullSync = await SecureStore.getItemAsync(markerKey);

        if (!lastFullSync) {
            console.log(`🚀 BOOTSTRAP: Start full sync for Empresa ${session.empresaId}... (Missing Marker)`);
            await this.syncAll(true, 'SyncEngine.bootstrap');
            // Marker is set in syncAll upon success
        } else {
            console.log('⚡ FAST BOOT: Checking updates only...');
            const result = await this.checkForUpdates(false, 'SyncEngine.boot');
            if (result.status === 'BOOTSTRAP_REQUIRED') {
                console.log('🚀 BOOTSTRAP: Safety fallback triggered (Local DB empty or corrupted marker). Syncing all...');
                await this.syncAll(true, 'SyncEngine.boot_recover');
            }
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
        const session = await authService.getSessionClaims();
        if (!session) return;
        return this.runExclusive(() => this._syncClientesNoLock(session));
    },

    async _syncClientesNoLock(session: { userId: number; empresaId: number }): Promise<void> {
        const baseHash = this.getBaseHash();
        const { empresaId } = session;
        const markerKey = this.getMarkerKey('last_sync_clientes', baseHash, empresaId);

        // Address repair hack (per-tenant now?)
        // Let's keep it global or make it per tenant. Safer per tenant.
        const repairKey = this.getMarkerKey('has_forced_address_repair_v1', baseHash, empresaId);
        const hasForcedRepair = await SecureStore.getItemAsync(repairKey);

        if (!hasForcedRepair) {
            console.log('🧹 REPAIR: Forçando re-sync de clientes para corrigir endereços nulos...');
            await SecureStore.deleteItemAsync(markerKey);
            await SecureStore.setItemAsync(repairKey, 'true');
        }

        const lastSync = await SecureStore.getItemAsync(markerKey);
        const syncStart = new Date().toISOString();

        try {
            // 🛡️ Safety: If local DB is empty, IGNORE last_sync and force full pull
            const localCount = await ClienteModel.getCountByEmpresa(empresaId);
            const effectiveSince = localCount === 0 ? undefined : lastSync;

            if (localCount === 0 && lastSync) {
                console.log(`⚠️ Local Client DB is empty for Empresa ${empresaId}. Forcing full pull (ignoring last_sync).`);
            }

            const response = await api.get('/clientes', { params: { since: effectiveSince } });
            const rawData = response.data;
            const data = Array.isArray(rawData) ? rawData : (rawData?.content || rawData?.data || rawData?.items || []);

            if (data.length > 0) {
                await ClienteModel.upsertBatch(data);
                console.log(`✅ Clientes sincronizados: ${data.length} novos/atualizados`);
            }
            await SecureStore.setItemAsync(markerKey, syncStart);
        } catch (error) {
            console.error('❌ Erro ao baixar clientes:', error);
            throw error;
        }
    },

    async processQueue(): Promise<void> {
        if (this._processQueuePromise) {
            console.log('📤 ProcessQueue already in progress, returning in-flight promise.');
            return this._processQueuePromise;
        }

        this._processQueuePromise = (async () => {
            try {
                await this.runExclusive(() => this._processQueueNoLock());
            } finally {
                this._processQueuePromise = null;
            }
        })();

        return this._processQueuePromise;
    },

    async _processQueueNoLock(): Promise<void> {
        console.log('📤 Processando fila de sincronização (Robust Sync V3 - Phased)...');

        // 1. Fetch All Pending Items
        const pendingItems = await SyncQueueModel.getAllPending();
        if (pendingItems.length === 0) {
            console.log('✅ Fila vazia.');
            return;
        }

        console.log(`📋 Itens pendentes: ${pendingItems.length}`);

        // 2. Sort by Priority (Phase-Based) for execution order
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
                    console.log(`⏳ Skipping item ${item.entity_type} ${item.id} (Backoff). Retry in ${((nextRetry - Date.now()) / 1000).toFixed(0)}s`);
                    continue;
                }
            }

            try {
                const payload = item.payload ? JSON.parse(item.payload) : null;

                // 3.2 Check Dependencies (Parent Existence)
                // New Rule: Wait until parent syncs successfully in this or previous cycle
                const isReady = await this.checkDependencies(item, payload);
                if (!isReady) {
                    console.log(`⏸️ Skipping item ${item.entity_type} ${item.id} (Dependency not ready)`);
                    continue;
                }

                let serverId: number | null = null;
                console.log(`🔄 Processing ${item.entity_type} ${item.operation} (ID: ${item.id}, LocalID: ${item.entity_local_id})...`);

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
                    // For operations that don't return ID (DELETE) or already mapped
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
        // Exponential Backoff: 2s -> 10s -> 60s -> 10min
        if (attempts <= 1) return 2000;
        if (attempts === 2) return 10000;
        if (attempts === 3) return 60000;
        return 10 * 60 * 1000;
    },

    async checkDependencies(item: any, payload: any): Promise<boolean> {
        // PHASED QUEUE: Strict Dependency Check
        // If parent ID is missing AND parent localId is pending -> Not Ready.

        if (item.entity_type === 'veiculo' && item.operation === 'CREATE') {
            // Check OS
            if (!payload.ordemServicoId) {
                if (payload.osLocalId) {
                    // Check if OS is synced
                    const os = await OSModel.getByLocalId(payload.osLocalId);
                    if (!os || !os.server_id) {
                        // Must verify if OS is in queue ahead of this item? 
                        // With sorted execution (OS < VEICULO), if OS failed or hasn't run, we must wait.
                        console.log(`   -> Missing Parent OS ServerID for Veiculo ${item.entity_local_id} (OS Local: ${payload.osLocalId})`);
                        return false;
                    }
                    // Inject server_id if not present in payload (JIC)
                    payload.ordemServicoId = os.server_id;
                } else {
                    // No ID and no LocalID? Data error.
                    return false;
                }
            }
        }

        if (item.entity_type === 'peca' && item.operation === 'CREATE') {
            // Check Veiculo
            if (!payload.veiculoId) {
                if (payload.veiculoLocalId) {
                    const v = await VeiculoModel.getByLocalId(payload.veiculoLocalId);
                    if (!v || !v.server_id) {
                        console.log(`   -> Missing Parent Veiculo ServerID for Peca ${item.entity_local_id} (Veiculo Local: ${payload.veiculoLocalId})`);
                        return false;
                    }
                    payload.veiculoId = v.server_id;
                } else {
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
        const session = await authService.getSessionClaims();
        if (!session) return;
        return this.runExclusive(() => this._syncOSNoLock(session));
    },

    async _syncOSNoLock(session: { userId: number; empresaId: number }): Promise<void> {
        console.log('📥 Baixando Ordens de Serviço (Incremental)...');
        const baseHash = this.getBaseHash();
        const { empresaId } = session;
        const markerKey = this.getMarkerKey('last_sync_os', baseHash, empresaId);

        const lastSync = await SecureStore.getItemAsync(markerKey);
        const syncStart = new Date().toISOString();
        try {
            const { osService } = await import('./osService');

            // 🛡️ Safety: If local DB is empty for this enterprise, IGNORE last_sync and force full pull
            const localCount = await OSModel.getCountByEmpresa(empresaId);
            const effectiveSince = localCount === 0 ? undefined : (lastSync || undefined);

            if (localCount === 0 && lastSync) {
                console.log(`⚠️ Local OS DB is empty for Empresa ${empresaId}. Forcing full pull (ignoring last_sync).`);
            }

            const osList = await osService.fetchFromApi(effectiveSince);
            if (osList.length > 0) {
                await OSModel.upsertBatch(osList);
                console.log(`✅ ${osList.length} ordens de serviço sincronizadas.`);
            }
            await SecureStore.setItemAsync(markerKey, syncStart);
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
