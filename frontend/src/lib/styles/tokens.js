// Date Due — tokens for logic (Svelte)
// Styling should read the CSS custom properties from tokens.css.
// These exports exist for the handful of values JS must compute:
// stamp jitter, due-state tone, and any canvas/chart color.

export const color = {
  paper: 'var(--dd-paper)',
  page: 'var(--dd-page)',
  surface: 'var(--dd-surface)',
  ink: 'var(--dd-ink)',
  inkLabel: 'var(--dd-ink-label)',
  inkBorrower: 'var(--dd-ink-borrower)',
  inkMuted: 'var(--dd-ink-muted)',
  stamp: 'var(--dd-stamp)',
  stampOverdue: 'var(--dd-stamp-overdue)',
  alert: 'var(--dd-alert)'
};

// Raw hexes — only for canvas, meta theme-color, or exports where var() can't reach.
export const raw = {
  paper: '#EFE3C6',
  paperTab: '#E2D4B4',
  page: '#EDE6D8',
  surface: '#FFFDF8',
  ink: '#26221C',
  inkApp: '#1C1A17',
  inkLabel: '#5A7391',
  inkBorrower: '#6B5C3F',
  inkMuted: '#6E675C',
  inkLink: '#8A6A2F',
  stamp: '#2F2A63',
  stampOverdue: '#8E241A',
  alert: '#B3261E',
  kpiWeek: '#A2701A',
  kpiLater: '#A9B4BF',
  kpiZero: '#B9A99A'
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Deterministic per-row stamp character. Spread onto the stamp element's style.
 * @param {string | number} seed
 */
export function stampVars(seed) {
  const h = typeof seed === 'string'
    ? seed.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
    : Number(seed) || 0;
  return {
    '--dd-stamp-rotate': `${((h % 5) - 2) * 0.9}deg`,
    '--dd-stamp-wear': (0.62 + (h % 4) * 0.09).toFixed(2)
  };
}

/**
 * `style` string for Svelte: style={styleVars(stampVars(title))}
 * @param {Record<string, string | number>} o
 */
export const styleVars = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

/**
 * Due date → the row's state, label, and which ink prints it.
 * @param {string} due  ISO date, YYYY-MM-DD
 * @param {Date} [today]
 */
export function dueState(due, today = new Date()) {
  const d = new Date(`${due}T00:00:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((d.getTime() - t.getTime()) / 86400000);
  const overdue = days < 0;
  const rel =
    days < -1 ? `${Math.abs(days)}d late` :
    days === -1 ? '1d late' :
    days === 0 ? 'Today' :
    days === 1 ? 'Tomorrow' : `in ${days}d`;
  return {
    days, overdue, rel,
    date: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
    stamp: `${MONTHS[d.getMonth()]} ${d.getDate()}`.toUpperCase(),
    tone: overdue ? 'var(--dd-alert)' : 'var(--dd-ink-app)',
    stampInk: overdue ? 'var(--dd-stamp-overdue)' : 'var(--dd-stamp)'
  };
}

/**
 * KPI numeral color by bucket + count.
 * @param {'total' | 'overdue' | 'week' | 'later'} bucket
 * @param {number} n
 */
export function kpiInk(bucket, n) {
  if (bucket === 'total') return 'var(--dd-kpi-total)';
  if (n === 0) return 'var(--dd-kpi-zero)';
  if (bucket === 'overdue') return 'var(--dd-kpi-overdue)';
  if (bucket === 'week') return 'var(--dd-kpi-week)';
  return 'var(--dd-kpi-later)';
}
