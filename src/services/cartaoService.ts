import api from './api';

export interface Cartao {
    id: number;
    nome: string;
    diaVencimento: number;
    diaFechamento: number;
    limite: number;
}

export interface LimiteDisponivelDTO {
    limiteTotal: number;
    limiteUtilizado: number;
    limiteDisponivel: number;
}

export const cartaoService = {
    listar: async (): Promise<Cartao[]> => {
        const response = await api.get<Cartao[]>('/cartoes');
        return response.data;
    },
    getLimiteDisponivel: async (id: number): Promise<LimiteDisponivelDTO> => {
        const response = await api.get<LimiteDisponivelDTO>(`/cartoes/${id}/limite-disponivel`);
        return response.data;
    },
};
