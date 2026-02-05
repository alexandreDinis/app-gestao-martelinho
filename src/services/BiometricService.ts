import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Logger } from './Logger';

const BIOMETRIC_CREDENTIALS_KEY = 'biometric_credentials';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';

/**
 * Credentials stored for biometric authentication.
 * 
 * ⚠️ SECURITY WARNING:
 * This interface stores user passwords (encrypted via SecureStore) on the device.
 * While SecureStore provides encryption, storing passwords is a security trade-off
 * for convenience. Consider implementing refresh tokens on the backend as an
 * alternative to avoid storing passwords entirely.
 */
export interface BiometricCredentials {
    email: string;
    password: string;
}

export const BiometricService = {
    /**
     * Verifica se o dispositivo suporta autenticação biométrica
     */
    async isAvailable(): Promise<boolean> {
        try {
            const compatible = await LocalAuthentication.hasHardwareAsync();
            if (!compatible) {
                Logger.debug('Biometric: Hardware not available');
                return false;
            }

            const enrolled = await LocalAuthentication.isEnrolledAsync();
            if (!enrolled) {
                Logger.debug('Biometric: No biometric records enrolled');
                return false;
            }

            Logger.info('Biometric: Available and enrolled');
            return true;
        } catch (error) {
            Logger.error('Biometric: Error checking availability', error);
            return false;
        }
    },

    /**
     * Retorna o tipo de autenticação biométrica suportada
     */
    async getSupportedAuthenticationTypes(): Promise<string[]> {
        try {
            const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
            const typeNames = types.map(type => {
                switch (type) {
                    case LocalAuthentication.AuthenticationType.FINGERPRINT:
                        return 'Impressão Digital';
                    case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
                        return 'Reconhecimento Facial';
                    case LocalAuthentication.AuthenticationType.IRIS:
                        return 'Reconhecimento de Íris';
                    default:
                        return 'Biometria';
                }
            });
            return typeNames;
        } catch (error) {
            Logger.error('Biometric: Error getting authentication types', error);
            return [];
        }
    },

    /**
     * Autentica o usuário usando biometria
     */
    async authenticate(promptMessage: string = 'Autentique-se para continuar'): Promise<boolean> {
        try {
            Logger.debug('Biometric: Starting authentication with prompt:', promptMessage);

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage,
                cancelLabel: 'Cancelar',
                disableDeviceFallback: false,
                fallbackLabel: 'Usar senha do dispositivo'
            });

            Logger.debug('Biometric: Authentication result:', JSON.stringify(result, null, 2));

            if (result.success) {
                Logger.info('Biometric: Authentication successful');
                return true;
            } else {
                Logger.warn('Biometric: Authentication failed', {
                    success: result.success,
                    error: result.error,
                    warning: result.warning
                });
                return false;
            }
        } catch (error) {
            Logger.error('Biometric: Authentication error', error);
            return false;
        }
    },

    /**
     * Salva credenciais de forma segura após autenticação biométrica bem-sucedida
     * 
     * ⚠️ SECURITY NOTE:
     * This stores the user's password encrypted in SecureStore. While secure,
     * this is a trade-off between security and convenience. The password is
     * used to automatically login via the standard /auth/login endpoint when
     * biometric authentication succeeds.
     */
    async saveCredentials(credentials: BiometricCredentials): Promise<boolean> {
        try {
            const credentialsJson = JSON.stringify(credentials);
            await SecureStore.setItemAsync(BIOMETRIC_CREDENTIALS_KEY, credentialsJson);
            await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
            Logger.info('Biometric: Credentials saved successfully');
            return true;
        } catch (error) {
            Logger.error('Biometric: Error saving credentials', error);
            return false;
        }
    },

    /**
     * Recupera credenciais armazenadas (requer autenticação biométrica antes)
     */
    async getCredentials(): Promise<BiometricCredentials | null> {
        try {
            Logger.debug('Biometric: Attempting to retrieve credentials from SecureStore');

            const credentialsJson = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);

            if (!credentialsJson) {
                Logger.warn('Biometric: No credentials found in SecureStore (key: ' + BIOMETRIC_CREDENTIALS_KEY + ')');
                return null;
            }

            Logger.debug('Biometric: Credentials JSON found, parsing...');
            const credentials: BiometricCredentials = JSON.parse(credentialsJson);

            Logger.info('Biometric: Credentials retrieved successfully', {
                email: credentials.email,
                hasPassword: !!credentials.password
            });

            return credentials;
        } catch (error) {
            Logger.error('Biometric: Error retrieving credentials', error);
            return null;
        }
    },

    /**
     * Remove credenciais armazenadas
     */
    async removeCredentials(): Promise<boolean> {
        try {
            await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIALS_KEY);
            await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
            Logger.info('Biometric: Credentials removed successfully');
            return true;
        } catch (error) {
            Logger.error('Biometric: Error removing credentials', error);
            return false;
        }
    },

    /**
     * Verifica se a biometria está habilitada pelo usuário
     * Checa tanto a flag quanto a existência das credenciais
     */
    async isEnabled(): Promise<boolean> {
        try {
            const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);

            if (enabled !== 'true') {
                return false;
            }

            // Também verifica se as credenciais realmente existem
            // Previne estado inconsistente onde enabled=true mas não há credenciais
            const credentialsJson = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);

            if (!credentialsJson) {
                Logger.warn('Biometric: Enabled flag is true but no credentials found - resetting flag');
                // Limpa a flag se não há credenciais
                await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
                return false;
            }

            return true;
        } catch (error) {
            Logger.error('Biometric: Error checking if enabled', error);
            return false;
        }
    },

    /**
     * Fluxo completo: autentica e retorna credenciais
     */
    async authenticateAndGetCredentials(
        promptMessage: string = 'Autentique-se para acessar'
    ): Promise<BiometricCredentials | null> {
        Logger.debug('Biometric: Starting authenticateAndGetCredentials flow');

        const authenticated = await this.authenticate(promptMessage);

        if (!authenticated) {
            Logger.warn('Biometric: Authentication step failed, cannot retrieve credentials');
            return null;
        }

        Logger.debug('Biometric: Authentication step successful, retrieving credentials...');
        const credentials = await this.getCredentials();

        if (!credentials) {
            Logger.error('Biometric: Failed to retrieve credentials after successful authentication');
        }

        return credentials;
    }
};
