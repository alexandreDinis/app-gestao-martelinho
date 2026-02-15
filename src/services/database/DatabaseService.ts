// src/services/database/DatabaseService.ts
// Serviço de inicialização e gerenciamento do banco SQLite

import * as SQLite from 'expo-sqlite';
import { MIGRATIONS, CURRENT_DB_VERSION } from './migrations';

const DATABASE_NAME = 'sistema_comissao.db';

class DatabaseService {
    private db: SQLite.SQLiteDatabase | null = null;
    private initPromise: Promise<void> | null = null;
    private isInitialized = false;

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        // Singleton Lock: Prevent multiple concurrent init calls
        if (this.initPromise) {
            console.log('[DatabaseService] ⏳ Waiting for existing initialization...');
            return this.initPromise;
        }

        this.initPromise = (async () => {
            let retries = 3;
            while (retries > 0) {
                try {
                    console.log(`[DatabaseService] Initializing database (Attempts left: ${retries})...`);
                    this.db = await SQLite.openDatabaseAsync(DATABASE_NAME);

                    // 🚀 PERFORMANCE: Enable WAL (Write-Ahead Logging)
                    await this.db.execAsync('PRAGMA journal_mode = WAL;');
                    // ⏳ TIMEOUT: Increase busy timeout
                    await this.db.execAsync('PRAGMA busy_timeout = 5000;');
                    console.log('⚡ SQLite WAL Mode Enabled + Busy Timeout 5000ms');

                    await this.runMigrations();

                    // ... (Schema Safety Checks - keeping original logic)
                    if (this.db) {
                        await this.runSafetyChecks(this.db);
                    }

                    this.isInitialized = true;
                    console.log('[DatabaseService] Database initialized successfully');
                    return;
                } catch (error: any) {
                    console.error(`[DatabaseService] Init failed: ${error.message}`);
                    if (error.message?.includes('locked')) {
                        retries--;
                        console.log('⏳ Database locked. Waiting 1s before retry...');
                        await new Promise(r => setTimeout(r, 1000));
                    } else if (error.message?.includes('NativeDatabase')) {
                        // Fatal Native Error - Do not retry immediately in loop
                        console.error('[DatabaseService] 💀 Fatal Native Database Error. Aborting init.');
                        throw error;
                    } else {
                        retries--;
                    }
                }
            }
            throw new Error("Failed to initialize DB after 3 retries");
        })();

        return this.initPromise.finally(() => {
            // Clear promise on success or fatal failure (allows retry later if manually triggered)
            if (!this.isInitialized) {
                this.initPromise = null;
            }
        });
    }


    // Extracted safety checks to helper to keep init clean
    private async runSafetyChecks(db: SQLite.SQLiteDatabase) {
        console.log('[DatabaseService] 🛡️ Running safety schema enforcement...');
        // OS Columns
        await this.safeAddColumn('ordens_servico', 'usuario_id', 'INTEGER');
        await this.safeAddColumn('ordens_servico', 'usuario_nome', 'TEXT');
        await this.safeAddColumn('ordens_servico', 'usuario_email', 'TEXT');
        // User Columns
        await this.safeAddColumn('users', 'server_id', 'INTEGER');
        await this.safeAddColumn('users', 'name', 'TEXT');
        await this.safeAddColumn('users', 'email', 'TEXT');
        await this.safeAddColumn('users', 'role', 'TEXT');
        await this.safeAddColumn('users', 'empresa_id', 'INTEGER');
        // Multi-tenancy
        await this.safeAddColumn('ordens_servico', 'empresa_id', 'INTEGER');
        await this.safeAddColumn('clientes', 'empresa_id', 'INTEGER');
        // Sync Patch
        await this.safeAddColumn('clientes', 'deleted_at', 'TEXT');
        await this.safeAddColumn('clientes', 'server_updated_at', 'TEXT');
        await this.safeAddColumn('ordens_servico', 'deleted_at', 'TEXT');
        await this.safeAddColumn('ordens_servico', 'server_updated_at', 'TEXT');
        await this.safeAddColumn('veiculos_os', 'deleted_at', 'TEXT');
        await this.safeAddColumn('pecas_os', 'deleted_at', 'TEXT');

        // Index creation
        try {
            await db.execAsync('CREATE INDEX IF NOT EXISTS idx_users_empresa_id ON users (empresa_id);');
            await db.execAsync('CREATE INDEX IF NOT EXISTS idx_os_empresa_id ON ordens_servico (empresa_id);');
            await db.execAsync('CREATE INDEX IF NOT EXISTS idx_clientes_empresa_id ON clientes (empresa_id);');
        } catch (e) { console.warn('[DatabaseService] Failed to create indices', e); }

        // Sync Queue
        await this.safeAddColumn('sync_queue', 'attempts', 'INTEGER DEFAULT 0');
        await this.safeAddColumn('sync_queue', 'last_attempt', 'INTEGER');
        await this.safeAddColumn('sync_queue', 'next_retry_at', 'TEXT');

        // Auto Repair Logic
        await this.runAutoRepair(db);
    }

    private async runAutoRepair(db: SQLite.SQLiteDatabase) {
        // ... (existing auto-repair logic)
        // 🛠️ AUTO-REPAIR: Deduplicate Clientes (Fix for React Key Conflict)
        try {
            console.log('[DatabaseService] 🔧 Starting Client Auto-Repair...');
            const missingLocalId = await db.getAllAsync<{ id: number }>(`SELECT id FROM clientes WHERE local_id IS NULL OR local_id = ''`);

            if (missingLocalId.length > 0) {
                const { v4: uuidv4 } = require('uuid');
                for (const row of missingLocalId) {
                    await db.runAsync(`UPDATE clientes SET local_id = ? WHERE id = ?`, [uuidv4(), row.id]);
                }
            }

            const duplicates = await db.getAllAsync<{ server_id: number; count: number }>(`
                 SELECT server_id, COUNT(*) as count 
                 FROM clientes 
                 WHERE server_id IS NOT NULL 
                 GROUP BY server_id 
                 HAVING COUNT(*) > 1
             `);

            if (duplicates.length > 0) {
                for (const dupe of duplicates) {
                    const winner = await db.getFirstAsync<{ id: number; local_id: string }>(`
                         SELECT id, local_id FROM clientes 
                         WHERE server_id = ? 
                         ORDER BY updated_at DESC, sync_status DESC 
                         LIMIT 1
                     `, [dupe.server_id]);

                    if (winner) {
                        const losers = await db.getAllAsync<{ id: number; local_id: string }>(`
                             SELECT id, local_id FROM clientes 
                             WHERE server_id = ? AND id != ?
                         `, [dupe.server_id, winner.id]);

                        for (const loser of losers) {
                            await db.runAsync(`
                                 UPDATE ordens_servico 
                                 SET cliente_id = ?, cliente_local_id = ? 
                                 WHERE cliente_id = ? OR (cliente_local_id = ? AND cliente_local_id IS NOT NULL)
                             `, [winner.id, winner.local_id, loser.id, loser.local_id]);
                            await db.runAsync(`DELETE FROM clientes WHERE id = ?`, [loser.id]);
                        }
                    }
                }
            }
        } catch (error: any) {
            console.warn('[DatabaseService] ⚠️ Error in client auto-repair:', error.message);
        }
    }

    private async runMigrations(): Promise<void> {
        if (!this.db) throw new Error('Database not opened');

        // Verificar versão atual do banco
        let currentVersion = 0;
        try {
            const result = await this.db.getFirstAsync<{ value: string }>(
                `SELECT value FROM sync_metadata WHERE key = 'db_version'`
            );
            if (result) {
                currentVersion = parseInt(result.value, 10);
            }
        } catch {
            // Tabela não existe ainda, versão 0
            currentVersion = 0;
        }

        console.log(`[DatabaseService] Current DB version: ${currentVersion}, Target: ${CURRENT_DB_VERSION}`);

        // Executar migrações pendentes
        for (const migration of MIGRATIONS) {
            if (migration.version > currentVersion) {
                console.log(`[DatabaseService] Running migration ${migration.version}: ${migration.name}`);

                // Executar SQL da migração (se houver)
                if (migration.sql) {
                    const statements = migration.sql
                        .split(';')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);

                    for (const statement of statements) {
                        // Skip if statement is just comments
                        const cleanStatement = statement
                            .split('\n')
                            .filter(line => !line.trim().startsWith('--'))
                            .join('\n')
                            .trim();

                        if (cleanStatement.length > 0) {
                            try {
                                await this.db.execAsync(cleanStatement);
                            } catch (stmtError: any) {
                                // Tolerate "duplicate column name" errors (idempotent column additions)
                                if (stmtError.message?.includes('duplicate column name')) {
                                    console.log(`[DatabaseService] ⏭️ Column already exists, skipping: ${cleanStatement.substring(0, 80)}...`);
                                } else {
                                    throw stmtError; // Re-throw real errors
                                }
                            }
                        }
                    }
                }

                // Executar função UP da migração (se houver)
                if (migration.up) {
                    console.log(`[DatabaseService] Running UP function for migration ${migration.version}...`);
                    await migration.up(this.db);
                }

                // Atualizar versão
                await this.db.runAsync(
                    `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
                    ['db_version', migration.version.toString(), Date.now()]
                );
            }
        }

    }


    /**
     * Adiciona uma coluna à tabela de forma segura (verifica se já existe)
     */
    /**
     * Adiciona uma coluna à tabela de forma segura (verifica se já existe)
     */
    async safeAddColumn(tableName: string, columnName: string, columnType: string): Promise<void> {
        if (!this.db) return;

        try {
            // Check if column exists using PRAGMA
            const result = await this.db.getAllAsync<{ name: string }>(
                `PRAGMA table_info(${tableName})`
            );

            const columnExists = result.some(col => col.name === columnName);

            if (columnExists) {
                // console.log(`[DatabaseService] Column ${columnName} already exists in ${tableName}`);
                return;
            }

            console.log(`[DatabaseService] Adding missing column ${columnName} to ${tableName}...`);
            await this.db.execAsync(
                `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`
            );
            console.log(`[DatabaseService] ✅ Added column ${columnName} to ${tableName}`);
        } catch (error: any) {
            console.error(`[DatabaseService] 🛑 CRITICAL: Failed to add column ${columnName} to ${tableName}:`, error);
        }
    }

    async getDatabase(): Promise<SQLite.SQLiteDatabase> {
        if (!this.db || !this.isInitialized) {
            console.warn('[DatabaseService] Database not initialized, attempt auto-init...');
            await this.initialize();
        }
        if (!this.db) {
            throw new Error('Database failed to initialize');
        }
        return this.db;
    }

    async close(): Promise<void> {
        if (this.db) {
            await this.db.closeAsync();
            this.db = null;
            this.isInitialized = false;
            console.log('[DatabaseService] Database closed');
        }
    }

    /**
     * Executes a database operation with auto-retry and re-initialization on failure.
     * Prevents crashes due to "NativeDatabase.prepareAsync" NPEs or closed connections.
     */
    private async performWithRetry<T>(operation: (db: SQLite.SQLiteDatabase) => Promise<T>, attempts = 2): Promise<T> {
        try {
            const db = await this.getDatabase();
            return await operation(db);
        } catch (error: any) {
            const msg = error?.message || String(error);
            // Catch common native layer crashes or closed DB errors
            if (attempts > 0 && (
                msg.includes('NativeDatabase.prepareAsync') ||
                msg.includes('NullPointerException') ||
                msg.includes('database not open') ||
                msg.includes('closed')
            )) {
                console.warn(`[DatabaseService] ⚠️ DB Error detected ("${msg}"). Re-initializing and retrying (${attempts} left)...`);

                // Force reset connection
                this.db = null;
                this.isInitialized = false;

                // Retry
                return this.performWithRetry(operation, attempts - 1);
            }
            throw error;
        }
    }

    // Métodos utilitários genéricos - Agora usando performWithRetry

    async runQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
        return this.performWithRetry(async (db) => {
            return await db.getAllAsync<T>(sql, params);
        });
    }

    async runInsert(sql: string, params: any[] = []): Promise<number> {
        return this.performWithRetry(async (db) => {
            const result = await db.runAsync(sql, params);
            return result.lastInsertRowId;
        });
    }

    async runUpdate(sql: string, params: any[] = []): Promise<number> {
        return this.performWithRetry(async (db) => {
            const result = await db.runAsync(sql, params);
            return result.changes;
        });
    }

    async runDelete(sql: string, params: any[] = []): Promise<number> {
        return this.performWithRetry(async (db) => {
            const result = await db.runAsync(sql, params);
            return result.changes;
        });
    }

    async getFirst<T>(sql: string, params: any[] = []): Promise<T | null> {
        return this.performWithRetry(async (db) => {
            return await db.getFirstAsync<T>(sql, params);
        });
    }

    // Métodos de metadados

    async getMetadata(key: string): Promise<string | null> {
        const result = await this.getFirst<{ value: string }>(
            `SELECT value FROM sync_metadata WHERE key = ?`,
            [key]
        );
        return result?.value ?? null;
    }

    async setMetadata(key: string, value: string): Promise<void> {
        await this.runQuery(
            `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
            [key, value, Date.now()]
        );
    }

    // Limpeza de dados antigos

    async cleanupOldData(daysToKeep: number = 60): Promise<void> {
        const cutoffDate = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

        console.log(`[DatabaseService] Cleaning up data older than ${daysToKeep} days...`);

        // Remover OS finalizadas antigas (manter apenas sincronizadas)
        const osDeleted = await this.runDelete(
            `DELETE FROM ordens_servico 
       WHERE status = 'FINALIZADA' 
       AND sync_status = 'SYNCED'
       AND updated_at < ?`,
            [cutoffDate]
        );

        // Limpar peças e veículos órfãos
        await this.runDelete(
            `DELETE FROM pecas_os 
       WHERE veiculo_id NOT IN (SELECT id FROM veiculos_os)`
        );

        await this.runDelete(
            `DELETE FROM veiculos_os 
       WHERE os_id NOT IN (SELECT id FROM ordens_servico)`
        );

        // Limpar logs de auditoria muito antigos
        const auditCutoff = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 dias
        await this.runDelete(
            `DELETE FROM audit_log WHERE timestamp < ?`,
            [auditCutoff]
        );

        console.log(`[DatabaseService] Cleanup complete. Removed ${osDeleted} old OS records.`);
    }

    // Estatísticas do banco

    async getDatabaseStats(): Promise<{
        clientes: number;
        os: number;
        pendingSync: number;
        auditLogs: number;
    }> {
        const [clientes, os, pendingSync, auditLogs] = await Promise.all([
            this.getFirst<{ count: number }>(`SELECT COUNT(*) as count FROM clientes`),
            this.getFirst<{ count: number }>(`SELECT COUNT(*) as count FROM ordens_servico`),
            this.getFirst<{ count: number }>(`SELECT COUNT(*) as count FROM sync_queue`),
            this.getFirst<{ count: number }>(`SELECT COUNT(*) as count FROM audit_log`),
        ]);

        return {
            clientes: clientes?.count ?? 0,
            os: os?.count ?? 0,
            pendingSync: pendingSync?.count ?? 0,
            auditLogs: auditLogs?.count ?? 0,
        };
    }

    /**
     * 🔧 DEBUG: Resetar banco de dados (apagar tudo e recriar)
     */
    async resetDatabase(): Promise<void> {
        console.log('[DatabaseService] 🔄 Resetting database...');
        const db = await this.getDatabase(); // Use await getDatabase()

        // Listar todas as tabelas
        const tables = await db.getAllAsync<{ name: string }>(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `);

        // Dropar todas as tabelas
        for (const table of tables) {
            console.log(`[DatabaseService] Dropping table: ${table.name}`);
            await db.execAsync(`DROP TABLE IF EXISTS ${table.name}`);
        }

        // 🛡️ LIMPEZA DE ESTADO DE SYNC (CRÍTICO)
        // Se apagamos o banco, precisamos apagar os marcadores de sync para forçar bootstrap
        try {
            const SecureStore = require('expo-secure-store');
            console.log('[DatabaseService] 🧹 Clearing sync markers from SecureStore...');
            await SecureStore.deleteItemAsync('last_full_sync_at');
            await SecureStore.deleteItemAsync('last_sync_clientes');
            await SecureStore.deleteItemAsync('last_sync_os');
            await SecureStore.deleteItemAsync('has_forced_address_repair_v1');
        } catch (error) {
            console.warn('[DatabaseService] Failed to clear SecureStore markers:', error);
        }

        // Recriar do zero
        console.log('[DatabaseService] Re-running migrations...');
        await this.runMigrations();
        console.log('[DatabaseService] ✅ Database reset complete');
    }
}

export const databaseService = new DatabaseService();
