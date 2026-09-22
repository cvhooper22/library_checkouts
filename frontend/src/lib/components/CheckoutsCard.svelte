<script>
	import { dueState, kpiInk, stampVars, styleVars } from '$lib/styles/tokens.js';
	import { bucketOf, pad2, pulledLabel } from '$lib/checkouts.js';
	import { canReload, refreshLabel } from '$lib/refresh.js';
	import CatalogTabs from './CatalogTabs.svelte';
	import PaperCard from './PaperCard.svelte';

	const ALL = 'all'; // tab id for "every account"; account ids are UUIDs so can't collide

	/**
	 * @type {{
	 *   items?: import('$lib/checkouts.js').CheckoutItem[],
	 *   accounts?: import('$lib/checkouts.js').AccountTab[],
	 *   selected?: string,
	 *   householdName?: string,
	 *   holder?: string,
	 *   holderFor?: (account: import('$lib/checkouts.js').AccountTab) => string,
	 *   updatedAt?: Date | null,
	 *   refresh?: import('$lib/refresh.js').RefreshPhase,
	 *   onRefresh?: (accountId: string | null) => void,
	 *   onReload?: () => void,
	 *   onSignOut?: () => void,
	 *   onManageCards?: () => void,
	 *   now?: Date
	 * }}
	 */
	let {
		items = [],
		accounts = [],
		selected = $bindable(ALL),
		householdName = 'Household, The',
		holder,
		holderFor,
		updatedAt = null,
		refresh = 'idle',
		onRefresh,
		onReload,
		onSignOut,
		onManageCards,
		now = new Date()
	} = $props();

	const BUCKETS = /** @type {const} */ ([
		{ key: 'overdue', label: 'Overdue' },
		{ key: 'week', label: 'This week' },
		{ key: 'later', label: 'Later' }
	]);

	const rows = $derived(
		items
			.filter((i) => selected === ALL || i.accountId === selected)
			.map((i) => ({ ...i, state: dueState(i.due, now) }))
			.sort((a, b) => a.state.days - b.state.days)
	);

	const kpis = $derived(
		BUCKETS.map((b) => ({
			...b,
			n: rows.filter((r) => bucketOf(r.state.days) === b.key).length
		}))
	);

	// Tabs come from the checkouts themselves, so a reload after returning a card's last book drops
	// its tab; fall back to "All" rather than filtering by an id that no longer has a tab.
	$effect(() => {
		if (selected !== ALL && !accounts.some((a) => a.id === selected)) selected = ALL;
	});

	const selectedAccount = $derived(accounts.find((a) => a.id === selected));
	const selectedName = $derived(selectedAccount?.name);
	// The card belongs to whoever's tab is open; the household's holder line is for "All".
	const shownHolder = $derived(selectedAccount && holderFor ? holderFor(selectedAccount) : holder);
	// "Set up" isn't a filter: it leaves for the register, so `selected` never becomes it.
	const CARDS = 'cards';
	const tabs = $derived([
		{ id: ALL, label: 'All' },
		...accounts.map((a) => ({ id: a.id, label: a.name })),
		...(onManageCards ? [{ id: CARDS, label: 'Set up', end: true }] : [])
	]);

	/** @param {string} id */
	function selectTab(id) {
		if (id === CARDS) onManageCards?.();
		else selected = id;
	}

	// One button, two jobs: it starts a pull, and once a pull has landed it becomes the reload.
	const reloadable = $derived(canReload(refresh));
	const action = $derived(reloadable ? onReload : onRefresh);

	function pressAction() {
		if (reloadable) onReload?.();
		else onRefresh?.(selected === ALL ? null : selected);
	}
</script>

<section class="checkouts">
	<CatalogTabs {tabs} {selected} onselect={selectTab} label="Library accounts" />

	<PaperCard>
		<header class="head">
			<div class="head-top">
				<span class="num">№{pad2(rows.length)}</span>
				{#if shownHolder}
					<div class="holder">
						<div class="holder-label">Card holder</div>
						<div class="holder-name">{shownHolder}</div>
						<button class="return" onclick={onSignOut}>Sign Out →</button>
					</div>
				{/if}
			</div>

			<div class="field lead">
				<div class="field-value">{householdName}</div>
				<div class="field-label">Accounts — {accounts.length} cards</div>
			</div>

			<div class="field">
				<div class="field-value">
					{selectedName ? `${selectedName}’s checkouts` : 'All checkouts, soonest due first'}
				</div>
				<div class="field-label">Title</div>
			</div>

			<div class="kpis">
				{#each kpis as k (k.key)}
					<div class="kpi" class:alert={k.key === 'overdue' && k.n > 0}>
						<div class="kpi-n" style:color={kpiInk(k.key, k.n)}>{pad2(k.n)}</div>
						<div class="kpi-label">{k.label}</div>
					</div>
				{/each}
				<div class="kpi total">
					<div class="kpi-n" style:color={kpiInk('total', rows.length)}>{pad2(rows.length)}</div>
					<div class="kpi-label">Total out</div>
				</div>
			</div>
		</header>

		<div class="ledger">
			<div class="ledger-head">
				<div class="colhead">Date due</div>
				<div class="colhead">Title &amp; borrower</div>
			</div>

			{#each rows as r (r.id)}
				<div class="row">
					<div class="row-date">
						<span
							class="stamp"
							style={styleVars(stampVars(r.title))}
							style:color={r.state.stampInk}
						>
							{r.state.stamp}
						</span>
					</div>
					<div class="row-body">
						<div class="row-text">
							<div class="row-title">{r.title}</div>
							<div class="row-borrower">{r.borrower}</div>
						</div>
						<div class="row-rel" style:color={r.state.tone}>{r.state.rel}</div>
					</div>
				</div>
			{:else}
				<div class="empty">Nothing checked out</div>
			{/each}
		</div>

		<footer class="foot">
			<div class="foot-meta">
				<span class="seal" aria-hidden="true">LC</span>
				<span class="updated" aria-live="polite">
					{refreshLabel(refresh) ?? pulledLabel(updatedAt, now)}
				</span>
			</div>
			<button class="refresh" onclick={pressAction} disabled={refresh === 'running' || !action}>
				{reloadable ? 'Reload' : 'Re-stamp'}
			</button>
		</footer>
	</PaperCard>
</section>

<style>
	.checkouts {
		width: 100%;
		max-width: var(--dd-card-width);
		font-family: var(--dd-font-text);
		color: var(--dd-ink);
	}

	/* ---------- head ---------- */
	.head {
		padding: var(--dd-space-5) var(--dd-gutter) 10px;
	}

	.head-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		font: 600 var(--dd-text-cardno) / 1.2 var(--dd-font-display);
		letter-spacing: 0.05em;
	}

	.num {
		font-variant-numeric: tabular-nums;
	}

	/* library-card holder box; sign-out is "returning" the card */
	.holder {
		padding: 10px var(--dd-space-4) 8px;
		border: 1px solid var(--dd-rule-box);
		background: var(--dd-panel);
		text-align: right;
	}

	.holder-label {
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.holder-name {
		margin-top: var(--dd-space-2);
		font: 600 15px / 1.2 var(--dd-font-display);
		letter-spacing: 0.05em;
		color: var(--dd-ink);
	}

	.return {
		margin-top: var(--dd-space-3);
		padding: 0 0 1px;
		border: none;
		border-bottom: 1px solid var(--dd-rule-input);
		background: none;
		font: 700 var(--dd-text-caption) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		color: var(--dd-stamp);
		cursor: pointer;
	}

	/* a filled-in field on a printed form: value on a rule, label beneath */
	.field {
		margin-top: var(--dd-space-4);
	}

	.field.lead {
		margin-top: 14px;
	}

	.field-value {
		padding-bottom: var(--dd-space-1);
		border-bottom: 1px solid var(--dd-rule);
		font-size: var(--dd-text-subject);
		letter-spacing: -0.1px;
		color: var(--dd-ink-soft);
	}

	.lead .field-value {
		font-size: var(--dd-text-title);
		font-weight: 600;
		letter-spacing: var(--dd-track-title);
		color: var(--dd-ink);
	}

	.field-label,
	.colhead {
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	.field-label {
		margin-top: var(--dd-space-1);
	}

	/* ---------- KPI band ---------- */
	.kpis {
		display: grid;
		grid-template-columns: repeat(3, 1fr) auto;
		gap: 10px;
		align-items: end;
		margin-top: 18px;
		padding: 10px var(--dd-space-4) 9px;
		border: 1px solid var(--dd-rule-box);
		background: var(--dd-panel);
	}

	.kpi {
		padding-bottom: var(--dd-space-2);
		border-bottom: 1.5px solid var(--dd-rule-faint);
	}

	.kpi.alert {
		border-bottom-color: var(--dd-rule-alert);
	}

	.kpi.total {
		padding-left: 10px;
		border-bottom: none;
		border-left: 1px solid var(--dd-rule-box);
		text-align: right;
	}

	.kpi-n {
		font: 600 var(--dd-text-kpi) / 1 var(--dd-font-display);
		font-variant-numeric: tabular-nums;
	}

	.kpi-label {
		margin-top: var(--dd-space-2);
		font-size: var(--dd-text-label-sm);
		font-weight: 700;
		letter-spacing: var(--dd-track-kpi);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	/* ---------- ledger ---------- */
	.ledger {
		margin-top: 14px;
		border-top: 1px solid var(--dd-rule-strong);
		border-bottom: 1px solid var(--dd-rule-strong);
	}

	.ledger-head,
	.row {
		display: grid;
		grid-template-columns: var(--dd-date-col) 1fr;
	}

	.ledger-head {
		background: var(--dd-panel-head);
	}

	.colhead {
		padding: 7px 0 7px var(--dd-gutter);
	}

	.colhead + .colhead {
		padding: 7px var(--dd-gutter) 7px var(--dd-space-4);
		border-left: 1px solid var(--dd-rule-strong);
	}

	.row {
		min-height: var(--dd-row-min-h);
		border-top: 1px solid var(--dd-rule-soft);
	}

	.row-date {
		display: flex;
		align-items: center;
		padding-left: var(--dd-gutter);
	}

	.stamp {
		display: inline-block;
		font: 600 var(--dd-text-stamp) / 1 var(--dd-font-display);
		letter-spacing: var(--dd-track-display);
		font-variant-numeric: tabular-nums;
		text-transform: uppercase;
		opacity: var(--dd-stamp-wear);
		transform: rotate(var(--dd-stamp-rotate));
	}

	.row-body {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
		padding: var(--dd-space-3) var(--dd-gutter) var(--dd-space-3) var(--dd-space-4);
		border-left: 1px solid var(--dd-rule-strong);
	}

	.row-text {
		min-width: 0;
	}

	.row-title {
		font: 600 var(--dd-text-row) / 1.2 var(--dd-font-text);
		letter-spacing: var(--dd-track-title);
		color: var(--dd-ink);
		text-wrap: pretty;
	}

	.row-borrower {
		margin-top: var(--dd-space-1);
		font-size: var(--dd-text-caption);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		color: var(--dd-ink-borrower);
	}

	.row-rel {
		flex: none;
		font-size: var(--dd-text-meta);
		font-weight: 700;
		letter-spacing: 0.05em;
		font-variant-numeric: tabular-nums;
	}

	.empty {
		padding: var(--dd-space-5) var(--dd-gutter);
		border-top: 1px solid var(--dd-rule-soft);
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-label);
		text-transform: uppercase;
		color: var(--dd-ink-label);
	}

	/* ---------- footer ---------- */
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--dd-space-4);
		padding: var(--dd-space-4) var(--dd-gutter) var(--dd-space-6);
	}

	.foot-meta {
		display: flex;
		align-items: center;
		gap: 9px;
	}

	.seal {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 19px;
		height: 19px;
		border: 1px solid var(--dd-rule-mark);
		border-radius: 50%;
		font-size: var(--dd-text-label-sm);
		font-weight: 700;
		color: var(--dd-ink-label);
	}

	.updated {
		font-size: var(--dd-text-label);
		font-weight: 700;
		letter-spacing: var(--dd-track-caption);
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
		color: var(--dd-ink-label);
	}

	.refresh {
		flex: none;
		padding: var(--dd-space-3) 13px;
		border: var(--dd-border-action);
		border-radius: var(--dd-radius-button);
		background: transparent;
		color: var(--dd-stamp);
		font: 600 11.5px / 1.2 var(--dd-font-display);
		letter-spacing: var(--dd-track-action);
		text-transform: uppercase;
		cursor: pointer;
		opacity: 0.82;
		transform: rotate(var(--dd-action-tilt));
	}

	.refresh:hover:not(:disabled) {
		opacity: 1;
		background: var(--dd-stamp-wash);
	}

	.refresh:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.return:focus-visible,
	.refresh:focus-visible {
		outline: 2px solid var(--dd-stamp);
		outline-offset: 2px;
	}

	/* The per-row --dd-stamp-rotate is set inline, so tokens.css's :root reduced-motion
	   override can't reach it; flatten the stamp here. */
	@media (prefers-reduced-motion: reduce) {
		.stamp {
			transform: none;
		}
	}

	/* ---------- narrow phones: override tokens, not rules ---------- */
	@media (max-width: 380px) {
		.checkouts {
			--dd-gutter: 14px;
			--dd-date-col: 88px;
			--dd-text-stamp: 17px;
			--dd-text-kpi: 23px;
		}

		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}

		.kpi.total {
			padding-left: 0;
			border-left: none;
			text-align: left;
		}
	}
</style>
