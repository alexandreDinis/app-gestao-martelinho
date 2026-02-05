// src/services/database/models/AuditLogModel.ts
// Model para registro de auditoria e conflitos

import { databaseService } from '../DatabaseService';
import { AuditLogEntry } from './types';

export const AuditLogModel = {
    /**
     * Registrar operação
     */
    async log(
        entityType: string,
        entityId: string,
        operation: string,
        oldData: any = null,
        newData: any = null,
        userId?: number
    ): Promise<number> {
        return await databaseService.runInsert(
            `INSERT INTO audit_log (entity_type, entity_id, operation, old_data, new_data, user_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                entityType,
                entityId,
                operation,
                oldData ? JSON.stringify(oldData) : null,
                newData ? JSON.stringify(newData) : null,
                userId || null,
                Date.now()
            ]
        );
    },

    /**
     * Registrar conflito detectado
     */
    async logConflict(
        entityType: string,
        entityId: string,
        operation: string,
        oldData: any,
        newData: any,
        resolution: string,
        userId?: number
    ): Promise<number> {
        return await databaseService.runInsert(
            `INSERT INTO audit_log (entity_type, entity_id, operation, old_data, new_data, conflict_detected, conflict_resolution, user_id, timestamp)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            [
                entityType,
                entityId,
                operation,
                oldData ? JSON.stringify(oldData) : null,
                newData ? JSON.stringify(newData) : null,
                resolution,
                userId || null,
                Date.now()
            ]
        );
    },

    /**
     * Obter histórico de uma entidade
     */
    async getByEntity(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
        return await databaseService.runQuery<AuditLogEntry>(
            `SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp DESC`,
            [entityType, entityId]
        );
    },

    /**
     * Obter conflitos recentes
     */
    async getConflicts(limit: number = 50): Promise<AuditLogEntry[]> {
        return await databaseService.runQuery<AuditLogEntry>(
            `SELECT * FROM audit_log WHERE conflict_detected = 1 ORDER BY timestamp DESC LIMIT ?`,
            [limit]
        );
    },

    /**
     * Obter todos os logs recentes
     */
    async getRecent(limit: number = 100): Promise<AuditLogEntry[]> {
        return await databaseService.runQuery<AuditLogEntry>(
            `SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?`,
            [limit]
        );
    },

    /**
     * Contar conflitos não resolvidos
     */
    async countConflicts(): Promise<number> {
        const result = await databaseService.getFirst<{ count: number }>(
            `SELECT COUNT(*) as count FROM audit_log WHERE conflict_detected = 1`
        );
        return result?.count ?? 0;
    },

    /**
     * Limpar logs antigos
     */
    async cleanup(daysToKeep: number = 90): Promise<number> {
        const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        return await databaseService.runDelete(
            `DELETE FROM audit_log WHERE timestamp < ?`,
            [cutoff]
        );
    }
};
