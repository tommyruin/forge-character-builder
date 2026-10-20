// Transient confirmation messages ("Added Longsword to your inventory"): one hook that holds them and
// one stack that shows them, so the workspace and the Homebrew page confirm things the same way.
import { useCallback, useRef, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  // `ms` keeps a longer message up long enough to read.
  const notify = useCallback((message, { ms = 2800 } = {}) => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-3), { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, ms);
  }, []);
  return { toasts, notify };
}

export function ToastStack({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fcb-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="fcb-toast">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
