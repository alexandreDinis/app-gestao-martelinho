import api from './api';

export const despesaService = {
    create: async (despesa: any): Promise<any> => {
        // Updated to use the dedicated Despesa endpoint
        const response = await api.post('/despesas', despesa);
        return response.data;
    },
    createParcelada: async (despesa: any): Promise<any[]> => {
        const response = await api.post<any[]>('/despesas/parcelada', despesa);
        return response.data;
    },
};
