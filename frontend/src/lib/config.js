/** Base URL of the Express API (api/). Set VITE_API_URL at build time; see .env.example. */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * OAuth 2.0 Client ID from Google Cloud Console — must be the same one the API's
 * GOOGLE_CLIENT_ID checks the audience against. Unset until VITE_GOOGLE_CLIENT_ID is
 * set at build time; see .env.example.
 */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
