import React from 'react';
import { View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';

/**
 * A small colored dot indicating network status.
 * Green = online, Red = offline.
 * Place next to screen titles.
 */
export const NetworkStatusDot: React.FC<{ size?: number }> = ({ size = 8 }) => {
    const netInfo = useNetInfo();
    const isOnline = netInfo.isConnected && netInfo.isInternetReachable !== false;

    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: isOnline ? '#22c55e' : '#ef4444',
                marginLeft: 8,
                shadowColor: isOnline ? '#22c55e' : '#ef4444',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6,
                shadowRadius: 3,
                elevation: 3,
            }}
        />
    );
};
