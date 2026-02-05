export interface LoginRequest {
    email: string;
    password: string;
}

export interface RegisterRequest {
    email: string;
    password: string;
}

export interface Empresa {
    id?: number;
    nome: string;
    plano: 'BRONZE' | 'PRATA' | 'OURO' | string;
}

export interface Feature {
    id?: number;
    codigo: string;
    descricao?: string;
    planoMinimo?: string;
}

export interface UserResponse {
    token: string;
    email: string;
    name?: string;
    role?: string;
    roles?: string[];
    expiresIn: number;
    empresa?: Empresa;
    features?: string[];
    mustChangePassword?: boolean;
}

export interface User {
    id: number;
    email: string;
    name?: string;
    role?: string;
    roles?: string[];
    active: boolean;
    empresa?: Empresa;
    features?: Feature[] | string[];
    mustChangePassword?: boolean;
}

// --- Módulo OS Definitions ---

export type OSStatus = 'ABERTA' | 'EM_EXECUCAO' | 'FINALIZADA' | 'CANCELADA';

export type StatusCliente = 'ATIVO' | 'INATIVO' | 'EM_PROSPECCAO';

export type TipoPessoa = 'FISICA' | 'JURIDICA';

export interface Cliente {
    id: number;
    razaoSocial: string;
    nomeFantasia: string;
    cnpj?: string;
    cpf?: string;
    tipoPessoa?: TipoPessoa;
    endereco?: string;
    contato: string;
    email: string;
    status: StatusCliente;
    // Address Fields
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
}

export interface ClienteRequest {
    razaoSocial: string;
    nomeFantasia: string;
    cnpj?: string;
    cpf?: string;
    tipoPessoa?: TipoPessoa;
    endereco?: string;
    contato: string;
    email: string;
    status: StatusCliente;
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
}

export interface ClienteFiltros {
    termo?: string;
    cidade?: string;
    bairro?: string;
    status?: StatusCliente;
}

export interface PecaOS {
    id: number;
    nomePeca: string;
    valorCobrado: number;
    descricao?: string;
}

export interface VeiculoOS {
    id: number;
    placa: string;
    modelo: string;
    cor: string;
    valorTotal: number;
    pecas: PecaOS[];
}

export interface OrdemServico {
    id: number;
    data: string;
    dataVencimento?: string; // Para filtro de atrasadas
    atrasado?: boolean;
    status: OSStatus;
    valorTotal: number;
    valorTotalSemDesconto?: number;
    valorTotalComDesconto?: number;
    tipoDesconto?: 'PERCENTUAL' | 'VALOR_FIXO';
    valorDesconto?: number;
    cliente: Cliente;
    veiculos: VeiculoOS[];
    usuarioId?: number;
    usuarioNome?: string;
    usuarioEmail?: string;
    empresaId: number;
}

export interface CreateOSRequest {
    clienteId: number;
    data: string;
    dataVencimento?: string;
    usuarioId?: number;
}

export interface UpdateOSStatusRequest {
    status: OSStatus;
}

export interface AddVeiculoRequest {
    ordemServicoId: number;
    placa: string;
    modelo: string;
    cor: string;
}

export interface AddPecaRequest {
    veiculoId: number;
    tipoPecaId: number;
    valorCobrado?: number;
    descricao?: string;
}

export interface ComissaoCalculada {
    id?: number;
    anoMesReferencia: string;
    faturamentoMensal: number;
    faixaComissao: string;
    porcentagemComissao: number;
    valorBrutoComissao: number;
    valorAdiantado: number;
    saldoAReceber: number;
    saldoAnterior?: number;
    quitado?: boolean;
    dataQuitacao?: string;
}

export interface ResumoFinanceiro {
    receitaHoje: number;
    despesaHoje: number;
    saldoHoje: number;
    contasVencidas: number;
    valorContasVencidas: number;
    contasPagarHoje: number;
    contasReceberHoje: number;
}

export type TipoLancamento = 'RECEITA' | 'DESPESA';

export interface Lancamento {
    id: number;
    descricao: string;
    valor: number;
    tipo: TipoLancamento;
    data: string; // ISO Date YYYY-MM-DD
    categoria?: string;
    formaPagamento?: 'DINHEIRO' | 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'TRANSFERENCIA' | 'BOLETO';
}

export interface CreateLancamentoRequest {
    descricao: string;
    valor: number;
    tipo: TipoLancamento;
    data: string;
    categoria?: string;
    formaPagamento: 'DINHEIRO' | 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'TRANSFERENCIA' | 'BOLETO';
}

export interface DespesaRequest {
    dataDespesa: string;
    valor: number;
    categoria: string;
    descricao: string;
    pagoAgora?: boolean;
    dataVencimento?: string;
    meioPagamento?: string;
    cartaoId?: number;
    numeroParcelas?: number;
}
