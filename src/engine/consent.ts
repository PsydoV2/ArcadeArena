/** Einwilligung in die Besucherstatistik (Umami). Ohne Zustimmung wird kein Skript geladen. */

const KEY = 'arcade-arena:analytics-consent';
const UMAMI_SRC = 'https://umami.sfalter.de/recorder.js';
const UMAMI_ID = 'fd0a8fa5-e7be-4a75-ad12-d2fbfc30c350';

export type Consent = 'granted' | 'denied';

export function getConsent(): Consent | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function setConsent(value: Consent) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Speicher gesperrt: Entscheidung gilt dann nur für diesen Seitenaufruf
  }
  if (value === 'granted') loadAnalytics();
}

/** Bindet das Umami-Skript ein, aber nur mit Zustimmung und nur einmal. */
export function loadAnalytics() {
  if (document.querySelector(`script[src="${UMAMI_SRC}"]`)) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = UMAMI_SRC;
  script.dataset.websiteId = UMAMI_ID;
  document.head.append(script);
}

/** Lädt die Statistik, falls der Besucher schon zugestimmt hat. */
export function loadAnalyticsIfGranted() {
  if (getConsent() === 'granted') loadAnalytics();
}

/** Zeigt den Hinweis am unteren Rand, bis der Besucher sich entschieden hat. */
export function initConsentBanner(banner: HTMLElement, reopen: Iterable<HTMLElement> = []) {
  const show = () => {
    banner.hidden = false;
    banner.querySelector<HTMLButtonElement>('[data-consent="granted"]')?.focus({ preventScroll: true });
  };
  banner.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-consent]');
    if (!button) return;
    setConsent(button.dataset.consent as Consent);
    banner.hidden = true;
  });
  for (const button of reopen) button.addEventListener('click', show);

  const consent = getConsent();
  if (consent === 'granted') loadAnalytics();
  else if (consent === null) banner.hidden = false;
}
