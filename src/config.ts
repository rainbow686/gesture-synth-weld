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
