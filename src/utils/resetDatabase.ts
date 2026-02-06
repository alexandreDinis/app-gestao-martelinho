// Script temporário para resetar o banco de dados
// USO: Importar e chamar uma única vez

import { databaseService } from './services/database/DatabaseService';

export const resetDatabaseOnce = async () => {
    console.log('🔧 [RESET] Iniciando reset do banco de dados...');

    try {
        await databaseService.resetDatabase();
        console.log('✅ [RESET] Banco resetado com sucesso!');
        console.log('📋 [RESET] Todas as migrations foram re-executadas');
        console.log('⚠️ [RESET] REMOVA ESTA CHAMADA DO CÓDIGO!');
    } catch (error) {
        console.error('❌ [RESET] Erro ao resetar banco:', error);
    }
};
