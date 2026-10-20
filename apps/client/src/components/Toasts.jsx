// Transient confirmation messages ("Added Longsword to your inventory"): one hook that holds them and
// one stack that shows them, so the workspace and the Homebrew page confirm things the same way.
//
// The stack's live region is always in the page (a region that appears with its first message is
// often not read out). Each message can be dismissed, waits while the pointer is over it, and one
// that holds something the reader needs to keep (a file name) can stay until it is dismissed.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const schedule = useCallback(
    (id, ms) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  // `ms` keeps a longer message up long enough to read; `sticky` keeps it until it is dismissed.
  const notify = useCallback(
    (message, { ms = 2800, sticky = false } = {}) => {
      const id = ++nextId.current;
      setToasts((current) => [...current.slice(-3), { id, message, ms, sticky }]);
      if (!sticky) schedule(id, ms);
    },
    [schedule],
  );

  // The pointer resting on a message holds it; leaving gives it its full time again.
  const hold = useCallback((id) => {
    window.clearTimeout(timers.current.get(id));
  }, []);
  const release = useCallback(
    (toast) => {
      if (!toast.sticky) schedule(toast.id, toast.ms);
    },
    [schedule],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, notify, dismiss, hold, release };
}

export function ToastStack({ toasts, dismiss, hold, release }) {
  return (
    <div className="fcb-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="fcb-toast"
          onMouseEnter={hold ? () => hold(toast.id) : undefined}
          onMouseLeave={release ? () => release(toast) : undefined}
        >
          <span className="fcb-toast-message">{toast.message}</span>
          {dismiss && (
            <button type="button" className="fcb-toast-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(toast.id)}>
              <Icon name="close" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
