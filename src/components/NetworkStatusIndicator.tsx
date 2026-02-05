import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { Wifi, WifiOff } from 'lucide-react-native';
import NetInfo from '@react-native-community/netinfo';
import { theme } from '../theme';

export const NetworkStatusIndicator = () => {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener(state => {
            setIsOnline(!!state.isConnected && !!state.isInternetReachable);
        });
        return () => unsubscribe();
    }, []);

    // Design: A small floating indicator or a fixed top bar?
    // User mentioned "icon in the form".
    // Let's make it a small absolute positioned indicator at the top right, or just under the status bar.
    // Given it's "global", a top bar might push content down.
    // Let's try a safe area compatible top right indicator.

    return (
        <View style={{
            position: 'absolute',
            top: 40, // Adjust for status bar 
            right: 16,
            zIndex: 9999,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'
        }}>
            {isOnline ? (
                <Wifi size={14} color="#10b981" />
            ) : (
                <WifiOff size={14} color="#ef4444" />
            )}
            <Text style={{
                fontSize: 10,
                color: isOnline ? '#10b981' : '#ef4444',
                marginLeft: 4,
                fontWeight: '700'
            }}>
                {isOnline ? 'Online' : 'Offline'}
            </Text>
        </View>
    );
};
