/** Base URL of the Express API (api/). Set VITE_API_URL at build time; see .env.example. */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
