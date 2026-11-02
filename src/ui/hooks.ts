import React from 'react';

/**
 * False on the first frame, true right after. Screens render their header and a skeleton immediately, then the heavy
 * list — so a tap switches screens without waiting for hundreds of rows.
 */
export function useAfterFirstFrame() {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setTimeout(() => setReady(true), 0));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

/** First `page` items, growing by `page` each time the list nears its end ("load more" for virtualized lists). */
export function usePaged<T>(items: T[], page = 100) {
  const [count, setCount] = React.useState(page);
  React.useEffect(() => setCount(page), [items, page]);
  return { shown: items.slice(0, count), more: () => setCount(n => (n < items.length ? n + page : n)) };
}
