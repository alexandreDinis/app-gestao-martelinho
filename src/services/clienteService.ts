import api from './api';
import { Cliente, ClienteRequest, ClienteFiltros } from '../types';

export const clienteService = {
    getAll: async (): Promise<Cliente[]> => {
        const response = await api.get<Cliente[]>('/clientes');
        return response.data;
    },

    getById: async (id: number): Promise<Cliente> => {
        const response = await api.get<Cliente>(`/clientes/${id}`);
        return response.data;
    },

    create: async (data: ClienteRequest): Promise<Cliente> => {
        const response = await api.post<Cliente>('/clientes', data);
        return response.data;
    },

    update: async (id: number, data: Partial<ClienteRequest>): Promise<Cliente> => {
        const response = await api.put<Cliente>(`/clientes/${id}`, data);
        return response.data;
    },

    search: async (filtros: ClienteFiltros): Promise<Cliente[]> => {
        const params = new URLSearchParams();
        if (filtros.termo) params.append('termo', filtros.termo);
        if (filtros.cidade) params.append('cidade', filtros.cidade);
        if (filtros.bairro) params.append('bairro', filtros.bairro);
        if (filtros.status) params.append('status', filtros.status);

        const response = await api.get<Cliente[]>(`/clientes/search?${params.toString()}`);
        return response.data;
    },
};
