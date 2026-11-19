// Environment configuration

/** Whether to enable external scripts on this deployment. Controlled by VITE_ENABLE_EXTERNAL_SCRIPTS env. */
export const ENABLE_EXTERNAL_SCRIPTS = import.meta.env.VITE_ENABLE_EXTERNAL_SCRIPTS === 'true';

// AdSense publisher ID (approved 2026-09-11)
export const EXTERNAL_SCRIPT_CLIENT_ID = 'ca-pub-4516753695428109';

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

/* ─── Affiliate (Beatport Group programme) ────────────────────────────
 *
 * Plugin Boutique / Beatport / DJcity. The id below is a public credit tag,
 * not a secret — the same `a_aid` also appears literally in the static
 * content pages, which this file does not reach. A fork must replace it, or
 * its visitors' clicks will credit this project (see README). */

/** Affiliate destination for the landing-screen line. */
export const AFFILIATE_URL = 'https://www.pluginboutique.com/?a_aid=iw3298ya3o9h5';
