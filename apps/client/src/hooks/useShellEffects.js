import { useCallback, useEffect, useState } from 'react';
import { shell } from '@shell';

const effectsApi = shell.effects;

/**
 * The host's "Reduce effects" switch as `{ reduced, onChange }`, or null when
 * the shell does not offer one (the default shell has no animated background).
 * The setting is applied to the document, stored, and followed across tabs.
 */
export default function useShellEffects() {
  const [reduced, setReduced] = useState(() => (effectsApi ? effectsApi.read() : false));

  useEffect(() => {
    effectsApi?.apply(reduced);
  }, [reduced]);

  useEffect(() => {
    if (!effectsApi) return undefined;
    const handleStorage = (event) => {
      if (event.key === null || event.key === effectsApi.storageKey) setReduced(effectsApi.read());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const onChange = useCallback((next) => {
    if (effectsApi) setReduced(effectsApi.store(next));
  }, []);

  return effectsApi ? { reduced, onChange } : null;
}
