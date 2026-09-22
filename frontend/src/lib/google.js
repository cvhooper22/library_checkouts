import { GOOGLE_CLIENT_ID } from './config.js';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/** @type {Promise<void> | null} */
let scriptPromise = null;

// Loaded once per page and cached: a second sign-in attempt reuses the same <script>
// tag and the google.accounts.id global it defines, instead of injecting it again.
function loadScript() {
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = SCRIPT_SRC;
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('Could not load Google Sign-In'));
		document.head.appendChild(script);
	});
	return scriptPromise;
}

/**
 * Runs Google's One Tap credential flow and resolves with the ID token to send to
 * POST /auth/google. Rejects if VITE_GOOGLE_CLIENT_ID isn't set, the script fails to
 * load, or Google declines to show a prompt (e.g. the browser blocks third-party
 * sign-in, or the user dismissed One Tap recently and Google is cooling down).
 * @returns {Promise<string>}
 */
export async function signInWithGoogle() {
	if (!GOOGLE_CLIENT_ID) {
		throw new Error('Google sign-in is not configured for this deployment.');
	}

	await loadScript();

	// The GIS script defines this global; there's no first-party type package for it.
	const google = /** @type {any} */ (window).google;

	return new Promise((resolve, reject) => {
		google.accounts.id.initialize({
			client_id: GOOGLE_CLIENT_ID,
			callback: (/** @type {{ credential: string }} */ response) => resolve(response.credential),
			// Silent-only failures (auto_select skipped, no session, etc.) still get a real UI
			// on request when the user clicks a button, so drop the FedCM "keep quiet" behavior.
			use_fedcm_for_prompt: true
		});

		google.accounts.id.prompt((/** @type {any} */ notification) => {
			if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
				reject(
					new Error(
						`Google sign-in isn't available right now (${notification.getNotDisplayedReason?.() || notification.getSkippedReason?.() || 'no prompt shown'}). Try email instead.`
					)
				);
			}
		});
	});
}
