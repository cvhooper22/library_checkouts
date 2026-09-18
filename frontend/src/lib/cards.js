/**
 * @typedef {{ id: string, slug: string, name: string }} Library
 *   One element of `libraries` in GET /libraries.
 * @typedef {{ id: string, displayName: string, lastStatus: string | null, library: Library }} CardAccount
 *   One element of `accounts` in GET /households/:id/accounts.
 * @typedef {{ libraryId: string, cardNumber: string, pin: string, displayName: string }} NewCard
 */
export {};
