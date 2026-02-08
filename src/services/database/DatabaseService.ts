// src/services/database/DatabaseService.ts
// Serviço de inicialização e gerenciamento do banco SQLite

import * as SQLite from 'expo-sqlite';
import { MIGRATIONS, CURRENT_DB_VERSION } from './migrations';

const DATABASE_NAME = 'sistema_comissao.db';

class DatabaseService {
    private db: SQLite.SQLiteDatabase | null = null;
    private isInitialized = false;

    async initialize(): Promise<void> {
        let retries = 3;
        while (retries > 0) {
            try {
                console.log(`[DatabaseService] Initializing database (Attempts left: ${retries})...`);
                this.db = await SQLite.openDatabaseAsync(DATABASE_NAME);

                // 🚀 PERFORMANCE: Enable WAL (Write-Ahead Logging) to fix "database is locked"
                await this.db.execAsync('PRAGMA journal_mode = WAL;');

                // ⏳ TIMEOUT: Increase busy timeout to 5 seconds to handle high concurrency
                await this.db.execAsync('PRAGMA busy_timeout = 5000;');
                console.log('⚡ SQLite WAL Mode Enabled + Busy Timeout 5000ms');

                await this.runMigrations();

                // 🛡️ SAFETY CHECK: Force ensure columns exist independently of migration version status
                // This fixes cases where V5/V6 might be skipped or fail due to dev environment issues
                console.log('[DatabaseService] 🛡️ Running safety schema enforcement...');

                // OS Columns
                await this.safeAddColumn('ordens_servico', 'usuario_id', 'INTEGER');
                await this.safeAddColumn('ordens_servico', 'usuario_nome', 'TEXT');
                await this.safeAddColumn('ordens_servico', 'usuario_email', 'TEXT');

                // User Columns (Defense against V2/V4/V6 inconsistencies)
                await this.safeAddColumn('users', 'server_id', 'INTEGER');
                await this.safeAddColumn('users', 'name', 'TEXT');
                await this.safeAddColumn('users', 'email', 'TEXT');
                await this.safeAddColumn('users', 'role', 'TEXT');

                this.isInitialized = true;
                console.log('[DatabaseService] Database initialized successfully');
                return; // Success, exit function
            } catch (error: any) {
                console.error(`[DatabaseService] Init failed: ${error.message}`);
                if (error.message?.includes('locked')) {
                    retries--;
                    console.log('⏳ Database locked. Waiting 1s before retry...');
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    throw error; // Fatal error
                }
            }
        }
        throw new Error("Failed to initialize DB after 3 retries");
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

                // Executar SQL da migração
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
                        await this.db.execAsync(cleanStatement);
                    }
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

    getDatabase(): SQLite.SQLiteDatabase {
        if (!this.db) {
            throw new Error('Database not initialized. Call initialize() first.');
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

    // Métodos utilitários genéricos

    async runQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
        const db = this.getDatabase();
        return await db.getAllAsync<T>(sql, params);
    }

    async runInsert(sql: string, params: any[] = []): Promise<number> {
        const db = this.getDatabase();
        const result = await db.runAsync(sql, params);
        return result.lastInsertRowId;
    }

    async runUpdate(sql: string, params: any[] = []): Promise<number> {
        const db = this.getDatabase();
        const result = await db.runAsync(sql, params);
        return result.changes;
    }

    async runDelete(sql: string, params: any[] = []): Promise<number> {
        const db = this.getDatabase();
        const result = await db.runAsync(sql, params);
        return result.changes;
    }

    async getFirst<T>(sql: string, params: any[] = []): Promise<T | null> {
        const db = this.getDatabase();
        return await db.getFirstAsync<T>(sql, params);
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
        const db = this.getDatabase();

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
