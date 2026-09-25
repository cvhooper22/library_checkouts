<script>
	import { tick } from 'svelte';
	import { HALF_HOURS, formatMinutes, timeZones } from '$lib/calendar.js';

	/**
	 * The Set up page’s calendar section: the household's Google Calendar reminder. Anyone can
	 * see it; only the member who connected can change or disconnect it (it's their Google
	 * account), so everyone else gets the same facts read-only.
	 * @type {{
	 *   calendar: import('$lib/calendar.js').CalendarStatus | null,
	 *   readOnly?: boolean,
	 *   notice?: string | null,
	 *   onConnect: () => Promise<string | null>,
	 *   onSave: (changes: { reminderTime?: number, timeZone?: string, showTitles?: boolean }) => Promise<string | null>,
	 *   onDisconnect: (deleteCalendar: boolean) => Promise<string | null>
	 * }}
	 */
	let { calendar, readOnly = false, notice = null, onConnect, onSave, onDisconnect } = $props();

	const id = $props.id();

	let connecting = $state(false);
	let saving = $state(false);
	/** @type {string | null} */
	let error = $state(null);

	let confirming = $state(false);
	let deleteCalendar = $state(false);
	let disconnecting = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	const canChange = $derived(Boolean(calendar?.isYou) && !readOnly);
	const who = $derived(calendar?.isYou ? 'you' : calendar?.connectedBy);

	async function connect() {
		if (connecting) return;
		connecting = true;
		error = null;
		// On success the browser leaves for Google, so `connecting` only resets on failure.
		error = await onConnect();
		if (error) connecting = false;
	}

	/**
	 * Each control saves as soon as it changes. On failure the control goes back to the saved
	 * value, since the page's data (and so `calendar`) never changed.
	 * @param {Event & { currentTarget: HTMLSelectElement | HTMLInputElement }} e
	 * @param {{ reminderTime?: number, timeZone?: string, showTitles?: boolean }} changes
	 */
	async function save(e, changes) {
		const control = e.currentTarget;
		saving = true;
		error = null;
		try {
			error = await onSave(changes);
			if (error && calendar) {
				if (control instanceof HTMLInputElement) control.checked = calendar.showTitles;
				else control.value = String('reminderTime' in changes ? calendar.reminderTime : calendar.timeZone);
			}
		} finally {
			saving = false;
		}
	}

	async function askDisconnect() {
		error = null;
		deleteCalendar = false;
		confirming = true;
		await tick();
		// land on the safe choice, so a stray Enter keeps the connection
		/** @type {HTMLElement | null | undefined} */ (root?.querySelector('.confirm .keep'))?.focus();
	}

	function keep() {
		if (disconnecting) return;
		confirming = false;
	}

	async function disconnect() {
		if (disconnecting) return;
		disconnecting = true;
		error = null;
		try {
			error = await onDisconnect(deleteCalendar);
			if (!error) confirming = false;
		} finally {
			disconnecting = false;
		}
	}

	/** @param {string} iso */
	function syncedAt(iso) {
		return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	}

	/** @param {import('$lib/calendar.js').CalendarStatus} c */
	function statusLine(c) {
		if (!c.enabled) return 'Connection expired';
		if (c.lastError) return 'Last sync failed';
		if (c.lastSyncedAt) return `Synced ${syncedAt(c.lastSyncedAt)}`;
		return 'Waiting for its first sync';
	}
</script>

<section class="calendar" aria-labelledby="{id}-title" bind:this={root}>
	<div class="cal-head">
		<h2 class="cal-title" id="{id}-title">Due-date reminders</h2>
		<span class="cal-meta">Google Calendar</span>
	</div>

	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}

	{#if !calendar}
		<p class="lede">
			One reminder on a Google Calendar the morning your next books are due, and each morning
			they’re overdue.
		</p>
		<div class="actions">
			<button class="file" type="button" onclick={connect} disabled={connecting || readOnly}>
				{connecting ? 'Opening Google…' : 'Connect Google Calendar'}
			</button>
		</div>
		<p class="fine">
			{#if readOnly}
				The demo household can’t connect a calendar
			{:else}
				Google will warn that this app isn’t verified yet — it’s in testing. It can only reach the
				one calendar it makes, “Library Due Dates”.
			{/if}
		</p>
	{:else}
		<p class="status" class:failed={!calendar.enabled || calendar.lastError}>
			{statusLine(calendar)} · Connected by {who}
		</p>

		{#if calendar.lastError}
			<p class="error" role="alert">{calendar.lastError}</p>
		{/if}

		{#if !calendar.enabled}
			<div class="actions">
				{#if canChange}
					<button class="file" type="button" onclick={connect} disabled={connecting}>
						{connecting ? 'Opening Google…' : 'Reconnect'}
					</button>
				{:else}
					<p class="fine">Ask {calendar.connectedBy} to reconnect it</p>
				{/if}
			</div>
		{/if}

		{#if canChange}
			<div class="fields">
				<div class="field">
					<select
						id="{id}-time"
						value={calendar.reminderTime}
						disabled={saving}
						onchange={(e) => save(e, { reminderTime: Number(e.currentTarget.value) })}
					>
						{#each HALF_HOURS as minutes (minutes)}
							<option value={minutes}>{formatMinutes(minutes)}</option>
						{/each}
					</select>
					<label for="{id}-time">Reminder time</label>
				</div>
				<div class="field zone">
					<select
						id="{id}-zone"
						value={calendar.timeZone}
						disabled={saving}
						onchange={(e) => save(e, { timeZone: e.currentTarget.value })}
					>
						{#each timeZones(calendar.timeZone) as zone (zone)}
							<option value={zone}>{zone.replace(/_/g, ' ')}</option>
						{/each}
					</select>
					<label for="{id}-zone">Time zone</label>
				</div>
				<div class="field check">
					<label class="box">
						<input
							type="checkbox"
							checked={calendar.showTitles}
							disabled={saving}
							onchange={(e) => save(e, { showTitles: e.currentTarget.checked })}
						/>
						Show book titles
					</label>
					<span class="hint">Off lists only whose books are due</span>
				</div>
			</div>

			{#if confirming}
				<!-- Escape is a shortcut; "Keep it" is the accessible way out -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="confirm"
					role="group"
					aria-label="Confirm disconnecting Google Calendar"
					onkeydown={(e) => e.key === 'Escape' && keep()}
				>
					<p class="confirm-msg">Disconnect Google Calendar? Reminders stop and this app loses access.</p>
					<label class="box">
						<input type="checkbox" bind:checked={deleteCalendar} disabled={disconnecting} />
						Also delete the “Library Due Dates” calendar
					</label>
					<div class="confirm-actions">
						<button class="file destroy" type="button" onclick={disconnect} disabled={disconnecting}>
							{disconnecting ? 'Disconnecting…' : 'Disconnect'}
						</button>
						<button class="cancel keep" type="button" onclick={keep} disabled={disconnecting}>
							Keep it
						</button>
					</div>
				</div>
			{:else}
				<button class="link" type="button" onclick={askDisconnect}>Disconnect</button>
			{/if}
		{:else}
			<dl class="facts">
				<div><dt>Reminder time</dt><dd>{formatMinutes(calendar.reminderTime)}</dd></div>
				<div><dt>Time zone</dt><dd>{calendar.timeZone.replace(/_/g, ' ')}</dd></div>
				<div><dt>Book titles</dt><dd>{calendar.showTitles ? 'Shown' : 'Hidden'}</dd></div>
			</dl>
		{/if}
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<style>
	.calendar {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--dd-space-4);
		padding: var(--dd-space-6) var(--dd-gutter);
		border-bottom: 1px solid var(--dd-rule-strong);
	}

	.cal-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--dd-space-5);
		width: 100%;
	}

	.cal-title {
		margin: 0;
		font: 600 var(--dd-text-title) / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-title);
		text-transform: uppercase;
	}

	.cal-meta,
	.status,
	.fine,
	.hint,
	label,
	dt {
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.lede,
	.notice {
		margin: 0;
		max-width: 60ch;
		font-size: var(--dd-text-input);
		line-height: 1.45;
	}

	.notice {
		padding-left: var(--dd-space-4);
		border-left: 3px solid var(--dd-stamp);
	}

	.fine,
	.status {
		margin: 0;
		line-height: 1.5;
	}

	.status.failed {
		color: var(--dd-stamp-overdue);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--dd-space-6);
		padding-block: var(--dd-space-2);
	}

	/* ---------- settings ---------- */
	.fields {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--dd-space-5) var(--dd-space-7);
		width: 100%;
	}

	.field {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.field.zone {
		flex: 1 1 220px;
	}

	.field label {
		margin-top: var(--dd-space-1);
	}

	select {
		max-width: 100%;
		margin: 0;
		padding: 0 0 var(--dd-space-1);
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		border-radius: 0;
		background: transparent;
		font: var(--dd-text-input) / 1.3 var(--dd-font-text);
		color: var(--dd-ink);
		cursor: pointer;
	}

	select:focus {
		outline: none;
		padding-bottom: calc(var(--dd-space-1) - 1px);
		border-bottom: 2px solid var(--dd-stamp);
	}

	select:disabled,
	input:disabled {
		opacity: 0.6;
	}

	.box {
		display: inline-flex;
		align-items: center;
		gap: var(--dd-space-3);
		color: var(--dd-ink);
		cursor: pointer;
	}

	.box input {
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: var(--dd-stamp);
	}

	.hint {
		margin-top: var(--dd-space-1);
		font-weight: 600;
		letter-spacing: var(--dd-track-caption);
		text-transform: none;
	}

	/* read-only: the same three facts, as printed entries */
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dd-space-5) var(--dd-space-7);
		margin: 0;
	}

	.facts dd {
		margin: 0 0 var(--dd-space-1);
		padding-bottom: var(--dd-space-1);
		border-bottom: 1px solid var(--dd-rule);
		font: var(--dd-text-input) / 1.3 var(--dd-font-text);
	}

	.facts div {
		display: flex;
		flex-direction: column-reverse;
	}

	/* ---------- disconnect ---------- */
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dd-space-4) var(--dd-space-6);
		padding: var(--dd-space-5) var(--dd-gutter);
		margin-inline: calc(-1 * var(--dd-gutter));
		width: calc(100% + 2 * var(--dd-gutter));
		border-top: 1px solid var(--dd-rule-soft);
		background: var(--dd-panel);
	}

	.confirm-msg {
		flex: 1 1 100%;
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		line-height: 1.5;
		text-transform: uppercase;
		color: var(--dd-ink);
	}

	.confirm .box {
		flex: 1 1 100%;
	}

	.confirm-actions {
		display: flex;
		align-items: center;
		gap: var(--dd-space-6);
	}

	/* ---------- buttons: the register's stamp and links ---------- */
	.file {
		padding: var(--dd-space-4) 22px;
		border: var(--dd-border-action);
		border-radius: var(--dd-radius-button);
		background: transparent;
		color: var(--dd-stamp);
		font: 600 15px / 1.2 var(--dd-font-display);
		letter-spacing: 0.22em;
		text-transform: uppercase;
		cursor: pointer;
		opacity: 0.82;
		transform: rotate(var(--dd-action-tilt));
	}

	.file:hover:not(:disabled) {
		opacity: 1;
		background: var(--dd-stamp-wash);
	}

	.file:disabled {
		cursor: progress;
		opacity: 0.5;
	}

	.confirm .file {
		padding: var(--dd-space-3) 16px;
		font-size: 13px;
	}

	.destroy {
		border: var(--dd-border-danger);
		color: var(--dd-danger);
		opacity: 1;
	}

	.destroy:hover:not(:disabled) {
		background: var(--dd-danger-wash);
	}

	.destroy:focus-visible {
		outline-color: var(--dd-danger);
	}

	.cancel,
	.link {
		padding: 0 0 2px;
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		background: none;
		font: 700 var(--dd-text-meta) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		color: var(--dd-ink-borrower);
		cursor: pointer;
	}

	.link {
		color: var(--dd-stamp-overdue);
	}

	.cancel:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.error {
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--dd-stamp-overdue);
	}

	:is(.file, .cancel, .link, select, .box input):focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}
</style>
