import api from './api';
import { ComissaoCalculada } from '../types';

export interface IComissaoService {
    obterComissaoMensal(ano: number, mes: number): Promise<ComissaoCalculada>;
    forceSync(ano: number, mes: number): Promise<ComissaoCalculada>;
    getMinhasComissoes(): Promise<ComissaoCalculada[]>;
}

export const comissaoService: IComissaoService = {
    async obterComissaoMensal(ano: number, mes: number): Promise<ComissaoCalculada> {
        const response = await api.get<ComissaoCalculada>(`/comissao/${ano}/${mes}`);
        return response.data;
    },

    async forceSync(ano: number, mes: number): Promise<ComissaoCalculada> {
        const response = await api.post<ComissaoCalculada>(`/comissao/${ano}/${mes}/sync`);
        return response.data;
    },

    async getMinhasComissoes(): Promise<ComissaoCalculada[]> {
        const response = await api.get<ComissaoCalculada[]>('/comissao/minhas');
        return response.data;
    },
};
