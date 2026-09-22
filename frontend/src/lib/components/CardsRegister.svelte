<script>
	import { onMount, tick } from 'svelte';
	import { pad2 } from '$lib/checkouts.js';
	import CatalogTabs from './CatalogTabs.svelte';
	import LibraryPicker from './LibraryPicker.svelte';
	import PaperCard from './PaperCard.svelte';
	import RevealToggle from './RevealToggle.svelte';

	/**
	 * @type {{
	 *   accounts: import('$lib/cards.js').CardAccount[],
	 *   libraries: import('$lib/cards.js').Library[],
	 *   householdName: string,
	 *   readOnly?: boolean,
	 *   startOpen?: boolean,
	 *   error?: string | null,
	 *   onAdd: (card: import('$lib/cards.js').NewCard) => Promise<boolean>,
	 *   onRemove: (accountId: string) => Promise<string | null>,
	 *   onRenameHousehold: (name: string) => Promise<string | null>,
	 *   onCheckouts: () => void
	 * }}
	 */
	let {
		accounts,
		libraries,
		householdName,
		readOnly = false,
		startOpen = false,
		error = null,
		onAdd,
		onRemove,
		onRenameHousehold,
		onCheckouts
	} = $props();

	const id = $props.id();

	let adding = $state(false);
	let filing = $state(false);
	let libraryId = $state('');
	let cardNumber = $state('');
	let pin = $state('');
	let showPin = $state(false);
	let displayName = $state('');
	/** @type {HTMLFormElement | undefined} */
	let form = $state();
	/** @type {HTMLElement | undefined} */
	let root = $state();
	// Removing is two steps: × opens a confirmation under that row, and only its button calls the API.
	/** @type {string | null} */
	let confirmingId = $state(null);
	let removing = $state(false);
	/** @type {string | null} */
	let removeError = $state(null);

	// Renaming the household: a name field that opens into an inline form, like the "add a card" line.
	let editingName = $state(false);
	let nameInput = $state('');
	let savingName = $state(false);
	/** @type {string | null} */
	let nameError = $state(null);

	const tabs = [
		{ id: 'checkouts', label: 'Checkouts' },
		{ id: 'cards', label: 'Set up', end: true }
	];

	async function openForm() {
		if (readOnly) return;
		adding = true;
		libraryId ||= libraries[0]?.id ?? '';
		await tick();
		form?.querySelector('button')?.focus();
	}

	function closeForm() {
		adding = false;
		cardNumber = pin = displayName = '';
		showPin = false;
	}

	function startEditName() {
		if (readOnly) return;
		nameInput = householdName;
		nameError = null;
		editingName = true;
	}

	function cancelEditName() {
		if (savingName) return;
		editingName = false;
		nameError = null;
	}

	/** @param {SubmitEvent} e */
	async function saveName(e) {
		e.preventDefault();
		const trimmed = nameInput.trim();
		if (!trimmed || savingName) return;
		savingName = true;
		nameError = null;
		try {
			const err = await onRenameHousehold(trimmed);
			if (err) nameError = err;
			else editingName = false;
		} finally {
			savingName = false;
		}
	}

	onMount(() => {
		if (startOpen) openForm();
	});

	/** @param {SubmitEvent} e */
	async function file(e) {
		e.preventDefault();
		if (filing || !libraryId) return;
		filing = true;
		try {
			const ok = await onAdd({
				libraryId,
				cardNumber: cardNumber.trim(),
				pin,
				displayName: displayName.trim()
			});
			if (ok) closeForm();
		} finally {
			filing = false;
		}
	}

	/** @param {string} accountId */
	async function askRemove(accountId) {
		removeError = null;
		confirmingId = accountId;
		await tick();
		// land on the safe choice, so a stray Enter keeps the card
		/** @type {HTMLElement | null | undefined} */ (root?.querySelector('.confirm .keep'))?.focus();
	}

	function keep() {
		if (removing) return;
		confirmingId = null;
		removeError = null;
	}

	/** @param {string} accountId */
	async function remove(accountId) {
		if (removing) return;
		removing = true;
		removeError = null;
		try {
			removeError = await onRemove(accountId);
			if (!removeError) {
				confirmingId = null;
				await tick();
				// the row is gone; put focus somewhere sensible instead of on <body>
				/** @type {HTMLElement | null | undefined} */ (root?.querySelector('.add-btn'))?.focus();
			}
		} finally {
			removing = false;
		}
	}

	/** @param {string | null} status */
	function statusOf(status) {
		if (status === 'success') return { label: 'Active', failed: false };
		if (status === 'failed') return { label: 'Last pull failed', failed: true };
		return { label: 'Not yet pulled', failed: false };
	}
</script>

<section class="register" bind:this={root}>
	<CatalogTabs
		{tabs}
		selected="cards"
		onselect={(t) => t === 'checkouts' && onCheckouts()}
		label="Household"
	/>

	<PaperCard>
		<header class="head">
			<div>
				<h1 class="title">Register of Borrower’s Cards</h1>
				<p class="sub">Household library account — Cards {pad2(accounts.length)}</p>
			</div>
			<span class="form-no">Form<br />2·B</span>
		</header>

		<div class="household">
			{#if editingName}
				<form class="household-form" onsubmit={saveName}>
					<div class="field">
						<input
							id="{id}-household-name"
							type="text"
							bind:value={nameInput}
							autocomplete="off"
							required
							disabled={savingName}
						/>
						<label for="{id}-household-name">Household name</label>
					</div>
					<div class="household-actions">
						<button class="file" type="submit" disabled={savingName || !nameInput.trim()}>
							{savingName ? 'Saving…' : 'Save'}
						</button>
						<button class="cancel" type="button" onclick={cancelEditName} disabled={savingName}>
							Cancel
						</button>
					</div>
					{#if nameError}
						<p class="error" role="alert">{nameError}</p>
					{/if}
				</form>
			{:else}
				<div class="field">
					<div class="field-row">
						<div class="field-value">{householdName}</div>
						{#if !readOnly}
							<button class="link rename" type="button" onclick={startEditName}>Rename</button>
						{/if}
					</div>
					<div class="field-label">Household name</div>
				</div>
			{/if}
		</div>

		<div class="grid">
			<div class="row colheads" aria-hidden="true">
				<div class="cell">Library</div>
				<div class="cell">Card number</div>
				<div class="cell">PIN</div>
				<div class="cell">Borrower</div>
			</div>

			<ul class="cards">
				{#each accounts as a (a.id)}
					{@const st = statusOf(a.lastStatus)}
					<li class="row filed">
						<div class="cell c-lib">
							<div class="lib-name">{a.library.name}</div>
							<div class="status" class:failed={st.failed}>{st.label}</div>
						</div>
						<!-- Credentials are encrypted and never returned; the dots only say "on file". -->
						<div class="cell c-num on-file"><span aria-hidden="true">•••• •••• ••••</span><span class="sr">Card number on file</span></div>
						<div class="cell c-pin on-file"><span aria-hidden="true">••••</span><span class="sr">PIN on file</span></div>
						<div class="cell c-who">
							<span class="who">{a.displayName}</span>
							{#if !readOnly}
								<button
									class="x"
									type="button"
									aria-label="Remove {a.displayName}’s card at {a.library.name}"
									aria-expanded={confirmingId === a.id}
									onclick={() => askRemove(a.id)}
								>
									×
								</button>
							{/if}
						</div>

						{#if confirmingId === a.id}
							<!-- Escape is a shortcut; "Keep it" is the accessible way out -->
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<div
								class="confirm"
								role="group"
								aria-label="Confirm removing {a.displayName}’s card"
								onkeydown={(e) => e.key === 'Escape' && keep()}
							>
								<p class="confirm-msg">
									Remove {a.displayName}’s card at {a.library.name}? It will stop being pulled.
								</p>
								<div class="confirm-actions">
									<button class="file destroy" type="button" onclick={() => remove(a.id)} disabled={removing}>
										{removing ? 'Removing…' : 'Remove card'}
									</button>
									<button class="cancel keep" type="button" onclick={keep} disabled={removing}>
										Keep it
									</button>
								</div>
								{#if removeError}
									<p class="error" role="alert">{removeError}</p>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if adding}
				<!-- Escape is a shortcut; Cancel is the accessible way out -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<form
					class="row add"
					bind:this={form}
					onsubmit={file}
					onkeydown={(e) => e.key === 'Escape' && !e.defaultPrevented && closeForm()}
				>
					<div class="cell c-lib">
						<LibraryPicker
							{libraries}
							value={libraryId}
							onchange={(v) => (libraryId = v)}
							disabled={filing}
						/>
						<span class="lbl" aria-hidden="true">Library</span>
					</div>
					<div class="cell c-num">
						<input
							id="{id}-num"
							class="num"
							type="text"
							bind:value={cardNumber}
							placeholder="0000 0000 0000"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							required
							disabled={filing}
						/>
						<label class="lbl" for="{id}-num">Card number</label>
					</div>
					<div class="cell c-pin">
						<div class="pw">
							<input
								id="{id}-pin"
								class="pin"
								type={showPin ? 'text' : 'password'}
								bind:value={pin}
								placeholder="••••"
								autocomplete="off"
								autocapitalize="off"
								spellcheck="false"
								required
								disabled={filing}
							/>
							<RevealToggle bind:revealed={showPin} label="PIN" disabled={filing} />
						</div>
						<label class="lbl" for="{id}-pin">PIN</label>
					</div>
					<div class="cell c-who">
						<input
							id="{id}-who"
							type="text"
							bind:value={displayName}
							placeholder="Mira"
							autocomplete="off"
							required
							disabled={filing}
						/>
						<label class="lbl" for="{id}-who">Borrower</label>
					</div>

					<div class="actions">
						<button class="file" type="submit" disabled={filing || !libraryId}>
							{filing ? 'Filing…' : 'File this card'}
						</button>
						<button class="cancel" type="button" onclick={closeForm} disabled={filing}>Cancel</button>
						{#if error}
							<p class="error" role="alert">{error}</p>
						{/if}
					</div>
				</form>
			{:else}
				<div class="row open">
					<div class="cell c-lib">
						<button class="add-btn" type="button" onclick={openForm} disabled={readOnly}>
							+ Add a card
						</button>
					</div>
					<div class="cell c-num" aria-hidden="true"><span class="dash"></span></div>
					<div class="cell c-pin" aria-hidden="true"><span class="dash"></span></div>
					<div class="cell c-who" aria-hidden="true"><span class="dash"></span></div>
				</div>
			{/if}
		</div>

		<footer class="foot">
			<p class="foot-note">
				{#if readOnly}
					The demo register is read-only
				{:else if adding}
					Press File this card to enter it in the register
				{:else}
					The next ruled line is always open for a new card
				{/if}
			</p>
			<button class="link" type="button" onclick={onCheckouts}>Checkouts →</button>
		</footer>
	</PaperCard>
</section>

<style>
	.register {
		--cols: minmax(0, 1.3fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.1fr);
		width: 100%;
		max-width: 760px;
		font-family: var(--dd-font-text);
		color: var(--dd-ink);
	}

	/* ---------- head ---------- */
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--dd-space-5);
		padding: var(--dd-space-6) var(--dd-gutter) var(--dd-space-6);
	}

	.title {
		margin: 0;
		font: 600 30px / 1.15 var(--dd-font-display);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.sub {
		margin: var(--dd-space-4) 0 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.form-no {
		flex: none;
		font: 600 17px / 1.15 var(--dd-font-display);
		letter-spacing: 0.05em;
		text-align: right;
		text-transform: uppercase;
		color: var(--dd-ink-call);
	}

	/* ---------- household name ---------- */
	.household {
		padding: 0 var(--dd-gutter) var(--dd-space-6);
	}

	.household .field-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--dd-space-4) var(--dd-space-6);
	}

	.household .field-value {
		flex: 1;
		min-width: 0;
		padding-bottom: var(--dd-space-1);
		border-bottom: 1px solid var(--dd-rule);
		font: 600 var(--dd-text-title) / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-title);
		color: var(--dd-ink);
	}

	.household .rename {
		flex: none;
	}

	.household .field-label {
		margin-top: var(--dd-space-1);
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.household-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--dd-space-5) var(--dd-space-6);
		width: 100%;
	}

	.household-form .field {
		flex: 1 1 220px;
		min-width: 0;
	}

	.household-form input {
		display: block;
		width: 100%;
		margin: 0;
		padding: 0 0 var(--dd-space-1);
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		border-radius: 0;
		background: transparent;
		font: var(--dd-text-input) / 1.3 var(--dd-font-text);
		color: var(--dd-ink);
	}

	.household-form input:focus {
		outline: none;
		padding-bottom: calc(var(--dd-space-1) - 1px);
		border-bottom: 2px solid var(--dd-stamp);
	}

	.household-form input:disabled {
		opacity: 0.6;
	}

	.household-form label {
		display: block;
		margin-top: var(--dd-space-1);
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.household-actions {
		display: flex;
		align-items: center;
		gap: var(--dd-space-5);
		flex: none;
	}

	/* ---------- the ruled register ---------- */
	.grid {
		border-top: 1px solid var(--dd-rule-strong);
		border-bottom: 1px solid var(--dd-rule-strong);
	}

	.cards {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: grid;
		grid-template-columns: var(--cols);
	}

	.cards > .row,
	.cards + .row {
		border-top: 1px solid var(--dd-rule-strong);
	}

	.cell {
		position: relative;
		min-width: 0;
		padding: var(--dd-space-5) var(--dd-gutter);
	}

	.cell + .cell {
		border-left: 1px solid var(--dd-rule-strong);
	}

	.colheads {
		background: var(--dd-panel-head);
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.colheads .cell {
		padding-block: var(--dd-space-4);
	}

	/* filed cards */
	.filed .cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-height: 64px;
	}

	.lib-name {
		font: 600 19px / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-title);
	}

	.status {
		margin-top: var(--dd-space-2);
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.status.failed {
		color: var(--dd-stamp-overdue);
	}

	.on-file {
		font: 600 21px / 1 var(--dd-font-display);
		letter-spacing: 0.12em;
		color: var(--dd-stamp);
	}

	.c-pin.on-file {
		color: var(--dd-ink);
	}

	.c-who {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-borrower);
	}

	.filed .c-who {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: var(--dd-space-3);
	}

	.x {
		flex: none;
		width: 32px;
		height: 32px;
		margin: -6px -8px -6px 0;
		padding: 0;
		border: none;
		background: none;
		font: 400 20px / 1 var(--dd-font-text);
		color: var(--dd-stamp-overdue);
		opacity: 0.6;
		cursor: pointer;
	}

	.x:hover,
	.x[aria-expanded='true'] {
		opacity: 1;
	}

	/* the confirmation sits on its own ruled line directly under the card being removed */
	.confirm {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dd-space-4) var(--dd-space-6);
		padding: var(--dd-space-5) var(--dd-gutter);
		border-top: 1px solid var(--dd-rule-soft);
		background: var(--dd-panel);
	}

	.confirm-msg {
		flex: 1 1 260px;
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		line-height: 1.5;
		text-transform: uppercase;
		color: var(--dd-ink);
	}

	.confirm-actions {
		display: flex;
		align-items: center;
		gap: var(--dd-space-6);
	}

	.confirm .file {
		padding: var(--dd-space-3) 16px;
		font-size: 13px;
	}

	/* destructive action: the same stamp button on the danger tokens, at full strength */
	.confirm .destroy {
		border: var(--dd-border-danger);
		color: var(--dd-danger);
		opacity: 1;
	}

	.confirm .destroy:hover:not(:disabled) {
		background: var(--dd-danger-wash);
	}

	.confirm .destroy:disabled {
		opacity: 0.5;
	}

	.confirm .destroy:focus-visible {
		outline-color: var(--dd-danger);
	}

	/* ---------- the open line ---------- */
	.add-btn {
		display: block;
		width: 100%;
		min-height: var(--dd-row-min-h);
		margin: 0;
		padding: 0;
		border: none;
		background: none;
		font: 600 16px / 1.2 var(--dd-font-display);
		letter-spacing: 0.22em;
		text-align: left;
		text-transform: uppercase;
		color: var(--dd-stamp);
		cursor: pointer;
	}

	.add-btn:hover:not(:disabled) {
		text-decoration: underline;
		text-underline-offset: 4px;
	}

	.add-btn:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.open .cell {
		display: flex;
		align-items: center;
	}

	.dash {
		flex: 1;
		border-top: 1px dashed var(--dd-rule-strong);
	}

	/* the line being written on: violet spine on the left, like a marked-up register line */
	.add {
		border-left: 3px solid var(--dd-stamp);
	}

	.add .cell {
		padding-top: var(--dd-space-6);
		padding-bottom: var(--dd-space-4);
	}

	.add input {
		display: block;
		width: 100%;
		margin: 0;
		padding: 0 0 var(--dd-space-1);
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		border-radius: 0;
		background: transparent;
		font: var(--dd-text-input) / 1.3 var(--dd-font-text);
		color: var(--dd-ink);
	}

	.add input::placeholder {
		color: var(--dd-ink-muted);
		opacity: 0.75;
	}

	.add input:focus {
		outline: none;
		padding-bottom: calc(var(--dd-space-1) - 1px);
		border-bottom: 2px solid var(--dd-stamp);
	}

	.add input:disabled {
		opacity: 0.6;
	}

	.add input.num {
		font: 600 21px / 1.2 var(--dd-font-display);
		letter-spacing: 0.1em;
		color: var(--dd-stamp);
	}

	.add input.pin {
		padding-right: 28px; /* clear of the eyeball */
		letter-spacing: 0.2em;
	}

	.pw {
		position: relative;
	}

	/* printed labels: the column heads do this job on wide screens, so hide them visually there */
	.lbl {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.actions {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dd-space-6);
		padding: var(--dd-space-2) var(--dd-gutter) var(--dd-space-6);
	}

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
		flex: none;
		color: var(--dd-stamp);
	}

	.cancel:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.error {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--dd-stamp-overdue);
	}

	/* ---------- footer ---------- */
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--dd-space-5);
		padding: var(--dd-space-5) var(--dd-gutter) var(--dd-space-6);
	}

	.foot-note {
		margin: 0;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	:is(.add-btn, .file, .cancel, .link, .x):focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}

	/* ---------- narrow: the columns stack, and the printed labels come back ---------- */
	@media (max-width: 600px) {
		.register {
			--cols: 3fr 2fr;
			--dd-gutter: 16px;
		}

		.title {
			font-size: 23px;
		}

		.colheads {
			display: none;
		}

		.c-lib,
		.c-who {
			grid-column: 1 / -1;
		}

		.cell + .cell {
			border-left: none;
		}

		.cell.c-pin {
			border-left: 1px solid var(--dd-rule-strong);
		}

		.add input.num {
			font-size: 18px;
			letter-spacing: 0.06em;
		}

		/* filed cards read as library + borrower; the "on file" dots would only add noise */
		.filed .on-file {
			display: none;
		}

		.filed .c-who {
			padding-top: 0;
			min-height: 0;
		}

		.filed .c-lib {
			padding-bottom: var(--dd-space-2);
		}

		.open .c-num,
		.open .c-pin,
		.open .c-who {
			display: none;
		}

		.add .cell {
			padding-top: var(--dd-space-5);
			padding-bottom: var(--dd-space-3);
		}

		.add .c-num,
		.add .c-pin,
		.add .c-who {
			border-top: 1px solid var(--dd-rule-soft);
		}

		.lbl {
			position: static;
			display: block;
			width: auto;
			height: auto;
			margin-top: var(--dd-space-1);
			overflow: visible;
			clip-path: none;
			white-space: normal;
			font-size: var(--dd-text-label);
			font-weight: 700;
			letter-spacing: var(--dd-track-label);
			text-transform: uppercase;
			color: var(--dd-ink-label);
		}

		.foot {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
