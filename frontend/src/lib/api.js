import { API_URL } from './config.js';

export class ApiError extends Error {
	/**
	 * @param {number} status  HTTP status, or 0 if the server couldn't be reached
	 * @param {string} message
	 */
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/**
 * JSON request against the Express API. Errors from the API arrive as `{ error }`.
 * @param {string} path
 * @param {{ method?: string, token?: string, body?: unknown }} [opts]
 */
export async function api(path, { method = 'GET', token, body } = {}) {
	/** @type {Record<string, string>} */
	const headers = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	let res;
	try {
		res = await fetch(`${API_URL}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new ApiError(0, 'Could not reach the server');
	}

	const data = await res.json().catch(() => null);
	if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
	return data;
}
