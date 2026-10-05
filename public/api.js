// Watchtower API connector — binds backend data to the designer's dashboard markup.
// Loaded after watchtower-ui.js. The UI fires wt:* events and this file does the real API work.

const API_BASE = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  if (res.status === 401) { window.location.href = '/'; throw new Error('Not signed in.'); }
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || ('HTTP ' + res.status));
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

function ordinal(n) { const t = n % 100, o = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : o === 1 ? 'st' : o === 2 ? 'nd' : o === 3 ? 'rd' : 'th'); }

function money(cents) { return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }

// The grace period is the owner's choice — never default it. 0 = the late fee
// applies the day after the due date. Returns null when blank or invalid.
function graceValue(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 90 ? n : null;
}
const GRACE_REQUIRED = 'Choose when the late fee applies: 0 for the day after the due date, or a number of days after it.';

// Fill every [data-bind] element with a mapped value.
function bind(data) {
  document.querySelectorAll('[data-bind]').forEach(el => {
    const key = el.getAttribute('data-bind');
    if (key in data) el.textContent = data[key];
  });
}

// Replace {placeholder} tokens inside a cloned <template> element — including
// the element's own attributes (e.g. data-invoice-id="{row_id}"), which
// innerHTML alone never reaches.
function fillTpl(clone, map) {
  const fill = (s) => s.replace(/\{([a-z_0-9]+)\}/g, (m, k) => (k in map ? map[k] : ''));
  clone.innerHTML = fill(clone.innerHTML);
  Array.from(clone.attributes).forEach(a => { a.value = fill(a.value); });
}

// Render a <template> per item into a [data-list] container.
function renderList(listName, items, mapFn) {
  const container = document.querySelector('[data-list="' + listName + '"]');
  const tpl = document.getElementById('tpl-' + listName);
  if (!container || !tpl) return;
  Array.from(container.children).forEach(c => { if (c !== tpl) c.remove(); });
  items.forEach((item, i) => {
    const clone = tpl.content.firstElementChild.cloneNode(true);
    fillTpl(clone, mapFn(item, i) || {});
    container.appendChild(clone);
  });
  const empty = document.querySelector('[data-empty="' + listName + '"]');
  if (empty) empty.hidden = items.length > 0;
}

function initials(name) {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase();
}

// Whole calendar days from today to the due date: 0 = due today (still not
// late until the day is over), -1 = was due yesterday.
function daysUntilDue(inv, now) {
  const due = new Date(inv.due + 'T00:00:00');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

// ---- Invoice status model (designer §3.3) ----
// pending · due-soon · overdue · fee-applied · paid
function invoiceStatus(inv, now) {
  if (inv.status === 'paid') {
    return { key: 'paid', pill: 'wt-pill--paid', label: 'Paid', dueClass: '', dueText: inv.paidAt ? 'Paid ' + new Date(inv.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Paid' };
  }
  // Cancelled in Stripe — no longer owed, so never "Pending" or "Overdue".
  if (inv.status === 'void' || inv.status === 'uncollectible' || inv.status === 'deleted') {
    const label = inv.status === 'uncollectible' ? 'Uncollectible' : 'Cancelled';
    return { key: 'void', pill: 'wt-pill--pending', label, dueClass: '', dueText: label.toLowerCase() };
  }
  if (inv.feeApplied) {
    return { key: 'fee-applied', pill: 'wt-pill--fee-applied', label: 'Fee applied', dueClass: 'wt-due--late', dueText: '' };
  }
  const days = daysUntilDue(inv, now);
  if (days < 0) {
    return { key: 'overdue', pill: 'wt-pill--overdue', label: 'Overdue', dueClass: 'wt-due--late', dueText: Math.abs(days) + ' days late' };
  }
  if (days <= 7) {
    return { key: 'due-soon', pill: 'wt-pill--due-soon', label: 'Due soon', dueClass: 'wt-due--soon', dueText: days === 0 ? 'due today' : 'in ' + days + ' day' + (days === 1 ? '' : 's') };
  }
  return { key: 'pending', pill: 'wt-pill--pending', label: 'Pending', dueClass: '', dueText: 'in ' + days + ' days' };
}

// ---- Shared: invoices (dashboard + invoices views) ----
let state = { invoices: [], filter: 'all', query: '' };

// Clicking an invoice opens Dunn's own invoice view (a box over the
// dashboard): the facts, a PDF download, and everything that's happened.
// Rows are keyed by number || id. Client text goes in via textContent only.
document.addEventListener('wt:open-invoice', async (e) => {
  const key = e.detail && e.detail.id;
  const row = state.invoices.find(i => (i.stripeNumber || i.id) === key);
  if (!row) return;
  const modal = document.getElementById('wt-invoice-modal');
  const $i = (k) => modal.querySelector('[data-inv="' + k + '"]');
  const put = (k, v) => { $i(k).textContent = v; };
  put('title', 'Invoice ' + (row.stripeNumber || ''));
  put('client', 'Loading…'); put('amount', row.amount); put('due', ''); put('sent', ''); put('fee', '');
  $i('timeline').replaceChildren();
  $i('pdf').hidden = true; $i('copy').hidden = true; $i('cancel').hidden = true; $i('cancel-box').hidden = true;
  const s = invoiceStatus(row, new Date());
  $i('status').className = 'wt-pill wt-pill--dot ' + s.pill; put('status', s.label);
  window.WatchtowerUI.openModal('wt-invoice-modal');

  let d;
  try { d = await api('GET', '/invoices/' + row.id); }
  catch (err) { put('client', "Couldn't load this invoice. " + err.message); return; }

  const day = (iso) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  put('client', [d.client, d.clientEmail].filter(Boolean).join(' · '));
  put('amount', money(d.amountCents + (d.feeStatus === 'open' || d.feeStatus === 'paid' ? (d.feeAmountCents || 0) : 0)));
  put('due', day(d.due));
  put('sent', day(d.createdAt));
  const feeState = { pending: ' · added if still unpaid', open: ' · on the bill', paid: ' · paid', waived: ' · waived' }[d.feeStatus] || '';
  put('fee', d.fee ? d.fee + feeState : 'None');

  const list = $i('timeline');
  if (!d.timeline.length) { const li = document.createElement('li'); li.textContent = 'Nothing yet.'; list.append(li); }
  for (const t of d.timeline) {
    const li = document.createElement('li');
    li.dataset.kind = t.kind;
    li.append(document.createTextNode(t.text));
    const when = document.createElement('span');
    when.className = 'wt-inv__when';
    when.textContent = new Date(t.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    li.append(when);
    if (t.body) { const q = document.createElement('p'); q.className = 'wt-inv__quote'; q.textContent = t.body; li.append(q); }
    list.append(li);
  }

  if (d.pdfUrl) { $i('pdf').href = d.pdfUrl; $i('pdf').hidden = false; }
  // Cancel: only unpaid invoices. Asks first, inside the box.
  if (d.status === 'open') {
    const who = d.client || 'the client';
    $i('cancel').hidden = false;
    $i('cancel').onclick = () => {
      put('cancel-q', 'Cancel invoice ' + (d.number || '') + ' for ' + $i('amount').textContent + '?');
      put('cancel-tell-label', 'Email ' + who + " that they don't need to pay it");
      $i('cancel-tell').checked = !!d.clientEmail; $i('cancel-tell').disabled = !d.clientEmail;
      $i('cancel-err').hidden = true;
      $i('cancel-box').hidden = false; $i('cancel').hidden = true;
      $i('cancel-box').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    $i('cancel-keep').onclick = () => { $i('cancel-box').hidden = true; $i('cancel').hidden = false; };
    $i('cancel-yes').onclick = async () => {
      const yes = $i('cancel-yes');
      yes.disabled = true; yes.textContent = 'Cancelling…';
      try {
        await api('POST', '/invoices/' + d.id + '/cancel', { tellClient: $i('cancel-tell').checked });
        // Refresh the list, then show this invoice again: now "Cancelled",
        // with the cancel (and the client email) in its timeline.
        await loadDashboard();
        document.dispatchEvent(new CustomEvent('wt:open-invoice', { detail: { id: key } }));
      } catch (err) {
        put('cancel-err', err.message); $i('cancel-err').hidden = false;
      } finally {
        yes.disabled = false; yes.textContent = 'Yes, cancel invoice';
      }
    };
  }
  if (d.hostedInvoiceUrl && d.status === 'open') {
    const btn = $i('copy');
    btn.hidden = false;
    btn.textContent = 'Copy payment link';
    btn.onclick = async () => {
      try { await navigator.clipboard.writeText(d.hostedInvoiceUrl); btn.textContent = 'Copied'; }
      catch { btn.textContent = "Couldn't copy"; }
    };
  }
});

function renderInvoices() {
  const now = new Date();
  const list = state.invoices.filter(inv => {
    if (state.filter !== 'all') {
      const s = invoiceStatus(inv, now);
      if (state.filter === 'fee-applied' && s.key !== 'fee-applied') return false;
      if (state.filter !== 'fee-applied' && s.key !== state.filter) return false;
    }
    if (state.query) {
      const hay = ((inv.client || '') + ' ' + (inv.id || '') + ' ' + (inv.stripeNumber || '') + ' ' + (inv.clientEmail || '')).toLowerCase();
      if (!hay.includes(state.query.toLowerCase())) return false;
    }
    return true;
  });
  // The "(8)" next to "Recent invoices" was the designer's sample number.
  document.querySelectorAll('[data-bind="invoice_result_count"]').forEach(el => { el.textContent = String(list.length); });

  renderList('invoices', list, (inv, i) => {
    const s = invoiceStatus(inv, now);
    return {
      id: inv.stripeNumber || inv.id,
      avatar: String((i % 5) + 1),
      initials: initials(inv.client),
      client_name: inv.client || '—',
      client_email: inv.clientEmail || '',
      due_class: s.dueClass,
      due_text: _dueText(inv, s),
      amount_total: inv.amount,
      pill_class: s.pill,
      status_label: s.label,
    };
  });

  // Update the filter counts
  document.querySelectorAll('.wt-filter').forEach(btn => {
    const status = btn.dataset.status;
    const countEl = btn.querySelector('[data-count="' + status + '"]');
    if (!countEl) return;
    const n = state.invoices.filter(inv => {
      const s = invoiceStatus(inv, now);
      return status === 'all' ? true : s.key === status;
    }).length;
    countEl.textContent = String(n);
  });
}

function _dueText(inv, s) {
  if (inv.status === 'paid') return s.dueText;
  const days = daysUntilDue(inv, new Date());
  if (inv.feeApplied) return Math.abs(days) + ' days late';
  return s.dueText;
}

// ---- Dashboard ----
async function loadDashboard() {
  const [invData, reports, settings] = await Promise.all([
    api('GET', '/invoices'),
    api('GET', '/reports/revenue'),
    api('GET', '/settings').catch(() => ({})),
  ]);
  state.invoices = invData.invoices || [];

  // $39 plan: warn at 4 and 5 of 5 clients, before a new client gets blocked.
  const warn = document.querySelector('[data-plan-warning]');
  if (warn && settings.needsPlan) {
    warn.hidden = false;
    warn.replaceChildren(document.createTextNode('Choose a plan to start sending invoices. '));
    const a = document.createElement('a'); a.href = '/dashboard#settings'; a.textContent = 'Pick a plan'; a.style.textDecoration = 'underline'; a.style.color = 'inherit';
    warn.append(a);
  } else if (warn) {
    const used = settings.clientsThisMonth, limit = settings.clientLimit;
    warn.hidden = !(limit && used >= limit - 1);
    if (!warn.hidden) {
      warn.replaceChildren(document.createTextNode(used >= limit
        ? `You've invoiced ${used} ${used > limit ? 'clients this month, more than the ' + limit + ' included' : 'of ' + limit + ' clients this month'}. A new client needs Unlimited. `
        : `You've invoiced ${used} of ${limit} clients this month. One more new client fits. `));
      const a = document.createElement('a'); a.href = '/#pricing'; a.textContent = 'See Unlimited'; a.style.textDecoration = 'underline'; a.style.color = 'inherit';
      warn.append(a);
    }
  }

  const now = new Date();
  const period = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening';
  const bizName = settings.businessName || 'there';

  // Only open invoices are owed (paid, void and uncollectible ones aren't).
  const overdue = state.invoices.filter(i => i.status === 'open' && daysUntilDue(i, now) < 0 && !i.feeApplied);
  const feeApplied = state.invoices.filter(i => i.status === 'open' && i.feeApplied);
  const dueSoon = state.invoices.filter(i => {
    if (i.status !== 'open') return false;
    const days = daysUntilDue(i, now);
    return days >= 0 && days <= 7;
  });
  // Pending: past the fee deadline, waiting on the owner. Billed: on the
  // client's bill, still unpaid — can still be lowered or waived.
  const pendingFees = state.invoices.filter(i => i.status === 'open' && i.feeStatus === 'pending');
  const billedFees = state.invoices.filter(i => i.status === 'open' && i.feeApplied && i.feeStatus === 'open');

  let statusLine;
  if (overdue.length && dueSoon.length) statusLine = overdue.length + ' overdue, ' + dueSoon.length + ' due this week.';
  else if (overdue.length) statusLine = overdue.length + ' overdue, the rest on watch.';
  else if (dueSoon.length) statusLine = dueSoon.length + ' due this week.';
  else statusLine = 'All quiet tonight.';

  const overdueCents = overdue.concat(feeApplied).reduce((s, i) => s + (i.amountCents || 0), 0);
  const sum = reports.summary || {};
  const feesBilled = state.invoices.filter(i => i.feeStatus === 'open').reduce((s, i) => s + (i.feeAmountCents || 0), 0);

  bind({
    today_long: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    greeting: 'Good ' + period + '.',
    status_line: statusLine,
    overdue_count: overdue.length + feeApplied.length,
    overdue_total: money(overdueCents),
    collected_this_month: money(sum.moneyInCents || 0),
    paid_count_this_month: String(sum.invoicesPaid || 0),
    month_short: now.toLocaleDateString('en-US', { month: 'short' }),
    month_long: now.toLocaleDateString('en-US', { month: 'long' }),
    fee_revenue: money(sum.feeRevenueCents || 0),
    fees_collected: money(sum.feeRevenueCents || 0),
    fees_billed: money(feesBilled),
    pending_fees_total: money(pendingFees.reduce((s, i) => s + (i.feeAmountCents || 0), 0)),
    pending_fee_count: pendingFees.length,
    billed_fee_count: billedFees.length,
    owner_name: settings.ownerName || bizName,
    owner_email: settings.ownerEmail || '',
    owner_initials: initials(settings.ownerName || bizName),
  });

  renderInvoices();

  // Shared fields for both fee lists. Amounts in the change box are dollars;
  // the most it can be is the fee in the invoice terms.
  const feeRow = (inv) => ({
    row_id: inv.id,
    invoice_id: inv.stripeNumber || inv.id,
    client_name: inv.client || '—',
    days_late: Math.max(0, -daysUntilDue(inv, new Date())),
    fee_amount: money(inv.feeAmountCents || 0),
    fee_value: ((inv.feeAmountCents || 0) / 100).toFixed(2),
    fee_max: ((inv.feeTermsCents || 0) / 100).toFixed(2),
    fee_terms: money(inv.feeTermsCents || 0),
  });

  renderList('pending_fees', pendingFees, (inv) => Object.assign(feeRow(inv), {
    lands: feeLandsText(inv),
    fee_kind: inv.feeKind === 'percent' ? inv.fee + ' fee' : 'flat fee',
  }));
  renderList('billed_fees', billedFees, (inv) => Object.assign(feeRow(inv), {
    total_due: money((inv.amountCents || 0) + (inv.feeAmountCents || 0)),
  }));

  // Both fee sections render only when they have rows (designer §pending fees).
  const pendingSection = document.querySelector('[data-section="pending_fees"]');
  if (pendingSection) pendingSection.hidden = pendingFees.length === 0;
  const billedSection = document.querySelector('[data-section="billed_fees"]');
  if (billedSection) billedSection.hidden = billedFees.length === 0;
}

// When a coming fee is added: the morning after due date + grace days.
function feeLandsText(inv) {
  const due = new Date(inv.due + 'T12:00:00');
  const lands = new Date(due.getFullYear(), due.getMonth(), due.getDate() + (inv.graceDays || 0) + 1, 12);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((lands - today) / 86400000);
  if (days <= 1) return 'Added tomorrow morning';
  return 'Added ' + lands.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---- Recurring ----
async function loadRecurring() {
  const data = await api('GET', '/templates').catch(() => ({ templates: [] }));
  const templates = data.templates || [];
  bind({ recurring_count: templates.length });

  // A banner per active recurring invoice whose last run failed, with the
  // real reason and retry date. textContent only.
  const fails = document.querySelector('[data-recurring-failures]');
  if (fails) {
    const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    fails.replaceChildren(...templates.filter(t => t.active && t.lastRunAt && !t.lastRunOk).map(t => {
      const box = document.createElement('div'); box.className = 'wt-banner wt-banner--error'; box.setAttribute('role', 'alert');
      const dot = document.createElement('span'); dot.className = 'wt-banner__dot';
      const text = document.createElement('div'); text.className = 'wt-banner__text';
      const title = document.createElement('div'); title.className = 'wt-banner__title';
      title.textContent = t.clientName + "'s invoice couldn't be created on " + day(t.lastRunAt) + '.';
      const why = document.createElement('div');
      why.textContent = (t.lastError || 'Something went wrong.') + ' It stays active and retries ' + (t.nextRunDate ? 'on ' + day(t.nextRunDate) : 'soon') + '.';
      text.append(title, why);
      const plan = /plan/i.test(t.lastError || '');
      const link = document.createElement('a'); link.className = 'wt-btn wt-btn--secondary wt-btn--sm'; link.href = '#settings';
      link.textContent = plan ? 'See your plan' : 'Check Stripe connection';
      box.append(dot, text, link);
      return box;
    }));
  }
  renderList('recurring', templates, (t) => {
    const freq = t.frequency === 'monthly' ? 'Monthly' : t.frequency === 'weekly' ? 'Weekly' : t.frequency === 'biweekly' ? 'Every 2 weeks' : (t.customDay >= 29 ? 'Monthly, last day' : 'Monthly on the ' + ordinal(t.customDay || 1));
    const feeLabel = t.feeKind === 'none' ? 'No late fee' : t.feeKind === 'percent' ? (t.feeAmount + '% late fee') : ('$' + t.feeAmount + ' late fee');
    return {
      id: t.id,
      client_name: t.clientName,
      amount: money(t.amount),
      fee_label: feeLabel,
      frequency_label: freq,
      schedule_sub: t.active ? ('Next ' + new Date(t.nextRunDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })) : 'Paused',
      last_run_date: t.lastRunAt ? new Date(t.lastRunAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'None yet',
      result_class: !t.lastRunAt ? 'wt-result--none' : (t.lastRunOk ? 'wt-result--sent' : 'wt-result--failed'),
      result_label: !t.lastRunAt ? '' : (t.lastRunOk ? 'Sent' : 'Failed, will retry'),
      sent_count: t.sentCount || 0,
      status_label: t.active ? 'Active' : 'Paused',
      status_class: t.active ? 'wt-pill--active' : 'wt-pill--paused',
    };
  });

  // Apply paused dimming to rendered rows (watchtower-ui.js handles the rest).
  document.querySelectorAll('[data-list="recurring"] .wt-recurring__item').forEach(row => {
    const id = row.dataset.id;
    const t = templates.find(x => x.id === id);
    if (t && !t.active) row.classList.add('is-paused');
  });
}

// ---- Clients ----
async function loadClients() {
  const data = await api('GET', '/clients').catch(() => ({ clients: [] }));
  const rows = (data.clients || []).sort((a, b) => b.lateRatio - a.lateRatio);
  renderList('clients', rows, (c, i) => {
    const tone = c.lateRatio >= 50 ? 'high' : c.lateRatio >= 20 ? 'mid' : 'low';
    return {
      avatar: String((i % 5) + 1),
      initials: initials(c.name),
      client_name: c.name,
      client_sub: 'Client since ' + (c.clientSinceYear || '—'),
      late_class: tone,
      late_pct: String(c.lateRatio),
      late_count: c.lateCount,
      invoice_count: c.totalInvoices,
      avg_days_late: c.avgDaysLate,
      fees_paid: money(c.feesPaidCents),
      open_balance: money(c.openBalanceCents),
    };
  });
}

// ---- Reports ----
// The 12-month trend always ends at this month; picking a month (the menu or
// a bar) only changes the breakdown above it.
let reportTrend = null;
async function loadReports(month) {
  const now = new Date();
  const current = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const yyyymm = month || current;
  const get = m => api('GET', '/reports/revenue?month=' + m + '&months=12').catch(() => ({}));
  const data = await get(yyyymm);
  const s = data.summary || {};
  if (yyyymm === current) reportTrend = data.trend || [];
  else if (!reportTrend) reportTrend = (await get(current)).trend || [];
  const trend = reportTrend;
  const at = trend.findIndex(t => t.month === yyyymm);

  // delta vs previous month
  let delta = '';
  if (at >= 1) {
    const cur = trend[at], prev = trend[at - 1];
    if (prev.totalCents > 0) {
      const pct = Math.round((cur.totalCents - prev.totalCents) / prev.totalCents * 100);
      const prevLabel = (prev.label || '').split(' ')[0];
      delta = (pct >= 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '% vs ' + prevLabel;
    }
  }
  const feeShare = s.totalCollectedCents > 0 ? (s.feeRevenueCents / s.totalCollectedCents * 100).toFixed(1) : '0.0';
  const shareNote = (s.feeRevenueCents || 0) > 0 ? ('Late fees were ' + feeShare + '% of what came in.') : 'No late fees this month.';

  // fees collected count for the picked month
  const feeCount = at >= 0 ? trend[at].feeCount || 0 : 0;

  bind({
    invoice_revenue: money(s.moneyInCents || 0),
    fee_revenue: money(s.feeRevenueCents || 0),
    total_collected: money(s.totalCollectedCents || 0),
    delta: delta,
    share_note: shareNote,
    invoices_paid_count: String(s.invoicesPaid || 0),
    fees_collected_count: String(feeCount),
    fees_waived_amount: money(s.feesWaivedCents || 0),
  });

  renderTrend(trend, yyyymm);
  loadWaivers(yyyymm);
}

document.addEventListener('change', e => {
  if (e.target.matches('[data-report-month]')) loadReports(e.target.value);
});
document.addEventListener('click', e => {
  const bar = e.target.closest('.wt-bars [data-month]');
  if (bar) loadReports(bar.dataset.month);
});

// Who you waive fees for: a 12-month strip + clients ranked by fees waived,
// with how often they pay late and the owner's own notes. textContent only.
async function loadWaivers(selectedMonth) {
  const data = await api('GET', '/reports/waivers?months=12').catch(() => null);
  if (!data) return;
  const sel = (data.months || []).find(m => m.month === selectedMonth);
  const o = data.opportunity;
  const opp = document.querySelector('[data-waiver-opp]');
  if (opp) {
    opp.hidden = !(o && o.perMonthCents > 0);
    if (!opp.hidden) {
      const parts = [];
      if (o.waivedCents) parts.push(money(o.waivedCents) + ' waived');
      if (o.noFeeCents) parts.push('about ' + money(o.noFeeCents) + ' on ' + o.lateNoFeeCount + ' late ' + (o.lateNoFeeCount === 1 ? 'invoice' : 'invoices') + ' with no fee');
      // Under 3 months of history, a monthly average and a yearly guess would
      // just multiply one fee: show the real total instead.
      const early = o.monthsSeen < 3;
      bind({
        opp_month: money(early ? o.perMonthCents * o.monthsSeen : o.perMonthCents),
        opp_unit: early ? ' so far' : ' a month',
        opp_year: money(o.perYearCents),
        opp_parts: parts.join(' + ') + (early ? '' : o.monthsSeen < 12 ? ' over ' + o.monthsSeen + ' months' : ' this year'),
      });
      const year = document.querySelector('[data-opp-year]');
      if (year) year.hidden = early;
    }
  }
  bind({ fees_waived_count: sel ? (sel.count === 1 ? '1 fee' : sel.count + ' fees') : '0 fees' });

  const strip = document.querySelector('[data-waiver-months]');
  if (strip) {
    strip.replaceChildren(...data.months.map(m => {
      const d = document.createElement('div');
      d.className = 'wt-waivers__month' + (m.count ? '' : ' is-zero');
      d.title = m.count + ' waived · ' + money(m.cents);
      const b = document.createElement('b'); b.textContent = String(m.count);
      const s = document.createElement('span'); s.textContent = new Date(m.month + '-15').toLocaleDateString('en-US', { month: 'short' });
      d.append(b, s);
      return d;
    }));
  }
  const list = document.querySelector('[data-waiver-clients]');
  const empty = document.querySelector('[data-waiver-empty]');
  if (!list) return;
  empty.hidden = data.clients.length > 0;
  list.replaceChildren(...data.clients.map(c => {
    const li = document.createElement('li'); li.className = 'wt-waivers__row';
    const left = document.createElement('div');
    const name = document.createElement('div'); name.className = 'wt-waivers__name'; name.textContent = c.name;
    const meta = document.createElement('div'); meta.className = 'wt-waivers__meta';
    const late = c.paidCount ? `Paid late ${c.paidLateCount} of ${c.paidCount}` : 'No paid invoices yet';
    const lateSpan = document.createElement('span'); lateSpan.textContent = late;
    if (c.paidCount && c.paidLateCount / c.paidCount >= 0.5) lateSpan.className = 'wt-waivers__late';
    meta.append(lateSpan, document.createTextNode(` · a fee came due ${c.feesDue} ${c.feesDue === 1 ? 'time' : 'times'}`));
    left.append(name, meta);
    const right = document.createElement('div'); right.className = 'wt-waivers__count';
    right.textContent = c.waivedCount + ' waived';
    const sm = document.createElement('small'); sm.textContent = money(c.waivedCents); right.append(sm);
    li.append(left, right);
    if (c.notes.length) {
      const n = document.createElement('p'); n.className = 'wt-waivers__notes';
      n.textContent = 'Your notes: ' + c.notes.map(x => '“' + x + '”').join(' · ');
      li.append(n);
    }
    return li;
  }));
}

function renderTrend(trend, picked) {
  const bars = document.querySelector('.wt-bars');
  const labels = document.querySelector('.wt-bar-labels');
  const select = document.querySelector('[data-report-month]');
  if (!bars || !labels) return;
  if (!trend.length) { bars.innerHTML = ''; labels.innerHTML = ''; return; }

  const max = Math.max.apply(null, trend.map(t => t.totalCents).concat([1]));

  bars.innerHTML = trend.map((t, i) => {
    const invH = max ? (t.moneyInCents / max * 100).toFixed(1) : 0;
    const feeH = max ? (t.feeRevenueCents / max * 100).toFixed(1) : 0;
    const sel = t.month === picked ? ' is-selected' : '';
    return '<button class="wt-bar' + sel + '" type="button" data-month="' + t.month + '" title="' + t.label + ': ' + money(t.moneyInCents) + ' + ' + money(t.feeRevenueCents) + ' fees"><span class="wt-bar__fee" style="height:' + feeH + '%"></span><span class="wt-bar__inv" style="height:' + invH + '%"></span></button>';
  }).join('');

  labels.innerHTML = trend.map(t => {
    const d = new Date(t.month + '-15'); // mid-month: '-01' is the previous day in US time zones
    const letter = d.toLocaleDateString('en-US', { month: 'short' })[0];
    const sel = t.month === picked ? ' is-selected' : '';
    return '<span class="' + sel + '">' + letter + '</span>';
  }).join('');

  if (select) {
    select.innerHTML = trend.slice().reverse().map(t => '<option value="' + t.month + '"' + (t.month === picked ? ' selected' : '') + '>' + t.label + '</option>').join('');
  }
}

// ---- Settings ----
async function loadSettings() {
  const [settings, status] = await Promise.all([
    api('GET', '/settings').catch(() => ({})),
    api('GET', '/settings/status').catch(() => ({})),
  ]);

  const form = document.querySelector('[data-settings-form]');
  if (form) {
    form.querySelector('[name="owner_name"]').value = settings.ownerName || '';
    form.querySelector('[name="business_name"]').value = settings.businessName || '';
    form.querySelector('[name="owner_email"]').value = settings.ownerEmail || '';
    form.querySelector('[name="alert_overdue"]').checked = settings.alertOverdue !== false;
    form.querySelector('[name="alert_paid"]').checked = !!settings.alertPayment;

    // default fee terms
    const feeKind = settings.defaultFeeKind === 'percent' ? 'pct' : (settings.defaultFeeKind === 'flat' ? 'flat' : 'none');
    form.querySelector('[name="grace_days"]').value = settings.defaultGraceDays != null ? settings.defaultGraceDays : '';
    setFeeOption(form, feeKind);
    if (feeKind === 'flat') form.querySelector('[name="fee_flat"]').value = settings.defaultFeeAmount || '';
    if (feeKind === 'pct') form.querySelector('[name="fee_pct"]').value = settings.defaultFeeAmount || '';
  }

  // Stripe connection state
  const connected = status.stripeConnected;
  const accountId = status.stripeAccountId || '';
  const shortId = accountId.startsWith('acct_') ? accountId.slice(0, 9) + '…' + accountId.slice(-3) : accountId;
  bind({
    stripe_account_name: status.stripeName || settings.businessName || 'Stripe account',
    stripe_account_id: shortId,
    stripe_name: status.stripeName || '',
  });
  document.querySelectorAll('[data-stripe]').forEach(el => {
    const want = el.getAttribute('data-stripe');
    el.hidden = (want === 'connected') !== connected;
  });
  // Name check: the Stripe payment page shows a different name than Dunn's emails.
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const mismatch = document.querySelector('[data-stripe-name-mismatch]');
  if (mismatch) mismatch.hidden = !(connected && status.stripeName && settings.businessName && norm(status.stripeName) !== norm(settings.businessName));

  // Plan
  const plan = settings.plan || 'solo';
  // No plan yet: show the plan buttons instead of "Manage plan".
  const noPlan = !settings.plan || settings.needsPlan;
  const choose = document.querySelector('[data-choose-plan]');
  const manage = document.querySelector('[data-billing-portal]');
  if (choose) choose.hidden = !noPlan;
  if (manage) manage.hidden = noPlan;
  bind({
    plan_label: noPlan ? 'No plan yet. Pick one to start sending invoices.' : plan === 'business' ? 'Unlimited clients' : 'Up to 5 clients',
    plan_usage: noPlan ? '' : settings.planEnding && settings.planPeriodEnd
      ? 'Cancelled. Works until ' + new Date(settings.planPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '. Manage plan → "Don\u2019t cancel subscription" to keep it.'
      : plan === 'business' ? 'No limits'
      : settings.clientsThisMonth != null
        ? (settings.clientsThisMonth > settings.clientLimit
          ? `${settings.clientsThisMonth} clients this month (over the ${settings.clientLimit} included, so new clients need Unlimited)`
          : `${settings.clientsThisMonth} of ${settings.clientLimit} clients this month · billed as often as weekly`)
      : 'Billed as often as weekly',
  });
}

function setFeeOption(form, kind) {
  form.querySelectorAll('[data-fee]').forEach(b => {
    const on = b.getAttribute('data-fee') === kind;
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  form.querySelectorAll('[data-fee-input]').forEach(inp => {
    inp.hidden = inp.getAttribute('data-fee-input') !== kind;
  });
}

// ---- Event handlers ----
document.addEventListener('wt:view', e => {
  const view = e.detail.view;
  if (view === 'dashboard' || view === 'invoices') loadDashboard();
  else if (view === 'recurring') loadRecurring();
  else if (view === 'clients') loadClients();
  else if (view === 'reports') loadReports();
  else if (view === 'settings') loadSettings();
});

document.addEventListener('wt:filter', e => { state.filter = e.detail.status; renderInvoices(); });
document.addEventListener('wt:search', e => { state.query = e.detail.query; renderInvoices(); });

document.addEventListener('wt:approve-fee', async e => {
  // amount is set when the owner lowered the fee before approving.
  const body = e.detail.amount !== undefined ? { amount: e.detail.amount } : {};
  try { await api('POST', '/invoices/' + e.detail.invoiceId + '/fee/approve', body); }
  catch (err) { alert("Couldn't save the fee: " + err.message); return; }
  loadDashboard();
});
document.addEventListener('wt:change-fee', async e => {
  try { await api('POST', '/invoices/' + e.detail.invoiceId + '/fee/change', { amount: e.detail.amount }); }
  catch (err) { alert('Change failed: ' + err.message); return; }
  loadDashboard();
});
document.addEventListener('wt:waive-fee', async e => {
  try { await api('POST', '/invoices/' + e.detail.invoiceId + '/waive', { note: e.detail.note || '' }); }
  catch (err) { alert('Waive failed: ' + err.message); return; }
  loadDashboard();
});

document.addEventListener('wt:recurring-save', async e => {
  const d = e.detail.data;
  const feeKind = d.fee_type === 'pct' ? 'percent' : (d.fee_type === 'flat' ? 'flat' : 'none');
  const body = {
    clientName: d.client_name,
    clientEmail: d.client_email,
    amount: parseMoney(d.amount),
    frequency: d.frequency,
    // "last day" is 31: the run date clamps to each month's length (30th, Feb 28/29).
    customDay: d.custom_day === 'last' ? 31 : (parseInt(d.custom_day) || undefined),
    startDate: d.next_invoice_date,
    dueDays: parseInt(d.due_days, 10) || undefined,
    feeKind,
    feeAmount: feeKind === 'flat' ? (parseMoney(d.fee_flat) || 0) : feeKind === 'percent' ? (parseFloat(d.fee_pct) || 0) : 0,
    active: d.status !== 'paused',
  };
  // Only send the grace period when there's a fee — then it's required.
  const grace = graceValue(d.grace_days);
  if (feeKind !== 'none' && grace === null) { alert(GRACE_REQUIRED); return; }
  if (grace !== null) body.graceDays = grace;
  try {
    if (d.id) { await api('PATCH', '/templates/' + d.id, body); }
    else { await api('POST', '/templates', body); }
    loadRecurring();
    if (window.WatchtowerUI) WatchtowerUI.closeModal('wt-recurring-modal');
  } catch (err) { alert('Save failed: ' + err.message); }
});

document.addEventListener('wt:recurring-toggle', async e => {
  try { await api('PATCH', '/templates/' + e.detail.id, { active: e.detail.active }); loadRecurring(); }
  catch (err) { alert('Toggle failed: ' + err.message); }
});
document.addEventListener('wt:recurring-delete', async e => {
  try { await api('DELETE', '/templates/' + e.detail.id); loadRecurring(); }
  catch (err) { alert('Delete failed: ' + err.message); }
});
document.addEventListener('wt:recurring-edit', async e => {
  // Open the modal pre-filled. The form's data is loaded on save; edit prefill is light here.
  const data = await api('GET', '/templates').catch(() => ({ templates: [] }));
  const t = (data.templates || []).find(x => x.id === e.detail.id);
  if (!t) return;
  const form = document.querySelector('[data-recurring-form]');
  if (form) {
    form.querySelector('[name="id"]').value = t.id;
    form.querySelector('[name="client_name"]').value = t.clientName;
    form.querySelector('[name="client_email"]').value = t.clientEmail;
    form.querySelector('[name="amount"]').value = (t.amount / 100).toFixed(2);
    form.querySelector('[name="frequency"]').value = t.frequency;
    const dueSel = form.querySelector('[name="due_days"]');
    if (dueSel) { dueSel.value = String([7, 14, 30].includes(t.dueDays) ? t.dueDays : 30); dueSel.dataset.touched = '1'; }
    form.querySelector('[name="custom_day"]').value = t.customDay >= 29 ? 'last' : (t.customDay || 1);
    form.querySelector('[name="next_invoice_date"]').value = (t.nextRunDate || '').slice(0, 10);
    form.querySelector('[name="grace_days"]').value = t.graceDays != null ? t.graceDays : '';
    if (t.feeKind === 'flat') { form.querySelector('[name="fee_flat"]').value = t.feeAmount; }
    if (t.feeKind === 'percent') { form.querySelector('[name="fee_pct"]').value = t.feeAmount; }
    setFeeOption(form, t.feeKind === 'percent' ? 'pct' : t.feeKind);
    // Sync the fee panel: sets the hidden fee_type (else saving an edit
    // dropped the fee) and the "Your client sees" line.
    form.querySelector('.wt-fee-panel__grace')?.dispatchEvent(new Event('input', { bubbles: true }));
    const status = t.active ? 'active' : 'paused';
    form.querySelector('[name="status"]').value = status;
    form.querySelectorAll('.wt-seg__opt').forEach(b => { const on = b.dataset.value === status; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); });
    const title = document.getElementById('rec-modal-title');
    if (title) title.textContent = 'Edit recurring invoice';
    const sent = t.sentCount || 0;
    const note = form.querySelector('[data-edit-only]');
    note.textContent = sent
      ? 'Changes apply to future invoices only. The ' + sent + ' already sent ' + (sent === 1 ? 'stays' : 'stay') + ' as ' + (sent === 1 ? 'it is.' : 'they are.')
      : 'Changes apply to future invoices only.';
    note.hidden = false;
  }
});

document.addEventListener('wt:settings-save', async e => {
  const d = e.detail.data;
  const feeKind = d.fee_type === 'pct' ? 'percent' : (d.fee_type === 'flat' ? 'flat' : 'none');
  const body = {
    ownerName: (d.owner_name || '').trim(),
    businessName: (d.business_name || '').trim(),
    ownerEmail: d.owner_email,
    alertOverdue: !!d.alert_overdue,
    alertPayment: !!d.alert_paid,
    defaultFeeKind: feeKind,
    defaultFeeAmount: feeKind === 'flat' ? (parseMoney(d.fee_flat) || 0) : feeKind === 'percent' ? (parseFloat(d.fee_pct) || 0) : 0,
    defaultGraceDays: graceValue(d.grace_days),
  };
  if (!body.businessName) { alert('Business name is required. It\'s what your clients see in every email.'); return; }
  if (body.defaultFeeKind !== 'none' && body.defaultGraceDays === null) { alert(GRACE_REQUIRED); return; }
  try {
    await api('PUT', '/settings', body);
    loadSettings(); // refresh the Stripe-name check against the new business name
    loadProfile();
    const note = document.querySelector('[data-save-note]');
    if (note) { note.textContent = 'Saved. Alerts go to ' + (d.owner_email || 'your email'); setTimeout(() => { note.textContent = ''; }, 4000); }
  } catch (err) { alert('Save failed: ' + err.message); }
});

// Sidebar profile on every view — otherwise opening #settings (or any view
// but the dashboard) directly shows the designer's sample "Marta Rivera".
async function loadProfile() {
  const s = await api('GET', '/settings').catch(() => ({}));
  const who = s.ownerName || s.businessName || '';
  bind({ owner_name: who, owner_email: s.ownerEmail || '', owner_initials: initials(who) });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  // Load whatever view the current hash points at (watchtower-ui.js fires wt:view on load too).
  const view = (window.location.hash || '').replace('#', '') || 'dashboard';
  document.dispatchEvent(new CustomEvent('wt:view', { detail: { view } }));
});
// Recurring form: "Payment due" follows the schedule (weekly → 7 days,
// every 2 weeks → 14, monthly → 30) until the owner picks it themselves.
document.addEventListener('change', (e) => {
  const form = e.target.closest && e.target.closest('[data-recurring-form]');
  if (!form) return;
  const due = form.querySelector('[name="due_days"]');
  if (!due) return;
  if (e.target === due) { due.dataset.touched = '1'; return; }
  if (e.target.name === 'frequency' && !due.dataset.touched) {
    due.value = { weekly: '7', biweekly: '14' }[e.target.value] || '30';
  }
});

// "New recurring invoice" always starts blank. Without this, the form kept the
// last edited invoice (including its id), so saving overwrote that invoice.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-open-modal="wt-recurring-modal"]')) return;
  const form = document.querySelector('[data-recurring-form]');
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  const due = form.querySelector('[name="due_days"]');
  if (due) { delete due.dataset.touched; due.value = '30'; }
  const next = form.querySelector('[name="next_invoice_date"]');
  if (next) { delete next.dataset.touched; next.value = ''; }
  form.querySelectorAll('[data-edit-only]').forEach(el => { el.hidden = true; });
  const title = document.getElementById('rec-modal-title');
  if (title) title.textContent = 'New recurring invoice';
  form.querySelector('[name="status"]').value = 'active'; // hidden inputs ignore reset()
  form.querySelectorAll('.wt-seg__opt').forEach(b => { const on = b.dataset.value === 'active'; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on); });
  if (typeof setFeeOption === 'function') setFeeOption(form, 'none');
  form.querySelector('.wt-fee-panel__grace')?.dispatchEvent(new Event('input', { bubbles: true }));
  form.querySelector('[name="frequency"]')?.dispatchEvent(new Event('change', { bubbles: true }));
}, true);
