import api from './api';
import { ResumoFinanceiro, CreateLancamentoRequest, Lancamento } from '../types';

export const financeiroService = {
    getResumo: async (): Promise<ResumoFinanceiro> => {
        const response = await api.get<ResumoFinanceiro>('/financeiro/resumo');
        return response.data;
    },
    adicionarLancamento: async (lancamento: CreateLancamentoRequest): Promise<Lancamento> => {
        const response = await api.post<Lancamento>('/financeiro/lancamentos', lancamento);
        return response.data;
    },
};
