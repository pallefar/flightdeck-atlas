import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while React hydrates the server HTML, true once the component renders
 * in the browser. State that comes from browser storage or the URL is read
 * after this turns true, so the hydrated markup matches the server's.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
