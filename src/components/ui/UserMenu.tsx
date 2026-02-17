import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { LogOut, ChevronDown, Shield, Key, X } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { theme } from '../../theme';

const getInitials = (name?: string, email?: string) => {
    const source = name || email || '??';
    const parts = source.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return source.substring(0, 2).toUpperCase();
};

const getRoleBadge = (role?: string) => {
    switch (role?.toUpperCase().replace('ROLE_', '')) {
        case 'SUPER_ADMIN':
        case 'ADMIN_PLATAFORMA':
            return { label: 'ADMIN PLATAFORMA', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)' };
        case 'ADMIN_EMPRESA':
            return { label: 'ADMINISTRADOR', color: theme.colors.primary, bg: theme.colors.primaryMuted, border: theme.colors.border };
        case 'FUNCIONARIO':
            return { label: 'USUÁRIO', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.1)', border: 'rgba(156, 163, 175, 0.3)' };
        default:
            return { label: 'USUÁRIO', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.1)', border: 'rgba(156, 163, 175, 0.3)' };
    }
};

interface UserMenuProps {
    onChangePassword?: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ onChangePassword }) => {
    const { user, signOut } = useAuth();
    const [isOpen, setIsOpen] = useState(false);

    if (!user) return null;

    const roleBadge = getRoleBadge(user.role);

    return (
        <>
            {/* Trigger Button */}
            <TouchableOpacity
                onPress={() => setIsOpen(true)}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                }}
                activeOpacity={0.7}
            >
                {/* Avatar */}
                <View
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        backgroundColor: theme.colors.primaryMuted,
                        borderWidth: 1.5,
                        borderColor: 'rgba(212, 175, 55, 0.4)',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '800' }}>
                        {getInitials(user.name, user.email)}
                    </Text>
                </View>
                <ChevronDown size={12} color={theme.colors.textMuted} />
            </TouchableOpacity>

            {/* Dropdown Modal */}
            <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
                <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
                    onPress={() => setIsOpen(false)}
                >
                    <Pressable
                        style={{
                            position: 'absolute',
                            top: 50,
                            right: 16,
                            width: 260,
                            backgroundColor: '#0a0a0a',
                            borderWidth: 1,
                            borderColor: 'rgba(212, 175, 55, 0.4)',
                            borderRadius: 12,
                            overflow: 'hidden',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 10 },
                            shadowOpacity: 0.5,
                            shadowRadius: 20,
                            elevation: 20,
                        }}
                        onPress={(e) => e.stopPropagation()}
                    >
                        {/* User Info Header */}
                        <View
                            style={{
                                paddingHorizontal: 16,
                                paddingVertical: 14,
                                borderBottomWidth: 1,
                                borderBottomColor: 'rgba(212, 175, 55, 0.15)',
                                backgroundColor: 'rgba(212, 175, 55, 0.05)',
                            }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                {/* Large Avatar */}
                                <View
                                    style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: 20,
                                        backgroundColor: theme.colors.primaryMuted,
                                        borderWidth: 2,
                                        borderColor: 'rgba(212, 175, 55, 0.4)',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '800' }}>
                                        {getInitials(user.name, user.email)}
                                    </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
                                        {user.name || 'Usuário'}
                                    </Text>
                                    <Text style={{ color: theme.colors.textMuted, fontSize: 11 }} numberOfLines={1}>
                                        {user.email}
                                    </Text>
                                    <View
                                        style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            gap: 4,
                                            marginTop: 4,
                                            alignSelf: 'flex-start',
                                            paddingHorizontal: 6,
                                            paddingVertical: 2,
                                            borderRadius: 4,
                                            backgroundColor: roleBadge.bg,
                                            borderWidth: 1,
                                            borderColor: roleBadge.border,
                                        }}
                                    >
                                        <Shield size={8} color={roleBadge.color} />
                                        <Text style={{ color: roleBadge.color, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 }}>
                                            {roleBadge.label}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>

                        {/* Menu Items */}
                        {onChangePassword && (
                            <View style={{ paddingVertical: 4 }}>
                                <TouchableOpacity
                                    onPress={() => {
                                        setIsOpen(false);
                                        onChangePassword();
                                    }}
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 12,
                                        paddingHorizontal: 16,
                                        paddingVertical: 12,
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Key size={16} color={theme.colors.textSecondary} />
                                    <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                                        Alterar Senha
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Logout */}
                        <View
                            style={{
                                borderTopWidth: 1,
                                borderTopColor: 'rgba(212, 175, 55, 0.15)',
                                paddingVertical: 4,
                            }}
                        >
                            <TouchableOpacity
                                onPress={() => {
                                    setIsOpen(false);
                                    signOut();
                                }}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 12,
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                }}
                                activeOpacity={0.7}
                            >
                                <LogOut size={16} color="rgba(239, 68, 68, 0.7)" />
                                <Text style={{ color: 'rgba(239, 68, 68, 0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                                    Sair
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
};
