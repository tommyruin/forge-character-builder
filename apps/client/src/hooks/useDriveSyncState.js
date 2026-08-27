import { useEffect, useSyncExternalStore } from 'react';
import { driveSyncService } from '../cloud/driveSyncService.js';

export function useDriveSyncState(service = driveSyncService) {
  const state = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot
  );

  useEffect(() => {
    void service.hydrate();
  }, [service]);

  return {
    ...state,
    connect: service.connect,
    disconnect: service.disconnect,
    sync: service.sync,
  };
}
