/** Meldet den Service Worker an (nur im Build, damit der Dev-Server nicht aus dem Cache liefert). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
