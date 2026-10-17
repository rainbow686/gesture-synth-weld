// Environment configuration

/** Whether to enable external scripts on this deployment. Controlled by VITE_ENABLE_EXTERNAL_SCRIPTS env. */
export const ENABLE_EXTERNAL_SCRIPTS = import.meta.env.VITE_ENABLE_EXTERNAL_SCRIPTS === 'true';

// AdSense publisher ID (approved 2026-09-11)
export const EXTERNAL_SCRIPT_CLIENT_ID = 'ca-pub-4516753695428109';

/**
 * Affiliate card on the loading screen. OFF until tomorrow's funnel data
 * proves the loading window is long enough (non-cached share + duration).
 * Flip to true and fill AFFILIATE_CARD_URL after registering (Soundtrap/
 * BandLab/Splice).
 */
export const ENABLE_AFFILIATE_CARD = false;
export const AFFILIATE_CARD_URL = 'https://www.soundtrap.com/';

/* ─── Pro (hosted build) link ─────────────────────────────────────────
 *
 * The free site advertises the hosted Pro build but never gates anything.
 * This repo carries the public URL and neutral feature wording only —
 * no pricing, plans or commercial terms (see docs/bridge/contract.md).
 * The same URL is written out literally in the static pages
 * (index.html, gesture-synth.html, public/*.html), which Vite does not
 * process; keep them in sync when this changes. */

/** Hosted Pro build (root URL — the site routes from there). */
export const PRO_URL = 'https://gesturesynthweld.app/';

/** Campaign tag for outbound links from the free site. */
export const PRO_UTM_CAMPAIGN = 'wave-2026-10';

/** Outbound Pro link tagged with the surface that produced the click. */
export function proUrl(content: string): string {
  const url = new URL(PRO_URL);
  url.searchParams.set('utm_source', 'free-site');
  url.searchParams.set('utm_medium', 'in-app');
  url.searchParams.set('utm_campaign', PRO_UTM_CAMPAIGN);
  url.searchParams.set('utm_content', content);
  return url.toString();
}
