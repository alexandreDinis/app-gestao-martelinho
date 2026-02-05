import api from './api';

export const despesaService = {
    create: async (despesa: any): Promise<any> => {
        const response = await api.post('/financeiro/lancamentos', {
            ...despesa,
            tipo: 'DESPESA',
        });
        return response.data;
    },
};
