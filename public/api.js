// Watchtower API connector — binds data to the UI and handles custom events.
// Load after watchtower-ui.js on every page.

const API_BASE = '';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Fill all [data-bind] elements with values from a map.
function bind(data) {
  document.querySelectorAll('[data-bind]').forEach(el => {
    const key = el.getAttribute('data-bind');
    if (key in data) {
      el.textContent = data[key];
    }
  });
}

// Render a data-list: clone the template for each item, replace {placeholders}, delete samples.
function renderList(listName, items, renderFn) {
  const container = document.querySelector(`[data-list="${listName}"]`);
  if (!container) return;
  const tpl = document.getElementById(`tpl-${listName}`);
  if (!tpl) return;
  // Remove sample rows (non-template children)
  Array.from(container.children).forEach(child => {
    if (child !== tpl) child.remove();
  });
  for (const item of items) {
    const clone = tpl.content.cloneNode(true);
    renderFn(clone, item);
    container.appendChild(clone);
  }
}

// --- Dashboard ---
async function loadDashboard() {
  const [reports, invoicesData, settings] = await Promise.all([
    api('GET', '/reports/revenue'),
    api('GET', '/invoices'),
    api('GET', '/settings').catch(() => ({})),
  ]);

  const invoices = invoicesData.invoices || [];
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const hour = now.getHours();
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const ownerName = settings.owner_name || 'there';
  const firstName = ownerName.split(/\s+/)[0] || 'there';

  // Compute statuses
  const overdue = invoices.filter(i => i.status === 'open' && new Date(i.due) < now && !i.feeApplied);
  const dueSoon = invoices.filter(i => {
    if (i.status !== 'open') return false;
    const d = new Date(i.due);
    return d >= now && d <= new Date(now.getTime() + 7 * 86400000);
  });
  const feeApplied = invoices.filter(i => i.feeApplied && i.status === 'open');
  const pendingFees = invoices.filter(i => i.feeStatus === 'open');

  let statusLine;
  if (overdue.length > 0 && dueSoon.length > 0) statusLine = `${overdue.length} overdue, ${dueSoon.length} due this week.`;
  else if (overdue.length > 0) statusLine = `${overdue.length} overdue, the rest on watch.`;
  else if (dueSoon.length > 0) statusLine = `${dueSoon.length} due this week.`;
  else statusLine = 'All quiet tonight.';

  const monthShort = now.toLocaleDateString('en-US', { month: 'short' });
  const monthLong = now.toLocaleDateString('en-US', { month: 'long' });

  bind({
    today_long: todayStr,
    greeting: `Good ${period}, ${firstName}.`,
    status_line: statusLine,
    overdue_count: overdue.length + feeApplied.length,
    overdue_total: `$${(overdue.reduce((s, i) => s + i.amount_cents, 0) + feeApplied.reduce((s, i) => s + i.amount_cents, 0)) / 100}`,
    collected_this_month: reports.moneyIn || '$0',
    paid_count_this_month: reports.invoiceCount || '0',
    month_short: monthShort,
    month_long: monthLong,
    fee_revenue: reports.feeRevenue || '$0',
    fees_collected: reports.feeRevenue || '$0',
    fees_billed: '$0',
    pending_fees_total: `$${(pendingFees.reduce((s, i) => s + i.feeAmountCents, 0) / 100).toFixed(2)}`,
    pending_fee_count: pendingFees.length,
    owner_name: ownerName,
    owner_email: settings.ownerEmail || '',
    owner_initials: (firstName[0] + (ownerName.split(/\s+/)[1]?.[0] || '')).toUpperCase(),
  });

  // Invoice list
  renderList('invoices', invoices, (clone, inv) => {
    const due = new Date(inv.due);
    const nowMs = now.getTime();
    const diffDays = Math.round((due.getTime() - nowMs) / 86400000);
    let dueText, statusClass, statusText;
    if (inv.status === 'paid') {
      dueText = `Paid ${inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`;
      statusClass = 'wt-pill--paid';
      statusText = 'Paid';
    } else if (inv.feeApplied) {
      dueText = `${diffDays >= 0 ? 'in ' : ''}${Math.abs(diffDays)} days`;
      statusClass = 'wt-pill--fee-applied';
      statusText = 'Fee applied';
    } else if (diffDays < 0) {
      dueText = `${Math.abs(diffDays)} days late`;
      statusClass = 'wt-pill--overdue';
      statusText = 'Overdue';
    } else if (diffDays <= 7) {
      dueText = `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
      statusClass = 'wt-pill--due-soon';
      statusText = 'Due soon';
    } else {
      dueText = `in ${diffDays} days`;
      statusClass = 'wt-pill--pending';
      statusText = 'Pending';
    }

    clone.querySelector('[data-field="id"]').textContent = inv.id;
    clone.querySelector('[data-field="client"]').textContent = inv.client || '—';
    clone.querySelector('[data-field="due"]').textContent = dueText;
    clone.querySelector('[data-field="amount"]').textContent = inv.amount;
    const pill = clone.querySelector('.wt-pill');
    pill.className = `wt-pill ${statusClass}`;
    pill.textContent = statusText;
    clone.querySelector('[data-field="invoice-id"]').value = inv.id;
  });

  // Pending fees
  renderList('pending_fees', pendingFees, (clone, inv) => {
    clone.querySelector('[data-field="client"]').textContent = inv.client || '—';
    clone.querySelector('[data-field="invoice-link"]').textContent = inv.id;
    clone.querySelector('[data-field="fee-reason"]').textContent = '7-day grace period passed';
    clone.querySelector('[data-field="fee-amount"]').textContent = inv.fee || '$0';
    const row = clone.querySelector('.wt-fees__row');
    if (row) row.dataset.invoiceId = inv.id;
  });
}

// --- Recurring invoices ---
async function loadRecurring() {
  const data = await api('GET', '/templates');
  const templates = data.templates || [];

  renderList('recurring', templates, (clone, t) => {
    clone.querySelector('[data-field="client"]').textContent = t.clientName;
    clone.querySelector('[data-field="amount-fee"]').textContent = `$${(t.amount / 100).toFixed(2)} · ${t.feeKind === 'none' ? 'No late fee' : `${t.feeKind === 'flat' ? '$' : ''}${t.feeAmount}${t.feeKind === 'percent' ? '%' : ''} late fee`}`;
    clone.querySelector('[data-field="schedule"]').textContent = `${t.frequency === 'monthly' ? 'Monthly' : t.frequency === 'weekly' ? 'Weekly' : t.frequency === 'biweekly' ? 'Every 2 weeks' : `Monthly, ${t.customDay || ''}th`} · Next ${new Date(t.nextRunDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    clone.querySelector('[data-field="last-invoice"]').textContent = t.lastRunAt ? `${new Date(t.lastRunAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${t.lastRunOk ? 'Sent' : 'Failed, will retry'}` : 'None yet';
    const statusPill = clone.querySelector('[data-field="status"]');
    if (t.active) {
      statusPill.className = 'wt-pill wt-pill--paid';
      statusPill.textContent = 'Active';
    } else {
      statusPill.className = 'wt-pill wt-pill--paused';
      statusPill.textContent = 'Paused';
    }
    clone.querySelector('[data-field="edit"]').dataset.id = t.id;
    clone.querySelector('[data-field="toggle"]').dataset.id = t.id;
    clone.querySelector('[data-field="delete"]').dataset.id = t.id;
    const item = clone.querySelector('.wt-recurring__item');
    if (item) item.dataset.id = t.id;
  });
}

// --- Event handlers ---
document.addEventListener('wt:approve-fee', async e => {
  try {
    await api('POST', `/invoices/${e.detail.invoiceId}/fee/approve`);
    loadDashboard();
  } catch (err) {
    alert('Approve failed: ' + err.message);
  }
});

document.addEventListener('wt:waive-fee', async e => {
  try {
    await api('POST', `/invoices/${e.detail.invoiceId}/waive`, { note: e.detail.note || '' });
    loadDashboard();
  } catch (err) {
    alert('Waive failed: ' + err.message);
  }
});

document.addEventListener('wt:recurring-save', async e => {
  const d = e.detail.data;
  const body = {
    clientName: d.client_name,
    clientEmail: d.client_email,
    amount: parseFloat(d.amount),
    frequency: d.frequency,
    customDay: d.custom_day === 'last' ? 28 : parseInt(d.custom_day),
    startDate: d.next_invoice_date,
    feeKind: d.fee_type === 'none' ? 'none' : d.fee_type === 'flat' ? 'flat' : 'percent',
    feeAmount: d.fee_type === 'flat' ? parseFloat(d.fee_flat) : d.fee_type === 'pct' ? parseFloat(d.fee_pct) : 0,
    graceDays: parseInt(d.grace_days) || 7,
  };
  try {
    if (d.id) {
      await api('PATCH', `/templates/${d.id}`, body);
    } else {
      await api('POST', '/templates', body);
    }
    loadRecurring();
    WatchtowerUI.closeModal();
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
});

document.addEventListener('wt:recurring-toggle', async e => {
  try {
    await api('PATCH', `/templates/${e.detail.id}`, { active: e.detail.active });
    loadRecurring();
  } catch (err) {
    alert('Toggle failed: ' + err.message);
  }
});

document.addEventListener('wt:recurring-delete', async e => {
  try {
    await api('DELETE', `/templates/${e.detail.id}`);
    loadRecurring();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
});

document.addEventListener('wt:filter', e => {
  // The page will re-render; the API connector can filter the already-loaded list
  // or the watchtower-ui.js handles filter visual state.
});

document.addEventListener('wt:search', e => {
  // Could re-fetch or filter client-side; for now no-op.
});

// --- Page init ---
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  if (path.includes('dashboard') || path === '/') {
    loadDashboard();
  }
  if (path.includes('recurring')) {
    loadRecurring();
  }
  // Onboarding success: data is passed in URL params by the callback
  if (path.includes('onboarding-success')) {
    const params = new URLSearchParams(window.location.search);
    bind({
      open_invoices: params.get('open_invoices') || '0',
      clients: params.get('clients') || '0',
      past_due: params.get('past_due') || '0',
    });
  }
});