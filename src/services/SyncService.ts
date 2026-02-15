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
            // 0. Auto-Reset Stuck Items & Retry Failed
            const resetCount = await SyncQueueModel.autoResetStuckItems();
            if (resetCount > 0) {
                console.log(`[SyncService] 🔄 Auto-Reset: ${resetCount} item(s) presos resetados`);
            }
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
        // 🛡️ Guard 1: App State (Background Check)
        const { AppState } = require('react-native');
        if (AppState.currentState !== 'active' && caller === 'Polling.Interval') {
            console.log(`[SyncService] 💤 Skipping poll: App is in background (${AppState.currentState})`);
            return { status: 'UP_TO_DATE', serverTime: null };
        }

        // 🛡️ Guard 2: Database Readiness
        try {
            await import('./database/DatabaseService').then(m => m.databaseService.getDatabase());
        } catch (e: any) {
            console.warn(`[SyncService] ⚠️ Skipping poll: Database not ready (${e.message})`);
            return { status: 'UP_TO_DATE', serverTime: null };
        }

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
                // Fix: Must provide minimal payload for dependency checks (clienteLocalId)
                const payload = {
                    clienteLocalId: os.cliente_local_id,
                    clienteId: os.cliente_id, // fallback
                    empresaId: os.empresa_id
                };

                // Re-enqueue as UPDATE to trigger self-healing (promote to CREATE)
                await SyncQueueModel.addToQueue({
                    entity_type: 'os',
                    entity_local_id: os.local_id,
                    operation: 'UPDATE',
                    payload: JSON.stringify(payload)
                });
            }
        }
    },

    async _processQueueNoLock(caller = 'unknown'): Promise<void> {
        console.log(`📡 Processando Fila de Sync (Locked) [Caller: ${caller}]...`);
        console.log('📤 Processando fila de sincronização (Robust Sync V3 - Phased)...');

        // 0. Zombie Recovery
        await this.recoverZombies();

        // PHASES CONFIGURATION
        const PHASES = ['cliente', 'os', 'veiculo', 'peca', 'despesa'];

        // Strict Phased Execution: We completely finish one phase before moving to the next.
        // This acts as a "Barrier", preventing Vehicles from trying to sync while OSs are still processing.

        for (const phase of PHASES) {
            console.log(`[SyncService] 🌊 Starting Phase: ${phase.toUpperCase()}`);

            let phaseHasProgress = true;
            let phaseLoop = 0;
            const MAX_PHASE_LOOPS = 5; // Prevent infinite loops per phase

            while (phaseHasProgress && phaseLoop < MAX_PHASE_LOOPS) {
                phaseLoop++;
                phaseHasProgress = false;

                // Fetch ONLY items for current phase
                const pendingItems = await SyncQueueModel.getAllPending();
                const phaseItems = pendingItems
                    .filter(i => i.entity_type === phase)
                    .sort((a, b) => a.created_at - b.created_at); // FIFO

                if (phaseItems.length === 0) break; // Phase done

                console.log(`[SyncService] 🔄 Phase ${phase.toUpperCase()} (Loop ${phaseLoop}): ${phaseItems.length} items`);

                for (const item of phaseItems) {
                    const success = await this.processItem(item);
                    if (success) {
                        phaseHasProgress = true;

                        // INLINE WAKE-UP:
                        // If we successfully processed an OS, immediately try to unblock its dependencies (Vehicles) 
                        // by refreshing the local ID map or simply allowing the next phase to run with fresh data.
                        // The "barrier" design already ensures next phase sees this update.
                        // But we log it to be sure.
                        console.log(`[SyncService] 🔓 Item ${item.entity_type} ${item.id} synced. Dependencies UNLOCKED.`);
                    }
                }
            }

            // PHASE BARRIER CHECK
            // If we exit the loop but items are still pending, it means we made no progress in a full loop.
            // This is a "Stuck Phase". We must not proceed to dependent phases if the parent phase is broken.
            const remainingInPhase = await SyncQueueModel.getPendingByType(phase);
            if (remainingInPhase.length > 0) {
                console.warn(`[SyncService] ⚠️ Phase ${phase.toUpperCase()} finished but ${remainingInPhase.length} items remain pending. Possible Sync Deadlock or Network Failure.`);
                // Decide: Continue or Abort?
                // If OSs are stuck, Vehicles WILL fail. It's better to abort and retry later than to spam failures.
                // BUT: Maybe some vehicles don't depend on the stuck OSs? 
                // Let's CONTINUE but warn. The robust dependencies check in processItem will handle specifics.
            }
        }

        console.log('[SyncService] 🏁 All phases completed.');
    },

    async processItem(item: any): Promise<boolean> {
        // 3.1 Check Backoff & Max Attempts
        if (item.attempts >= 5) {
            console.error(`❌ [SyncQueue] MAX ATTEMPTS reached for item ${item.entity_type} ${item.id}. Marking as ERROR.`);
            await SyncQueueModel.markAttempt(item.id, false, 'Max attempts reached (5)');
            return false;
        }

        if (item.attempts > 0 && item.last_attempt) {
            const backoffMs = this.calculateBackoff(item.attempts);
            const nextRetry = item.last_attempt + backoffMs;
            if (Date.now() < nextRetry) {
                console.log(`⏳ Skipping item ${item.entity_type} ${item.id} (Backoff). Retry in ${((nextRetry - Date.now()) / 1000).toFixed(0)}s`);
                return false;
            }
        }

        try {
            const payload = item.payload ? JSON.parse(item.payload) : null;

            // 3.2 Check Dependencies (Parent Existence)
            // SELF-HEALING: Verify OS Integrity before checking dependencies
            if (item.entity_type === 'os' && item.operation === 'CREATE') {
                // Check if payload is missing client reference
                if (!payload.clienteLocalId && !payload.clienteId) {
                    console.warn(`[SyncService] 🚑 Self-Healing(OS): item=${item.id} localId=${item.entity_local_id} missing client ref. Attempting repair...`);

                    const localOS = await OSModel.getByLocalId(item.entity_local_id);

                    if (localOS && localOS.cliente_local_id) {
                        // Patch payload with local data
                        payload.clienteLocalId = localOS.cliente_local_id;
                        payload.clienteId = localOS.cliente_id; // Provide what we have (might be local PK)
                        payload.empresaId = localOS.empresa_id;

                        // Persist repair to Queue to avoid re-patching every loop
                        await SyncQueueModel.updatePayload(item.id, payload);

                        console.log(`[SyncService] 🛠️ Self-Healing(OS): Repaired payload. clienteLocalId=${localOS.cliente_local_id} clienteId=${localOS.cliente_id}`);
                    } else {
                        // Unrecoverable: Local record is also broken or missing
                        console.error(`[SyncService] ❌ Self-Healing failed (Unrecoverable). OS ${item.entity_local_id} has no local client link.`);
                        await SyncQueueModel.markAttempt(item.id, false, 'FAIL integrity: OS local record missing cliente_local_id');
                        return false;
                    }
                }
            }

            const isReady = await this.checkDependencies(item, payload);
            if (!isReady) {
                console.log(`⏸️ Skipping item ${item.entity_type} ${item.id} (Dependency not ready)`);
                return false;
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
                return true;
            } else {
                // For operations that don't return ID (DELETE) or already mapped
                await SyncQueueModel.markAsProcessed(item.id);
                return true;
            }

        } catch (error: any) {
            console.error(`❌ [SyncQueue] FAIL item id=${item.id} err=${error.message}`);
            const errorType = this.detectErrorType(error);
            await SyncQueueModel.markAttempt(item.id, false, `${errorType}: ${error.message}`);
            return false;
        }

        return false;
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

        if (item.entity_type === 'os' && (item.operation === 'CREATE' || item.operation === 'UPDATE')) {
            // 🛠️ PRE-VALIDATION: Resolve Client ID or Local ID if needed
            // If we are missing both ID and Local ID (corruption?), patch it from LOCAL OS
            if (!payload.clienteLocalId && !payload.clienteId) {
                const localOS = await OSModel.getByLocalId(item.entity_local_id); // Look up local OS record
                if (localOS?.cliente_local_id) {
                    payload.clienteLocalId = localOS.cliente_local_id;
                    console.log(`[SyncService] 🔧 Emergency Patch: Recovered clienteLocalId=${localOS.cliente_local_id} for OS ${item.entity_local_id}`);
                } else {
                    console.warn(`[SyncService] ⚠️ Emergency Patch FAILED: Could not restore clienteLocalId for OS ${item.entity_local_id}`);
                }
            }

            // If we have localId but no serverId, try to resolve it from Local DB (maybe it just synced in Phase 1)
            if (payload.clienteLocalId && !payload.clienteId) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);

                if (client) {
                    if (client.server_id) {
                        payload.clienteId = client.server_id;
                        await SyncQueueModel.updatePayload(item.id, payload);
                        console.log(`[SyncService] 🔧 Resolved clienteId=${client.server_id} for OS ${item.entity_local_id} (Pre-Validation)`);
                    } else {
                        console.warn(`[SyncService] ⚠️ Pre-Validation: Client ${payload.clienteLocalId} found but HAS NO SERVER ID yet.`);
                    }
                } else {
                    console.warn(`[SyncService] ⚠️ Pre-Validation: Client ${payload.clienteLocalId} NOT FOUND in local DB.`);
                }
            }

            // Check Cliente - Strict
            if (payload.clienteId && payload.clienteId !== 0) {
                return true; // Parent likely on server
            } else if (payload.clienteLocalId) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);

                if (!client) {
                    console.error(`❌ [SyncQueue] FAIL integrity: OS ${item.entity_local_id} points to non-existent Cliente localId ${payload.clienteLocalId}`);
                    // If client is gone, this OS is dead.
                    await SyncQueueModel.markAttempt(item.id, false, 'FAIL integrity: Client invalid');
                    return false;
                }

                if (!client.server_id) {
                    // Parent Cliente is local but not yet synced.
                    console.log(`⏸️ [SyncQueue] WAIT item id=${item.id} reason=parent_cliente_not_synced (Cliente ${payload.clienteLocalId})`);
                    return false;
                }

                // Inject found server_id (if we missed it above)
                payload.clienteId = client.server_id;
            } else {
                console.error(`❌ [SyncQueue] FAIL integrity: OS ${item.entity_local_id} has NO client reference (clienteLocalId/clienteId)`);
                // This is the case where we can try Self-Healing from local OS record (if not already tried)
                return false;
            }
        }

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

            // 🛠️ SELF-HEALING: Cliente sem server_id
            if (!local?.server_id) {
                console.log(`[SyncService] 🛠️ Self-Healing: Promoting UPDATE to CREATE for Cliente ${localId}...`);
                return this.selfHealCliente(local, localId);
            }

            try {
                await api.put(`/clientes/${local.server_id}`, payload);
            } catch (error: any) {
                // AUTO-CURA: Se erro for 404 (Server ID Invalid)
                if (error.response?.status === 404) {
                    console.log(`[SyncService] 🛠️ Auto-Cura: 404 detectado no UPDATE de Cliente, tentando CREATE para ${localId}...`);
                    return this.selfHealCliente(local, localId);
                }
                throw error;
            }
            return local.server_id;
        }
        return null;
    },

    async selfHealCliente(local: any, localId: string): Promise<number> {
        if (!local) throw new Error('Cliente local não encontrado para Self-Healing');

        // 1. Obter dados completos (embora local já deva ter tudo, garantimos pelo Model se necessário)
        // Como ClienteModel.getByLocalId já retorna o objeto completo, usamos 'local'.

        // 2. Preparar payload (igual ao create)
        // Precisamos converter de snake_case (local) para camelCase (API) se estivermos usando o objeto raw do banco
        // Mas o syncClienteItem recebe 'payload' que já deve estar no formato certo?
        // NÃO, o 'payload' do UPDATE pode ser parcial.
        // O self-healing precisa do payload COMPLETO de CREATE.

        const fullCliente = await ClienteModel.toApiFormat(local);
        const { id, ...clienteData } = fullCliente;
        const createPayload: any = {
            ...clienteData,
            localId,
            // Garantir endereço fallback
            endereco: fullCliente.endereco || fullCliente.logradouro || ''
        };

        // 3. Executar POST
        const res = await api.post('/clientes', createPayload);
        const createdServerId = res.data.id;

        // 4. AttachServerId
        if (createdServerId) {
            await ClienteModel.attachServerId(localId, createdServerId);
            console.log(`[SyncService] ✅ Self-Healing Success: Cliente ${localId} -> ServerID ${createdServerId}`);
            return createdServerId;
        }
        throw new Error('Self-Healing Cliente POST retornou sucesso mas sem ID');
    },

    async syncOSItem(action: string, localId: string, payload: any): Promise<number | null> {
        if (action === 'CREATE') {
            if (payload.clienteLocalId && (!payload.clienteId || payload.clienteId === 0)) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);
                if (client?.server_id) payload.clienteId = client.server_id;
                else throw new Error('Dependência de Cliente não satisfeita');
            }

            // 🛡️ SECURITY: Force current user ID for offline created OS to avoid "User not in company" error
            // FIX: Only send usuarioId if it is DIFFERENT from the logged-in user (relying on backend default for self)
            // Or if explicit assignment is needed.
            const session = await authService.getSessionClaims();
            if (session?.userId) {
                if (payload.usuarioId && payload.usuarioId !== session.userId) {
                    // It's a different user (e.g. Admin assigning to Technician), keep it.
                } else {
                    // It's the same user or missing. 
                    // Backend logic: "No POST da OS, não enviar usuarioId se for inválido... Só envia se não for o logado"
                    // If we remove it, backend uses token user.
                    delete payload.usuarioId;
                }
            }

            console.log(`[SyncService] 📤 Sending POST for OS ${localId}...`);

            // IDEMPOTENCY CHECK (Pre-POST)
            const preExistingId = await this.resolveOSServerId(localId);
            if (preExistingId) {
                console.log(`[SyncService] 🔄 Idempotency: OS ${localId} already exists on server (ID ${preExistingId}). Skipping POST.`);
                await OSModel.attachServerId(localId, preExistingId, new Date().toISOString());
                // Immediately return so dependent phases can proceed
                return preExistingId;
            }

            const executePost = async (p: any) => api.post('/ordens-servico', { ...p, localId });
            let res;

            try {
                res = await executePost(payload);
            } catch (error: any) {
                // RETRY STRATEGY: If 400 Bad Request and usuarioId is present, try without it.
                if (error.response?.status === 400 && payload.usuarioId) {
                    console.warn(`[SyncService] ⚠️ Sync POST failed with 400. Retrying without usuarioId...`);
                    const { usuarioId, ...fallbackPayload } = payload;
                    res = await executePost(fallbackPayload);
                } else {
                    throw error;
                }
            }

            let createdServerId = res.data?.id;

            // FALLBACK: If API returned 200/201 but no ID
            if (!createdServerId) {
                console.warn(`[SyncService] ⚠️ POST Success but NO ID returned for OS ${localId}. Attempting fallback resolution...`);
                createdServerId = await this.resolveOSServerId(localId);
                if (createdServerId) {
                    console.log(`[SyncService] 🔄 Fallback Resolution: Resolved ServerID ${createdServerId} via GET.`);
                }
            }

            // OPTIMIZATION: Immediate Mapping (Single-Click Sync)
            // Persist the server_id (mapping) IMMEDIATELY so that subsequent items (Veiculo/Peca) in the same run can see it.
            if (createdServerId) {
                console.log(`[SyncService] 📥 POST Synced. ID=${createdServerId}. Attaching local ID...`);
                await OSModel.attachServerId(localId, createdServerId, res.data?.updatedAt || new Date().toISOString());
                console.log(`[SyncService] ⚡ Immediate Mapping: OS ${localId} -> ServerID ${createdServerId}`);
            } else {
                console.warn(`[SyncService] ⚠️ POST Success but NO ID returned for OS ${localId} (and fallback failed).`, res.data);
            }

            return createdServerId || null;
        } else if (action === 'UPDATE') {
            const local = await OSModel.getByLocalId(localId);

            // 🛡️ PARENT GATE: Check dependency for UPDATE too
            if (payload.clienteLocalId && (!payload.clienteId || payload.clienteId === 0)) {
                const client = await ClienteModel.getByLocalId(payload.clienteLocalId);
                if (client?.server_id) payload.clienteId = client.server_id;
                else throw new Error('Dependência de Cliente não satisfeita (UPDATE)');
            }

            // 🛠️ SELF-HEALING: Se tentar UPDATE em OS sem server_id (Server ID Missing)
            if (!local?.server_id) {
                console.log(`[SyncService] 🛠️ Self-Healing: Promoting UPDATE to CREATE for OS ${localId}...`);
                return this.selfHealOS(local, localId);
            }

            // Fluxo normal (tem server_id)
            // Fluxo normal (tem server_id)
            try {
                if (payload.status && Object.keys(payload).length === 1) {
                    const res = await api.patch(`/ordens-servico/${local.server_id}/status`, payload);
                    if (res.data && res.data.updatedAt) {
                        await OSModel.attachServerId(localId, local.server_id, res.data.updatedAt);
                    }
                } else {
                    const { id, sync_status, localId: lid, ...clean } = payload;
                    if (clean.usuario_id !== undefined) { clean.usuarioId = clean.usuario_id; delete clean.usuario_id; }
                    // ... other cleanups

                    const res = await api.patch(`/ordens-servico/${local.server_id}`, clean);
                    if (res.data && res.data.updatedAt) {
                        await OSModel.attachServerId(localId, local.server_id, res.data.updatedAt);
                    }
                }
            } catch (error: any) {
                // AUTO-CURA: Se erro for 404 (Server ID Invalid), tentar self-healing
                if (error.response?.status === 404) {
                    console.log(`[SyncService] 🛠️ Auto-Cura: 404 detectado no UPDATE, tentando CREATE para OS ${localId}...`);
                    return this.selfHealOS(local, localId);
                }
                throw error;
            }
            return local.server_id;
        }
        return null;
    },

    async selfHealOS(local: any, localId: string): Promise<number> {
        if (!local) throw new Error('OS local não encontrada para Self-Healing');

        // GUARD 1: Se estiver "SYNCED", é incosistência grave. Não auto-criar.
        if (local.sync_status === 'SYNCED') {
            // Em caso de 404, pode ser SYNCED mas apagado no servidor.
            // Nesse caso, o self-healing é válido.
            console.warn(`[SyncService] ⚠️ Self-Healing em OS SYNCED (server_id=${local.server_id}). Assumindo que foi apagado no servidor.`);
        }

        // 1. Obter dados completos para recriar payload
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

        const createPayload: any = {
            clienteId: clienteIdForPayload,
            data: fullOS.data,
            dataVencimento: fullOS.dataVencimento,
            usuarioId: fullOS.usuarioId,
            empresaId: fullOS.empresaId,
            localId: localId
        };

        // 🛡️ SECURITY: Force current user ID if available (ONLY IF MISSING)
        const session = await authService.getSessionClaims();
        if (session?.userId && !createPayload.usuarioId) {
            createPayload.usuarioId = session.userId;
            console.log(`[SyncService] 🛡️ Self-Healing: Injecting current usuarioId ${session.userId} (was missing)`);
        } else if (createPayload.usuarioId && session?.userId && createPayload.usuarioId !== session.userId) {
            console.log(`[SyncService] 🛡️ Self-Healing: Preserving existing usuarioId ${createPayload.usuarioId} (different from session ${session.userId})`);
        }

        // IDEMPOTENCY CHECK (Pre-POST)
        // Before POSTing, check if this OS already exists on server by localId
        // This handles cases where previous sync POST succeeded but response was lost/no-ID.
        const preExistingId = await this.resolveOSServerId(localId);
        if (preExistingId) {
            console.log(`[SyncService] 🔄 Idempotency: OS ${localId} already exists on server (ID ${preExistingId}). Skipping POST.`);
            await OSModel.attachServerId(localId, preExistingId, new Date().toISOString());
            return preExistingId;
        }

        // 2. Executar POST
        const executePost = async (payload: any) => {
            console.log(`[SyncService] 📤 Self-Healing: Sending POST for OS ${localId}...`);
            const res = await api.post('/ordens-servico', payload);
            return res;
        };

        try {
            let res;
            try {
                res = await executePost(createPayload);
            } catch (error: any) {
                // RETRY STRATEGY: If 400 Bad Request and usuarioId is present, try without it.
                // This handles cases where the assigned user is not in the current company context.
                if (error.response?.status === 400 && createPayload.usuarioId) {
                    console.warn(`[SyncService] ⚠️ Self-Healing POST failed with 400. Retrying without usuarioId...`);
                    const { usuarioId, ...fallbackPayload } = createPayload;
                    res = await executePost(fallbackPayload);
                } else {
                    throw error;
                }
            }

            let createdServerId = res.data?.id;

            // FALLBACK: If API returned 200/201 but no ID (Backend bug handling)
            if (!createdServerId) {
                console.warn(`[SyncService] ⚠️ POST Success but NO ID returned for OS ${localId}. Attempting fallback resolution...`);
                createdServerId = await this.resolveOSServerId(localId);
                if (createdServerId) {
                    console.log(`[SyncService] 🔄 Fallback Resolution: Resolved ServerID ${createdServerId} via GET.`);
                }
            }

            // GUARD 2: Attach imediato e atômico
            if (createdServerId) {
                await OSModel.attachServerId(localId, createdServerId, res.data?.updatedAt || new Date().toISOString());
                console.log(`[SyncService] ✅ Self-Healing Success: OS ${localId} -> ServerID ${createdServerId}`);
                return createdServerId;
            }

            throw new Error(`Self-Healing POST retornou sucesso mas sem ID e Fallback falhou (Status: ${res?.status})`);
        } catch (error: any) {
            console.error(`[SyncService] ❌ Self-Healing POST failed for OS ${localId}:`, error.message);
            if (error.response) {
                console.error('[SyncService] Response Data:', JSON.stringify(error.response.data));
            }
            throw error;
        }
    },

    async resolveOSServerId(localId: string): Promise<number | null> {
        try {
            // Fetch recent OS (last 24h to be safe/efficient)
            // Assuming 'since' param is supported
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const res = await api.get<any[]>('/ordens-servico', { params: { since } });

            if (res.data && Array.isArray(res.data)) {
                const match = res.data.find(o => o.localId === localId);
                if (match?.id) return match.id;
            }
            return null;
        } catch (e) {
            console.warn(`[SyncService] Failed to resolve OS by localId: ${localId}`, e);
            return null;
        }
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

            // FIX: The backend returns the FULL OS object.
            // We must find the created vehicle inside the response.
            // 1. Try match by localId (Best)
            let createdVeiculo = res.data.veiculos?.find((v: any) => v.localId === localId);

            // 2. Fallback: Match by Placa (If localId wasn't persisted/returned)
            if (!createdVeiculo && payload.placa) {
                createdVeiculo = res.data.veiculos?.find((v: any) => v.placa === payload.placa);
                if (createdVeiculo) {
                    console.warn(`[SyncService] ⚠️ Veiculo matched by PLACA (${payload.placa}) instead of localId. Backend might not be saving localId correctly.`);
                }
            }

            // 3. Fallback: Full OS Fetch with Retry (Robust against eventual consistency)
            // If the simple POST response didn't give us the ID, we must fetch the OS.
            // Backend might be slow to index/commit, so we retry a few times.
            if (!createdVeiculo) {
                console.warn(`[SyncService] ⚠️ Veiculo ID missing in POST response. Fetching full OS ${payload.ordemServicoId} to resolve...`);

                const maxRetries = 3;
                const delays = [300, 600, 1200]; // Increasing backoff

                for (let i = 0; i < maxRetries; i++) {
                    try {
                        if (i > 0) {
                            console.log(`[SyncService] ⏳ Retry ${i + 1}/${maxRetries} fetching OS ${payload.ordemServicoId} in ${delays[i - 1]}ms...`);
                            await new Promise(resolve => setTimeout(resolve, delays[i - 1]));
                        }

                        const osRes = await api.get(`/ordens-servico/${payload.ordemServicoId}`);
                        if (osRes.data && osRes.data.veiculos) {
                            // 3.1 Try match by localId (Best & Most Specific)
                            createdVeiculo = osRes.data.veiculos.find((v: any) => v.localId === localId);

                            // 3.2 Fallback: Match by Placa (most reliable unique key for vehicle in OS if localId fails)
                            if (!createdVeiculo) {
                                createdVeiculo = osRes.data.veiculos.find((v: any) => v.placa === payload.placa);
                            }

                            if (createdVeiculo) {
                                console.log(`[SyncService] 🔄 Fallback Resolution: Found Veiculo ID ${createdVeiculo.id} via OS GET (Match: ${createdVeiculo.localId === localId ? 'LocalID' : 'Placa'}).`);
                                break; // Found it! Exit retry loop.
                            } else {
                                console.warn(`[SyncService] ⚠️ Fallback GET attempt ${i + 1} failed to find vehicle in OS ${payload.ordemServicoId}. Vehicles found: ${osRes.data.veiculos.length}`, JSON.stringify(osRes.data.veiculos.map((v: any) => ({ id: v.id, placa: v.placa, localId: v.localId }))));
                            }
                        } else {
                            console.warn(`[SyncService] ⚠️ Fallback GET attempt ${i + 1} returned no vehicles for OS ${payload.ordemServicoId}`);
                        }
                    } catch (fetchErr) {
                        console.error(`[SyncService] ❌ Failed to fetch OS for Veiculo resolution (Attempt ${i + 1}):`, fetchErr);
                    }
                }
            }

            // 4. Fallback: If only 1 vehicle exists in the OS, assume it's ours (Risky but helpful for single-vehicle OS)
            if (!createdVeiculo && res.data.veiculos?.length === 1) {
                createdVeiculo = res.data.veiculos[0];
                console.warn(`[SyncService] ⚠️ Veiculo matched by SINGLE_ITEM fallback. ID=${createdVeiculo.id}`);
            }

            if (createdVeiculo && createdVeiculo.id) {
                console.log(`[SyncService] ✅ Veiculo Created: Found ID ${createdVeiculo.id} for LocalID ${localId}`);
                // OPTIMIZATION: Immediate Mapping
                await VeiculoModel.markAsSynced(localId, createdVeiculo.id);
                return createdVeiculo.id;
            }

            // If completely failed
            console.error('[SyncService] ❌ Veiculo created but not found in OS response by localId/placa', res.data);
            throw new Error('Veiculo criado mas ID não retornado na resposta da OS (Fallback failed)');
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
            // Ignore payload.veiculoId if we have localId, as it might be a local PK
            let veiculoServerId = null;

            if (payload.veiculoLocalId) {
                const v = await VeiculoModel.getByLocalId(payload.veiculoLocalId);
                if (v?.server_id) {
                    veiculoServerId = v.server_id;
                    payload.veiculoId = v.server_id;
                    console.log(`[SyncService] 🔄 Dynamic Fix: Peca uses Veiculo ServerID ${v.server_id}`);
                } else {
                    // If we have localId but no server_id, it's a dependency failure
                    throw new Error(`Dependência de Veículo não satisfeita (LocalID: ${payload.veiculoLocalId})`);
                }
            } else {
                // Fallback: trust payload.veiculoId only if localId is missing
                veiculoServerId = payload.veiculoId;
            }

            if (!veiculoServerId) {
                throw new Error('Peca sem referência de Veículo (server_id)');
            }

            // CRITICAL FIX: Revert to standard endpoint
            // POST /ordens-servico/pecas
            const res = await api.post('/ordens-servico/pecas', { ...payload, localId });

            // OPTIMIZATION: Immediate Mapping
            if (res.data?.id) {
                await PecaModel.markAsSynced(localId, res.data.id);
            }

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
