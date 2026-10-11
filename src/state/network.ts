import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

type NetworkState = {
  /** null until the first NetInfo reading arrives. */
  online: boolean | null;
};

export const useNetworkStatus = create<NetworkState>(() => ({ online: null }));

/** Subscribe once at app start. Returns an unsubscribe function. */
export function startNetworkMonitor(): () => void {
  return NetInfo.addEventListener((state) => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    if (useNetworkStatus.getState().online !== online) useNetworkStatus.setState({ online });
  });
}
