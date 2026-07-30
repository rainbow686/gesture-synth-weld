// Environment configuration

/** Whether to enable external scripts on this deployment. Controlled by VITE_ENABLE_EXTERNAL_SCRIPTS env. */
export const ENABLE_EXTERNAL_SCRIPTS = import.meta.env.VITE_ENABLE_EXTERNAL_SCRIPTS === 'true';

// External script publisher ID (replace with your real ID after approval)
export const EXTERNAL_SCRIPT_CLIENT_ID = 'ca-pub-XXXXXXXXXXXXXXXX';
