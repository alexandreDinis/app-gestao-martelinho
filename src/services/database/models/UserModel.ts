
import { databaseService } from '../DatabaseService';
import { User } from '../../../types';

export const UserModel = {
    async getAll(): Promise<User[]> {
        return await databaseService.runQuery<User>(
            `SELECT * FROM users ORDER BY name`
        );
    },

    async getAllByEmpresa(empresaId: number): Promise<User[]> {
        return await databaseService.runQuery<User>(
            `SELECT * FROM users WHERE empresa_id = ? ORDER BY name`,
            [empresaId]
        );
    },

    async getById(id: number): Promise<User | null> {
        return await databaseService.getFirst<User>(
            `SELECT * FROM users WHERE id = ? OR server_id = ?`,
            [id, id]
        );
    },

    async upsertBatch(users: any[], empresaId?: number): Promise<void> {
        if (!users || users.length === 0) return;

        for (const u of users) {
            // Handle missing name by falling back to email or email prefix
            const name = u.name || (u.email ? u.email.split('@')[0] : 'Usuário ' + u.id);
            // Use passed empresaId or try to find it in user object
            const eId = empresaId || u.empresaId || u.empresa_id || 0;

            await databaseService.runInsert(
                `INSERT OR REPLACE INTO users (id, server_id, name, email, role, empresa_id, updated_at)
                 VALUES (
                    (SELECT id FROM users WHERE server_id = ? OR email = ?),
                    ?, ?, ?, ?, ?, ?
                 )`,
                [u.id, u.email, u.id, name, u.email, u.role || 'user', eId, Date.now()]
            );
        }
    }
};
