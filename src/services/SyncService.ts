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
import { syncSecureStorage } from '../utils/syncSecureStorage';

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
        const url = (api.defaults.baseURL || '').replace(/\/+$/, ''); // remove trailing /
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

            // 0.1 Prepare & Get Server Time (Cursor)
            const localVersion = await syncSecureStorage.getLastTenantVersion(baseHash, empresaId);
            const globalMarkerKey = this.getMarkerKey('last_full_sync_at', baseHash, empresaId);
            const lastFullSync = await SecureStore.getItemAsync(globalMarkerKey);

            // 1. PUSH local changes first
            await this._processQueueNoLock();

            // 1.1 Fresh Server Status (Cursor) AFTER push
            // This ensures our local version marker catches our own updates
            console.log('⏳ Fetching server status/time...');
            const statusResponse = await api.get('/sync/status', {
                params: {
                    lastSync: lastFullSync || new Date(0).toISOString(),
                    lastTenantVersion: localVersion
                }
            });

            const serverTime = statusResponse.data?.serverTime;
            const serverTenantVersion = statusResponse.data?.lastTenantVersion;

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

            // 6. Update Markers ATOMICALLY (using Server Time)
            if (typeof serverTime === 'string' && serverTime.length > 10) {
                await SecureStore.setItemAsync(globalMarkerKey, serverTime);
                console.log(`✅ [SyncService] Updated last_full_sync_at to Server Time: ${serverTime}`);
            } else {
                console.warn('⚠️ serverTime inválido/ausente, não atualizando last_full_sync_at');
            }

            if (serverTenantVersion !== undefined && serverTenantVersion !== null) {
                const sv = Number(serverTenantVersion);
                if (Number.isFinite(sv)) {
                    await syncSecureStorage.setLastTenantVersion(baseHash, empresaId, sv);
                    const savedVersion = await syncSecureStorage.getLastTenantVersion(baseHash, empresaId);
                    const savedSync = await SecureStore.getItemAsync(globalMarkerKey);
                    console.log(`✅ [SyncService] Updated local version to ${sv}`);
                    console.log(`🔍 [SyncService] Sanity Check End: Version=${savedVersion}, LastFullSync=${savedSync}`);
                }
            }

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
                const localOSCount = await OSModel.getCountByEmpresa(empresaId);
                const localClientCount = await ClienteModel.getCountByEmpresa(empresaId); // Additional check

                // Only force bootstrap if both major tables are empty AND marker is missing/broken
                // or if specifically designed to safeguard empty state.
                // Refined Rule: Bootstrap if missing marker OR (OS=0 AND Client=0)

                const markerKey = this.getMarkerKey('last_full_sync_at', baseHash, empresaId);
                const lastFullSync = await SecureStore.getItemAsync(markerKey);
                let localVersion = await syncSecureStorage.getLastTenantVersion(baseHash, empresaId);

                console.log(`🔍 [SyncService] CheckForUpdates Sanity: Hash=${baseHash}, Emp=${empresaId}, Ver=${localVersion}, LastSync=${lastFullSync || 'NULL'}, OS=${localOSCount}, CLI=${localClientCount}`);

                const isDbEmpty = localOSCount === 0 && localClientCount === 0;

                if (!lastFullSync && isDbEmpty) {
                    console.log(`[SyncService] ⚠️ Missing marker AND DB Empty (OS=0, Cli=0). Forcing BOOTSTRAP_REQUIRED.`);
                    return { status: 'BOOTSTRAP_REQUIRED', serverTime: null };
                }

                // Call API with version
                const response = await api.get('/sync/status', {
                    params: {
                        lastSync: lastFullSync || new Date(0).toISOString(),
                        lastTenantVersion: localVersion
                    }
                });
                const status = response.data;
                if (!status) {
                    console.warn('[SyncService] Check for updates: Response data empty/null.');
                    return { status: 'UP_TO_DATE', serverTime: null };
                }
                this._lastCheckForUpdates = Date.now();

                // 🚀 Seeding Logic: If local is 0 and server > 0, save immediately
                const rawVersion = status.lastTenantVersion;
                const serverV = Number(rawVersion);

                if (Number.isFinite(serverV) && serverV > 0 && localVersion === 0 && !isDbEmpty) {
                    await syncSecureStorage.setLastTenantVersion(baseHash, empresaId, serverV);
                    console.log(`[SyncService] 🌱 Seeded local tenantVersion to ${serverV}`);
                    // Update local variable for subsequent checks
                    localVersion = serverV;
                }

                let hasUpdates = false;

                // 1. Priority: Version Check (New Logic) 🚀
                if (status.lastTenantVersion && status.lastTenantVersion > localVersion) {
                    console.log(`[SyncService] 🔄 Version Check: Server (${status.lastTenantVersion}) > Local (${localVersion}). Sync needed.`);
                    hasUpdates = true;
                }
                // 2. Fallback: Flags (Compatibility)
                else if (status.clientesUpdated !== undefined) {
                    if (status.clientesUpdated) hasUpdates = true;
                    if (status.osUpdated) hasUpdates = true;
                    if (status.tiposPecaUpdated) hasUpdates = true;
                    if (status.usersUpdated) hasUpdates = true;
                    if (status.comissoesUpdated) hasUpdates = true;
                    console.log(`[SyncService] Updates (Flags Fallback): ${hasUpdates}`);
                }
                // 3. Fallback: Legacy Timestamp Comparison
                else {
                    const clientesKey = this.getMarkerKey('last_sync_clientes', baseHash, empresaId);
                    const osKey = this.getMarkerKey('last_sync_os', baseHash, empresaId);

                    const lastSyncClientes = await SecureStore.getItemAsync(clientesKey);
                    const lastSyncOS = await SecureStore.getItemAsync(osKey);

                    const serverClientesMax = status.clientesUpdatedAtMax ? new Date(status.clientesUpdatedAtMax).getTime() : 0;
                    const localClientesMax = lastSyncClientes ? new Date(lastSyncClientes).getTime() : 0;

                    const serverOSMax = status.osUpdatedAtMax ? new Date(status.osUpdatedAtMax).getTime() : 0;
                    const localOSMax = lastSyncOS ? new Date(lastSyncOS).getTime() : 0;

                    if (serverClientesMax > localClientesMax) hasUpdates = true;
                    if (serverOSMax > localOSMax) hasUpdates = true;

                    console.log(`[SyncService] Updates (Legacy TS): ${hasUpdates}`);
                }

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

        // 🛡️ SELF-HEALING: If DB is empty, force bootstrap regardless of markers
        const osCount = await OSModel.getCountByEmpresa(session.empresaId);
        const cliCount = await ClienteModel.getCountByEmpresa(session.empresaId);
        const isDbEmpty = (osCount === 0 && cliCount === 0);

        if (isDbEmpty) {
            console.log(`[SyncService] 🧹 DB vazio detectado (OS=${osCount}, Cli=${cliCount}). Invalidando markers e forçando bootstrap...`);

            // Clear phantom markers
            await SecureStore.deleteItemAsync(markerKey);
            await syncSecureStorage.clearLastTenantVersion(baseHash, session.empresaId);

            console.log(`🚀 BOOTSTRAP: Start full sync for Empresa ${session.empresaId}... (Forced by Empty DB)`);
            await this.syncAll(true, 'SyncEngine.bootstrap_db_empty');
            return;
        }

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

                // 🧹 Full Sync Cleanup
                if (!effectiveSince) {
                    const { cleanZombies } = await import('./database/models/BaseModel');
                    const serverIds = data.map((c: any) => c.id);
                    await cleanZombies('clientes', 'empresa_id', empresaId, serverIds);
                }
            }
            await SecureStore.setItemAsync(markerKey, syncStart);
        } catch (error) {
            console.error('❌ Erro ao baixar clientes:', error);
            throw error;
        }
    },

    async processQueue(caller = 'unknown'): Promise<void> {
        if (this._processQueuePromise) {
            console.log(`⏳ processQueue already in progress [Caller: ${caller}], returning in-flight promise.`);
            return this._processQueuePromise;
        }

        this._processQueuePromise = (async () => {
            try {
                await this.runExclusive(() => this._processQueueNoLock(caller));
            } finally {
                this._processQueuePromise = null;
            }
        })();

        return this._processQueuePromise;
    },

    async recoverZombies(): Promise<void> {
        // console.log('[SyncService] 🧟 Checking for Zombie OS items...');
        const unsynced = await OSModel.getUnsyncedLocal();
        for (const os of unsynced) {
            const hasPending = await SyncQueueModel.hasPending('os', os.local_id);
            if (!hasPending) {
                console.warn(`[SyncService] 🧟 Zombie OS found (ID: ${os.id}, LocalID: ${os.local_id}). Re-enqueuing...`);
                // Re-enqueue as UPDATE to trigger self-healing (promote to CREATE)
                await SyncQueueModel.addToQueue({
                    entity_type: 'os',
                    entity_local_id: os.local_id,
                    operation: 'UPDATE',
                    payload: JSON.stringify({})
                });
            }
        }
    },

    async _processQueueNoLock(caller = 'unknown'): Promise<void> {
        console.log(`📡 Processando Fila de Sync (Locked) [Caller: ${caller}]...`);
        console.log('📤 Processando fila de sincronização (Robust Sync V3 - Phased)...');

        // 0. Zombie Recovery
        await this.recoverZombies();

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

        // 3. Process Loop - PHASED EXECUTION
        // Ensures OS (Parents) are processed and synced BEFORE Vehicles/Parts (Children)

        // Phase 1: OS Items (Create/Update)
        const osItems = sortedItems.filter(i => i.entity_type === 'os');
        console.log(`[SyncService] 🔄 Phase 1: Processing ${osItems.length} OS items...`);
        for (const item of osItems) {
            await this.processItem(item);
        }

        // Phase 2: Children Items (Veiculo, Peca, Despesa)
        const childItems = sortedItems.filter(i => i.entity_type !== 'os' && i.entity_type !== 'cliente');
        console.log(`[SyncService] 🔄 Phase 2: Processing ${childItems.length} dependent items...`);
        for (const item of childItems) {
            await this.processItem(item);
        }

        // Phase 3: Clients (Independent, but usually processed first if sorted by priority)
        // If they were not processed in Phase 1/2 (e.g., if we treat them separate)
        // Actually, let's keep it simple: OS First, then Everything Else.
        // If Cliente is Priority 0, it should be processed first.
        // Let's stick to the user's request: "Fase 1: Só OS", "Fase 2: Só veículos/peças"

        // REFINED STRATEGY:
        // 1. Clientes (Independent)
        // 2. OS (Parent)
        // 3. Others (Children)

        const clientItems = sortedItems.filter(i => i.entity_type === 'cliente');
        for (const item of clientItems) await this.processItem(item);

        // Note: We already processed OS items above.
        // We already processed Child items above.

        // Wait, the user code snippet was cleaner. Let's use that but robustly.
    },

    async processItem(item: any): Promise<void> {
        // 3.1 Check Backoff & Max Attempts
        if (item.attempts >= 5) {
            console.error(`❌ [SyncQueue] MAX ATTEMPTS reached for item ${item.entity_type} ${item.id}. Marking as ERROR.`);
            await SyncQueueModel.markAttempt(item.id, false, 'Max attempts reached (5)');
            return;
        }

        if (item.attempts > 0 && item.last_attempt) {
            const backoffMs = this.calculateBackoff(item.attempts);
            const nextRetry = item.last_attempt + backoffMs;
            if (Date.now() < nextRetry) {
                console.log(`⏳ Skipping item ${item.entity_type} ${item.id} (Backoff). Retry in ${((nextRetry - Date.now()) / 1000).toFixed(0)}s`);
                return;
            }
        }

        try {
            const payload = item.payload ? JSON.parse(item.payload) : null;

            // 3.2 Check Dependencies (Parent Existence)
            const isReady = await this.checkDependencies(item, payload);
            if (!isReady) {
                console.log(`⏸️ Skipping item ${item.entity_type} ${item.id} (Dependency not ready)`);
                return;
            }

            let serverId: number | null = null;
            console.log(`▶️ [SyncQueue] START item id=${item.id}, resource=${item.entity_type}, op=${item.operation}, localId=${item.entity_local_id}, attempts=${item.attempts}`);

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
                console.log(`✅ [SyncQueue] DONE item id=${item.id} -> ServerID: ${serverId}`);
                await this.updateLocalEntityId(item.entity_type, item.entity_local_id, serverId);
                await SyncQueueModel.markAsProcessed(item.id);
            } else {
                // For operations that don't return ID (DELETE) or already mapped
                await SyncQueueModel.markAsProcessed(item.id);
            }

        } catch (error: any) {
            console.error(`❌ [SyncQueue] FAIL item id=${item.id} err=${error.message}`);
            const errorType = this.detectErrorType(error);
            await SyncQueueModel.markAttempt(item.id, false, `${errorType}: ${error.message}`);
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

        if (item.entity_type === 'veiculo' && (item.operation === 'CREATE' || item.operation === 'UPDATE')) {
            // Check OS - Strict
            if (payload.ordemServicoId) {
                return true; // Parent likely on server
            } else if (payload.osLocalId) {
                const os = await OSModel.getByLocalId(payload.osLocalId);

                if (!os) {
                    console.error(`❌ [SyncQueue] FAIL integrity: Veiculo ${item.entity_local_id} points to non-existent OS localId ${payload.osLocalId}`);
                    return false; // Should fail/abort? For now, skip.
                }

                if (!os.server_id) {
                    // CRITICAL: Parent OS is local but not yet synced.
                    // With phased execution, we expect the parent OS to have been picked up in Phase 1.
                    // If it still has no server_id here, it means Phase 1 failed or didn't run for it.
                    // We must WAIT and retry next cycle.
                    console.log(`⏸️ [SyncQueue] WAIT item id=${item.id} reason=parent_os_not_synced (OS ${payload.osLocalId})`);
                    return false;
                }

                // Inject found server_id
                payload.ordemServicoId = os.server_id;
            } else {
                console.error(`❌ [SyncQueue] FAIL integrity: Veiculo ${item.entity_local_id} has NO parent reference (osLocalId/ordemServicoId)`);
                // Potentially mark as error if we want to stop retrying broken items
                return false;
            }
        }

        if (item.entity_type === 'peca' && (item.operation === 'CREATE' || item.operation === 'UPDATE')) {
            // Check Veiculo - Strict
            if (payload.veiculoId) {
                return true;
            } else if (payload.veiculoLocalId) {
                const v = await VeiculoModel.getByLocalId(payload.veiculoLocalId);

                if (!v) {
                    console.error(`❌ [SyncQueue] FAIL integrity: Peca ${item.entity_local_id} points to non-existent Veiculo localId ${payload.veiculoLocalId}`);
                    return false;
                }

                if (!v.server_id) {
                    console.log(`⏸️ [SyncQueue] WAIT item id=${item.id} reason=parent_veiculo_not_synced (Veiculo ${payload.veiculoLocalId})`);
                    return false;
                }

                // Inject found server_id
                payload.veiculoId = v.server_id;
            } else {
                console.error(`❌ [SyncQueue] FAIL integrity: Peca ${item.entity_local_id} has NO parent reference (veiculoLocalId/veiculoId)`);
                return false;
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

            // 🛡️ SECURITY: Force current user ID for offline created OS to avoid "User not in company" error
            const session = await authService.getSessionClaims();
            if (session?.userId) {
                payload.usuarioId = session.userId;
            }

            const res = await api.post('/ordens-servico', { ...payload, localId });
            return res.data.id;
        } else if (action === 'UPDATE') {
            const local = await OSModel.getByLocalId(localId);

            // 🛠️ SELF-HEALING: Se tentar UPDATE em OS sem server_id
            if (!local?.server_id) {
                if (!local) throw new Error('OS local não encontrada para Update');

                // GUARD 1: Se estiver "SYNCED", é incosistência grave. Não auto-criar.
                if (local.sync_status === 'SYNCED') {
                    throw new Error(`Inconsistência: OS SYNCED sem server_id (localId=${localId}). Abortando auto-create.`);
                }

                console.log(`[SyncService] 🛠️ Self-Healing: Promoting UPDATE to CREATE for OS ${localId}...`);

                // 1. Obter dados completos para recriar payload
                // Precisamos do full para garantir que temos clienteId, datas, etc.
                // Mas, OSService.createOS usa um payload específico (CreateOSRequest).
                // Vamos reconstruir o payload mínimo necessário.

                const fullOS = await OSModel.getByIdFull(local.id, local.empresa_id || 0);
                if (!fullOS) throw new Error('Falha ao carregar OS completa para self-healing');

                // Resolver Cliente ID para o payload
                let clienteIdForPayload = fullOS.cliente?.id;
                if (!clienteIdForPayload && fullOS.cliente?.localId) {
                    const c = await ClienteModel.getByLocalId(fullOS.cliente.localId);
                    clienteIdForPayload = c?.server_id || 0;
                }

                if (!clienteIdForPayload) {
                    throw new Error('Self-Healing falhou: Cliente da OS não tem server_id');
                }

                const createPayload = {
                    clienteId: clienteIdForPayload,
                    data: fullOS.data,
                    dataVencimento: fullOS.dataVencimento,
                    usuarioId: fullOS.usuarioId, // We will override this below if session is available
                    empresaId: fullOS.empresaId,
                    localId: localId // IMPORTANTE: Idempotência no backend (se suportado) ou tracking
                };

                // 🛡️ SECURITY: Force current user ID for self-healing CREATE to avoid "User not in company" error
                // Just like we did for standard syncOSItem CREATE
                const session = await authService.getSessionClaims();
                if (session?.userId) {
                    createPayload.usuarioId = session.userId;
                    console.log(`[SyncService] 🛡️ Self-Healing: Overriding usuarioId ${fullOS.usuarioId} -> ${session.userId}`);
                }

                // 2. Executar POST
                const res = await api.post('/ordens-servico', createPayload);
                const createdServerId = res.data.id;

                // GUARD 2: Attach imediato e atômico
                if (createdServerId) {
                    await OSModel.attachServerId(localId, createdServerId, res.data.updatedAt);
                    console.log(`[SyncService] ✅ Self-Healing Success: OS ${localId} -> ServerID ${createdServerId}`);
                    return createdServerId;
                } else {
                    throw new Error('Self-Healing POST retornou sucesso mas sem ID');
                }
            }

            // Fluxo normal (tem server_id)
            if (payload.status && Object.keys(payload).length === 1) {
                const res = await api.patch(`/ordens-servico/${local.server_id}/status`, payload);
                // UPDATE REPLAY PROTECTION: Update local server_updated_at from response
                if (res.data && res.data.updatedAt) {
                    await OSModel.attachServerId(localId, local.server_id, res.data.updatedAt);
                }
            } else {
                const { id, sync_status, localId: lid, ...clean } = payload;
                if (clean.usuario_id !== undefined) { clean.usuarioId = clean.usuario_id; delete clean.usuario_id; }
                const res = await api.patch(`/ordens-servico/${local.server_id}`, clean);
                // UPDATE REPLAY PROTECTION: Update local server_updated_at from response
                if (res.data && res.data.updatedAt) {
                    await OSModel.attachServerId(localId, local.server_id, res.data.updatedAt);
                }
            }
            return local.server_id;
        }
        return null;
    },

    async syncVeiculoItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            // FORCE Dynamic Lookup of Parent OS ID
            if (payload.osLocalId) {
                const os = await OSModel.getByLocalId(payload.osLocalId);
                if (os?.server_id) {
                    payload.ordemServicoId = os.server_id;
                    console.log(`[SyncService] 🔄 Dynamic Fix: Veiculo uses OS ServerID ${os.server_id}`);
                } else {
                    throw new Error(`Dependência de OS não satisfeita (LocalID: ${payload.osLocalId})`);
                }
            } else if (!payload.ordemServicoId) {
                throw new Error('Veiculo sem referência de OS (nem localId nem serverId)');
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
            // FORCE Dynamic Lookup of Parent Veiculo ID
            if (payload.veiculoLocalId) {
                const v = await VeiculoModel.getByLocalId(payload.veiculoLocalId);
                if (v?.server_id) {
                    payload.veiculoId = v.server_id;
                    console.log(`[SyncService] 🔄 Dynamic Fix: Peca uses Veiculo ServerID ${v.server_id}`);
                } else {
                    throw new Error(`Dependência de Veículo não satisfeita (LocalID: ${payload.veiculoLocalId})`);
                }
            } else if (!payload.veiculoId) {
                throw new Error('Peca sem referência de Veículo');
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
                await OSModel.upsertBatch(osList, empresaId);
                console.log(`✅ ${osList.length} ordens de serviço sincronizadas.`);

                // 🧹 Full Sync Cleanup: If we fetched everything (effectiveSince is undefined/null),
                // remove any local SYNCED OS that is not in the server list.
                if (!effectiveSince) {
                    const { cleanZombies } = await import('./database/models/BaseModel');
                    const serverIds = osList.map(o => o.id);
                    await cleanZombies('ordens_servico', 'empresa_id', empresaId, serverIds);
                }
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
