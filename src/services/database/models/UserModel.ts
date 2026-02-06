
import { databaseService } from '../DatabaseService';
import { User } from '../../../types';

export const UserModel = {
    async getAll(): Promise<User[]> {
        return await databaseService.runQuery<User>(
            `SELECT * FROM users ORDER BY name`
        );
    },

    async upsertBatch(users: User[]): Promise<void> {
        if (!users || users.length === 0) return;

        // console.log(`[UserModel] Upserting ${users.length} users`);

        for (const u of users) {
            await databaseService.runInsert(
                `INSERT OR REPLACE INTO users (id, name, email, role, updated_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [u.id, u.name, u.email, u.role, Date.now()]
            );
        }
    }
};
