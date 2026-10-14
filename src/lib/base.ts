/** Base path the app is served from (e.g. "/" or "/gridview-app/"). */
export const BASE = import.meta.env.BASE_URL;
export const LOGO = `${BASE}logo.png`;
/** Absolute URL of the app, used for auth email redirects. */
export const APP_URL = new URL(BASE, window.location.origin).toString();
/** Marketing website (switch to https://gridviewuasservices.com later via VITE_WEBSITE_URL). */
export const WEBSITE_URL: string = import.meta.env.VITE_WEBSITE_URL || 'https://gridviewuas.netlify.app';
export const WEBSITE_LABEL = 'gridviewuasservices.com';
