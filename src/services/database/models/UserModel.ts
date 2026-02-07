
import { databaseService } from '../DatabaseService';
import { User } from '../../../types';

export const UserModel = {
    async getAll(): Promise<User[]> {
        return await databaseService.runQuery<User>(
            `SELECT * FROM users ORDER BY name`
        );
    },

    async upsertBatch(users: any[]): Promise<void> {
        if (!users || users.length === 0) return;

        for (const u of users) {
            // Handle missing name by falling back to email or email prefix
            const name = u.name || (u.email ? u.email.split('@')[0] : 'Usuário ' + u.id);

            await databaseService.runInsert(
                `INSERT OR REPLACE INTO users (id, server_id, name, email, role, updated_at)
                 VALUES (
                    (SELECT id FROM users WHERE server_id = ? OR email = ?),
                    ?, ?, ?, ?, ?
                 )`,
                [u.id, u.email, u.id, name, u.email, u.role || 'user', Date.now()]
            );
        }
    }
};
