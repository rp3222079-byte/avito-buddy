import { useEffect, useState } from 'react';

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, initial?: T) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initial !== undefined && attempt === 0) return;
    const controller = new AbortController();
    load(controller.signal).then(
      result => { if (!controller.signal.aborted) setItems(result); },
      (failure: Error) => { if (!controller.signal.aborted) setError(failure.message); },
    );
    return () => controller.abort();
  }, [load, initial, attempt]);
  function retry() {
    setError('');
    setAttempt(value => value + 1);
  }
  function replace(value: T) {
    setItems(value);
    setError('');
  }
  return { items, error, retry, replace };
}
