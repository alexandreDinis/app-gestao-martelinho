import { databaseService } from './src/services/database/databaseService';

async function debugSync() {
    console.log('--- DUPLICATE OS CHECK (ID 23 vs ServerID 23) ---');
    const os = await databaseService.runQuery(
        `SELECT id, local_id, server_id, status, sync_status, updated_at 
         FROM ordens_servico 
         WHERE id = 23 OR server_id = 23`
    );
    console.table(os);

    console.log('\n--- SYNC QUEUE STATUS (Why Backoff?) ---');
    const queue = await databaseService.runQuery(
        `SELECT id, resource, action, temp_id, payload, attempts, last_error 
         FROM sync_queue 
         WHERE resource = 'os' 
         ORDER BY id DESC LIMIT 5`
    );
    console.table(queue);
    
    // Check if backoff is active
    const now = Date.now();
    queue.forEach((q: any) => {
        if (q.next_retry_at > now) {
            console.log(`⚠️ Item ${q.id} is in BACKOFF until ${new Date(q.next_retry_at).toISOString()}`);
        }
    });
}
debugSync();
