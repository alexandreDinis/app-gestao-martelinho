// src/services/database/DatabaseService.ts
// Serviço de inicialização e gerenciamento do banco SQLite

import * as SQLite from 'expo-sqlite';
import { MIGRATIONS, CURRENT_DB_VERSION } from './migrations';

const DATABASE_NAME = 'sistema_comissao.db';

class DatabaseService {
    private db: SQLite.SQLiteDatabase | null = null;
    private isInitialized = false;

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            console.log('[DatabaseService] Initializing database...');
            this.db = await SQLite.openDatabaseAsync(DATABASE_NAME);

            await this.runMigrations();
            this.isInitialized = true;
            console.log('[DatabaseService] Database initialized successfully');
        } catch (error) {
            console.error('[DatabaseService] Failed to initialize database:', error);
            throw error;
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

                // Executar SQL da migração
                const statements = migration.sql
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                for (const statement of statements) {
                    await this.db.execAsync(statement);
                }

                // Atualizar versão
                await this.db.runAsync(
                    `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
                    ['db_version', migration.version.toString(), Date.now()]
                );
            }
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
}

export const databaseService = new DatabaseService();
