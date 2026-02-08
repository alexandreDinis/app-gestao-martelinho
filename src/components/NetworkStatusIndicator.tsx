import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text, View, Alert } from 'react-native';
import { Wifi, WifiOff, Trash2 } from 'lucide-react-native';
import NetInfo from '@react-native-community/netinfo';
import { theme } from '../theme';
import { OfflineDebug } from '../utils/OfflineDebug';

export const NetworkStatusIndicator = () => {
    const [realOnline, setRealOnline] = useState(true);
    const [forceOffline, setForceOffline] = useState(OfflineDebug.isForceOffline());

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener(state => {
            setRealOnline(!!state.isConnected && !!state.isInternetReachable);
        });
        return () => unsubscribe();
    }, []);

    const toggleOfflineMock = () => {
        const newState = !forceOffline;
        OfflineDebug.setForceOffline(newState);
        setForceOffline(newState);
    };

    const confirmReset = () => {
        Alert.alert(
            "Apagar Dados Locais",
            "Isso removerá todas as OSs e Clientes locais RECENTES (mantendo login). Deseja continuar?",
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Sim, Apagar",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            // Dynamic import to avoid cycles or heavy load
                            const { databaseService } = require('../services/database/DatabaseService');
                            await databaseService.resetDatabase();
                            Alert.alert("Sucesso", "Banco limpo. O app vai tentar recarregar dados.");
                        } catch (err) {
                            Alert.alert("Erro", "Falha ao limpar banco: " + err);
                        }
                    }
                }
            ]
        );
    };

    const isOnline = realOnline && !forceOffline;

    return (
        <View style={{
            position: 'absolute',
            top: 40,
            right: 16,
            zIndex: 9999,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8
        }}>
            {/* Reset Button (Visible only when 'simulated offline' or always? User asked for cleanup tool. Let's make it always visible or accessible via long press? Let's make it visible but discreet) */}
            <TouchableOpacity
                onPress={confirmReset}
                activeOpacity={0.7}
                style={{
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    padding: 6,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.2)'
                }}
            >
                <Trash2 size={12} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
                onPress={toggleOfflineMock}
                activeOpacity={0.7}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.9)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 1)'
                }}
            >
                {isOnline ? (
                    <Wifi size={14} color="#10b981" />
                ) : (
                    <WifiOff size={14} color={forceOffline ? "#ffffff" : "#ef4444"} />
                )}
                <Text style={{
                    fontSize: 10,
                    color: isOnline ? '#10b981' : (forceOffline ? '#ffffff' : '#ef4444'),
                    marginLeft: 4,
                    fontWeight: '700'
                }}>
                    {isOnline ? 'Online' : (forceOffline ? 'Simulado Off' : 'Offline')}
                </Text>
            </TouchableOpacity>
        </View>
    );
};
