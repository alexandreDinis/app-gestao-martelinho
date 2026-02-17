import { AxiosError } from 'axios';
import Toast from 'react-native-toast-message';

export interface ApiErrorResult {
    /** Mensagem geral do backend (ex: "Verifique os campos obrigatórios") */
    message: string;
    /** Erros por campo (ex: { razaoSocial: "Razão Social é obrigatória" }) */
    fieldErrors: Record<string, string>;
}

/**
 * Extrai erros estruturados de uma resposta de erro da API.
 * Backend retorna:
 *   { message: "...", errors?: { campo: "mensagem" } }
 */
export function extractApiErrors(error: unknown): ApiErrorResult {
    const fallback: ApiErrorResult = {
        message: 'Ocorreu um erro inesperado. Tente novamente.',
        fieldErrors: {},
    };

    if (!error) return fallback;

    const axiosError = error as AxiosError<any>;
    const data = axiosError?.response?.data;

    if (!data) {
        // Network error (sem resposta do servidor)
        if (axiosError?.message?.includes('Network Error')) {
            return { message: 'Sem conexão com o servidor. Verifique sua internet.', fieldErrors: {} };
        }
        if (axiosError?.message?.includes('timeout')) {
            return { message: 'Servidor demorou para responder. Tente novamente.', fieldErrors: {} };
        }
        return fallback;
    }

    const message = data.message || data.error || fallback.message;
    const fieldErrors: Record<string, string> = {};

    // Backend retorna { errors: { campo: "msg" } } para MethodArgumentNotValidException
    if (data.errors && typeof data.errors === 'object') {
        Object.entries(data.errors).forEach(([field, msg]) => {
            fieldErrors[field] = String(msg);
        });
    }

    return { message, fieldErrors };
}

/**
 * Exibe erro da API como Toast no estilo do app.
 * Se houver erros de campo, lista os primeiros 3.
 */
export function showApiErrorToast(error: unknown, fallbackMessage?: string): ApiErrorResult {
    const result = extractApiErrors(error);

    const fieldMessages = Object.values(result.fieldErrors);
    let text2 = '';

    if (fieldMessages.length > 0) {
        text2 = fieldMessages.slice(0, 3).join('\n');
        if (fieldMessages.length > 3) {
            text2 += `\n... e mais ${fieldMessages.length - 3} erro(s)`;
        }
    }

    Toast.show({
        type: 'error',
        text1: fallbackMessage || result.message,
        text2: text2 || undefined,
        visibilityTime: 5000,
        topOffset: 60,
    });

    return result;
}
