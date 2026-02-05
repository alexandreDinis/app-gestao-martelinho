import api from './api';

export interface Cartao {
    id: number;
    nome: string;
    diaVencimento: number;
    diaFechamento: number;
    limite: number;
}

export const cartaoService = {
    listar: async (): Promise<Cartao[]> => {
        const response = await api.get<Cartao[]>('/cartoes');
        return response.data;
    },
};
