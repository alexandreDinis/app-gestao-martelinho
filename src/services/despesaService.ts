import api from './api';
import { DespesaModel } from './database/models/DespesaModel';
import { Logger } from './Logger';
import { OfflineDebug } from '../utils/OfflineDebug';

export const despesaService = {
    create: async (data: any): Promise<any> => {
        Logger.info('[DespesaService] Creating despesa', data);

        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                Logger.info('[DespesaService] Attempting API create (online mode)');
                const response = await api.post('/despesas', data);
                Logger.info('[DespesaService] Despesa created successfully via API', { id: response.data.id });

                // Salvar no cache local como SYNCED
                await DespesaModel.upsertFromServer(response.data);

                return response.data;
            } catch (error) {
                Logger.error('[DespesaService] API create failed, falling back to offline mode', error);
                // Continua para offline
            }
        }

        // Modo offline: salvar localmente e adicionar à fila
        Logger.info('[DespesaService] Creating despesa in offline mode');
        const localDespesa = await DespesaModel.create({
            data: data.dataDespesa || data.data,
            valor: data.valor,
            categoria: data.categoria,
            descricao: data.descricao,
            pagoAgora: data.pagoAgora,
            meioPagamento: data.meioPagamento,
            dataVencimento: data.dataVencimento,
            cartaoId: data.cartaoId
        });

        Logger.info('[DespesaService] Despesa created locally', { localId: localDespesa.local_id });

        // 🔧 Trigger immediate sync
        if (!OfflineDebug.isForceOffline()) {
            import('./SyncService').then(m => m.SyncService.processQueue('Despesa.create_fallback').catch(e => console.error(e)));
        }

        return localDespesa;
    },

    createParcelada: async (data: any): Promise<any[]> => {
        // Para despesas parceladas, o ideal é o servidor processar.
        // Se offline, podemos tentar salvar localmente, mas a complexidade de gerar parcelas localmente é alta.
        // Vamos manter online-only por enquanto ou simplificar.
        const { isConnected, isInternetReachable } = await OfflineDebug.checkConnectivity();
        const isOnline = isConnected && isInternetReachable && !OfflineDebug.isForceOffline();

        if (isOnline) {
            try {
                const response = await api.post<any[]>('/despesas/parcelada', data);
                // Upsert das parcelas criadas
                for (const d of response.data) {
                    await DespesaModel.upsertFromServer(d);
                }
                return response.data;
            } catch (error) {
                Logger.error('[DespesaService] API createParcelada failed', error);
                throw error;
            }
        }

        throw new Error('Criação de despesa parcelada exige conexão com a internet.');
    },
};
