
import { databaseService } from '../DatabaseService';

export interface LocalTipoPeca {
    id: number;
    nome: string;
    valor_padrao: number;
    updated_at: number;
}

export const TiposPecaModel = {
    async getAll(): Promise<LocalTipoPeca[]> {
        const types = await databaseService.runQuery<LocalTipoPeca>(
            `SELECT * FROM tipos_peca ORDER BY nome`
        );
        return types.map(t => ({
            id: t.id,
            nome: t.nome,
            valorPadrao: t.valor_padrao,
            updated_at: t.updated_at,
            valor_padrao: t.valor_padrao // Keep db field compatible if needed or use Omit
        })) as LocalTipoPeca[];
    },

    async upsertBatch(items: any[]): Promise<void> {
        if (!items || items.length === 0) return;

        // console.log(`[TiposPecaModel] Upserting ${items.length} types`);

        for (const i of items) {
            await databaseService.runInsert(
                `INSERT OR REPLACE INTO tipos_peca (id, nome, valor_padrao, updated_at)
                 VALUES (?, ?, ?, ?)`,
                [i.id, i.nome, i.valorPadrao, Date.now()]
            );
        }
    }
};
