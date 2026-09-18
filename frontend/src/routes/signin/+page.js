import { redirect } from '@sveltejs/kit';
import { getSession } from '$lib/session.js';

export function load() {
	if (getSession()) redirect(307, '/');
}
