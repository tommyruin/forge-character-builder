import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { fastStartActivityFor } from '../fastStartActivity.js';

const READY_NOTICE_MS = 6000;
const ERROR_NOTICE_MS = 9000;
const MIN_BUILDING_NOTICE_MS = 1200;

export default function FastStartActivityNotice({
  fastStart = api.fastStart,
}) {
  const [activity, setActivity] = useState(null);
  const observedBuilding = useRef(false);
  const buildingShownAt = useRef(null);
  const dismissTimer = useRef(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;

    const clearDismissTimer = () => {
      if (dismissTimer.current != null) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };

    const refresh = async () => {
      const sequence = ++requestSequence.current;
      try {
        const status = await fastStart?.status?.();
        if (!active || sequence !== requestSequence.current) return;
        const nextActivity = fastStartActivityFor(
          status,
          observedBuilding.current,
        );
        if (nextActivity?.kind === 'building') {
          observedBuilding.current = true;
          buildingShownAt.current ??= Date.now();
          clearDismissTimer();
          setActivity(nextActivity);
          return;
        }
        if (!observedBuilding.current) {
          setActivity(null);
          return;
        }
        observedBuilding.current = false;
        clearDismissTimer();
        const showTerminalActivity = () => {
          if (!active) return;
          buildingShownAt.current = null;
          setActivity(nextActivity);
          if (nextActivity) {
            dismissTimer.current = setTimeout(
              () => setActivity(null),
              nextActivity.kind === 'error'
                ? ERROR_NOTICE_MS
                : READY_NOTICE_MS,
            );
          }
        };
        const buildingElapsed =
          buildingShownAt.current == null
            ? MIN_BUILDING_NOTICE_MS
            : Date.now() - buildingShownAt.current;
        const remainingBuildingTime = Math.max(
          0,
          MIN_BUILDING_NOTICE_MS - buildingElapsed,
        );
        if (remainingBuildingTime > 0) {
          dismissTimer.current = setTimeout(
            showTerminalActivity,
            remainingBuildingTime,
          );
        } else {
          showTerminalActivity();
        }
      } catch {
        // A notification must never interfere with normal engine operation.
      }
    };

    void refresh();
    const unsubscribe = fastStart?.subscribe?.(() => void refresh());
    return () => {
      active = false;
      requestSequence.current += 1;
      clearDismissTimer();
      unsubscribe?.();
    };
  }, [fastStart]);

  if (!activity) return null;

  return (
    <div
      aria-atomic="true"
      aria-busy={activity.kind === 'building'}
      aria-live="polite"
      className="fcb-toast-stack fcb-fast-start-notice-stack"
      role="status"
    >
      <div
        className={`fcb-toast fcb-fast-start-notice is-${activity.kind}`}
      >
        <span className="fcb-fast-start-notice-dot" aria-hidden="true" />
        <span>{activity.message}</span>
      </div>
    </div>
  );
}
