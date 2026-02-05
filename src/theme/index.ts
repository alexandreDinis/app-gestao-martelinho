// Theme colors matching web frontend cyber/gold theme
export const theme = {
    colors: {
        // Primary - Cyber Gold
        primary: '#D4AF37',
        primaryDark: '#B8941F',
        primaryLight: '#E5C85C',
        primaryMuted: 'rgba(212, 175, 55, 0.1)',

        // Background
        background: '#0a0a0a',
        backgroundSecondary: '#111111',
        backgroundCard: 'rgba(0, 0, 0, 0.8)',

        // Surface
        surface: '#1a1a1a',
        surfaceElevated: '#222222',

        // Text
        text: '#D4AF37',
        textSecondary: 'rgba(212, 175, 55, 0.7)',
        textMuted: 'rgba(212, 175, 55, 0.4)',
        textWhite: '#ffffff',

        // Border
        border: 'rgba(212, 175, 55, 0.2)',
        borderFocus: '#D4AF37',

        // Status colors
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',

        // OS Status specific
        statusAberta: '#3b82f6',
        statusEmExecucao: '#f59e0b',
        statusFinalizada: '#22c55e',
        statusCancelada: '#ef4444',
    },

    spacing: {
        xs: 4,
        sm: 8,
        md: 16,
        lg: 24,
        xl: 32,
    },

    borderRadius: {
        sm: 4,
        md: 8,
        lg: 12,
        xl: 16,
        full: 9999,
    },
};

export type Theme = typeof theme;
