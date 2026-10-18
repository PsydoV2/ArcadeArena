import '../landing/landing.css';
import './legal.css';
import { initConsentBanner } from '../engine/consent';
import { registerServiceWorker } from '../engine/pwa';

/** Impressum und Datenschutz: nur Text, dazu der Statistik-Hinweis wie auf der Startseite. */

registerServiceWorker();
initConsentBanner(
  document.querySelector<HTMLElement>('[data-consent-banner]')!,
  document.querySelectorAll<HTMLElement>('[data-consent-open]'),
);
