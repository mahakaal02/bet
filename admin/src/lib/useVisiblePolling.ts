import { useEffect, useRef, type DependencyList } from 'react';

/**
 * Run `callback` immediately, then repeatedly on an interval — but ONLY
 * while the browser tab is visible.
 *
 * These admin dashboards previously polled unconditionally (every
 * 2–15 s), so a tab left open in a background window kept firing API
 * requests forever. This hook tears the interval down when the tab is
 * hidden (`document.visibilityState === 'hidden'`) and, when it returns
 * to the foreground, refreshes once immediately and resumes polling — so
 * a returning operator sees fresh data with no extra wait, and an idle
 * background tab costs the backend nothing.
 *
 * `callback` is kept in a ref so passing a fresh inline closure each
 * render does NOT resubscribe the interval (which would reset the timer).
 * Pass `deps` to force a resubscribe + immediate refresh when a value the
 * callback closes over changes (e.g. an `hours` filter).
 */
export function useVisiblePolling(
  callback: () => void,
  intervalMs: number,
  deps: DependencyList = [],
): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const run = () => savedCallback.current();

    const start = () => {
      if (id === null) id = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        run(); // refresh immediately on return to the foreground
        start();
      }
    };

    run(); // initial load (and re-load whenever deps change)
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
