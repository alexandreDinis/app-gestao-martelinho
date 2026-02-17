export const Logger = {
    info: (message: string, data?: any) => {
        // if (__DEV__) {
        console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        // }
    },
    warn: (message: string, data?: any) => {
        // if (__DEV__) {
        console.warn(`[WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        // }
    },
    error: (message: string, error?: any) => {
        // if (__DEV__) {
        console.error(`[ERROR] ${message}`, error);
        // }
    },
    debug: (message: string, data?: any) => {
        // if (__DEV__) {
        console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
        // }
    }
};
