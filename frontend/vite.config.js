import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Pinned: the Google OAuth redirect URIs and API CORS_ORIGIN both name this port.
	server: { port: 7777, strictPort: true },
	preview: { port: 7777, strictPort: true },
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// SPA mode: auth is a client-held token, so there is nothing to render server-side.
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
