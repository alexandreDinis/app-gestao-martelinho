// src/services/database/models/BaseModel.ts
import { databaseService } from '../DatabaseService';

/**
 * Função genérica para limpeza de zombies (registros locais SYNCED que não existem mais no servidor)
 * 
 * @param tableName Nome da tabela (ex: 'pecas_os', 'veiculos_servico')
 * @param parentIdColumn Nome da coluna de chave estrangeira (ex: 'veiculo_id', 'os_id')
 * @param parentId Valor do ID do pai (ex: veiculo.id)
 * @param serverIds Lista de IDs do servidor que são VÁLIDOS (que vieram no payload)
 * @returns Número de registros deletados
 */
export const cleanZombies = async (
    tableName: string,
    parentIdColumn: string,
    parentId: number,
    serverIds: number[]
): Promise<number> => {
    if (!serverIds || serverIds.length === 0) {
        // Se a lista de IDs do servidor estiver vazia, significa que o pai não tem nenhum filho no servidor.
        // Nesse caso, todos os filhos SYNCED locais devem ser removidos.
        // Mas precisamos ter cuidado se serverIds for undefined/null (erro de payload?) ou array vazio (realmente vazio).
        // Assumindo que quem chama garante que serverIds é a lista "snapshot".
    }

    // Se serverIds for vazio, o NOT IN falha ou retorna tudo?
    // SQL: id NOT IN () -> Syntax error in some DBs, or "NOT IN (NULL)" logic.
    // Melhor tratar array vazio separadamente ou usar truque (ex: -1).

    const safeServerIds = serverIds.length > 0 ? serverIds : [-1];

    const placeholder = safeServerIds.map(() => '?').join(',');

    // 1. Identificar Zombies
    const query = `
    SELECT id, local_id FROM ${tableName} 
    WHERE ${parentIdColumn} = ? 
      AND sync_status = 'SYNCED' 
      AND server_id NOT IN (${placeholder})
  `;

    const params = [parentId, ...safeServerIds];

    const zombies = await databaseService.runQuery<{ id: number, local_id: string }>(query, params);

    if (zombies.length > 0) {
        const zombieIds = zombies.map(z => z.id);
        const idPlaceholder = zombieIds.map(() => '?').join(',');

        await databaseService.getDatabase().withTransactionAsync(async () => {
            // Deletar da tabela principal
            await databaseService.runDelete(
                `DELETE FROM ${tableName} WHERE id IN (${idPlaceholder})`,
                zombieIds
            );

            // Deletar da fila de sync (se houver lixo lá)
            const zombieLocalIds = zombies.map(z => z.local_id);
            const localIdPlaceholder = zombieLocalIds.map(() => '?').join(',');
            await databaseService.runDelete(
                `DELETE FROM sync_queue WHERE resource = ? AND temp_id IN (${localIdPlaceholder})`,
                [getQueueResourceName(tableName), ...zombieLocalIds]
            );
        });
    }

    if (zombies.length > 0) {
        console.log(`[${tableName}] 🗑️ Removidos ${zombies.length} registros 'zombie' para ${parentIdColumn}=${parentId}`);
    }

    return zombies.length;
};

// Helper para mapear tabela -> resource name na sync_queue
function getQueueResourceName(tableName: string): string {
    switch (tableName) {
        case 'pecas_os': return 'peca';
        case 'veiculos_os': return 'veiculo';
        case 'ordens_servico': return 'os';
        case 'clientes': return 'cliente';
        default: return 'unknown';
    }
}
