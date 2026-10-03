/* Watchtower — UI-only behavior (no API calls).
   Toggles classes and fires CustomEvents. Listen for the events and call your API from there.

   Events (all bubble from document):
     wt:view          { view }                   sidebar view changed (dashboard | invoices | recurring | clients | reports | settings)
     wt:filter        { status }                 invoice filter tab clicked ("all" | "overdue" | "fee-applied" | "due-soon" | "pending" | "paid")
     wt:search        { query }                  invoice search input (debounced 200ms)
     wt:open-invoice  { id }                     invoice row clicked
     wt:approve-fee   { invoiceId, amount? }     Approve fee clicked (amount = dollars, when the owner lowered it first)
     wt:change-fee    { invoiceId, amount }      Lower a fee already on the bill (amount = dollars)
     wt:waive-fee     { invoiceId, note }        Waive confirmed (note may be "")
     wt:recurring-toggle { id, active }          Pause / Resume clicked (active = new state)
     wt:recurring-edit   { id }                  Edit clicked (open the modal and fill it from your data)
     wt:recurring-delete { id }                  Delete confirmed
     wt:recurring-save   { data }                Recurring form submitted (plain object of the form fields)
     wt:report-month  { month }                  reports.html: month picked ("YYYY-MM")
     wt:settings-save { data }                   settings.html: form submitted
*/
(function () {
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));

  /* ---------- Invoice filters + search ---------- */
  document.addEventListener('click', (e) => {
    const f = e.target.closest('.wt-filter');
    if (!f) return;
    $$('.wt-filter', f.parentElement).forEach(b => { b.classList.toggle('is-active', b === f); b.setAttribute('aria-pressed', b === f); });
    emit('wt:filter', { status: f.dataset.status });
  });
  let searchT;
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-search]')) return;
    clearTimeout(searchT);
    searchT = setTimeout(() => emit('wt:search', { query: e.target.value.trim() }), 200);
  });
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.wt-invoices .wt-table__row[data-id]');
    if (!row) return;
    $$('.wt-invoices .wt-table__row.is-selected').forEach(r => r.classList.remove('is-selected'));
    row.classList.add('is-selected');
    emit('wt:open-invoice', { id: row.dataset.id });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const row = e.target.closest('.wt-invoices .wt-table__row[data-id]');
    if (row) emit('wt:open-invoice', { id: row.dataset.id });
  });

  /* ---------- Fee amount box: keep the confirm button's amount in sync ---------- */
  document.addEventListener('input', (e) => {
    const box = e.target.closest('.wt-fees__change');
    if (!box) return;
    const btn = box.querySelector('[data-action="confirm-change"]');
    const v = Number(e.target.value);
    btn.textContent = btn.dataset.verb + (v > 0 ? ' $' + v.toFixed(2) : '');
  });

  /* ---------- Fees: approve / change / waive with note ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.wt-fees__row');
    const item = btn.closest('.wt-recurring__item');
    switch (btn.dataset.action) {
      case 'approve-fee': emit('wt:approve-fee', { invoiceId: row.dataset.invoiceId }); break;
      case 'waive-fee':
        row.classList.add('is-waiving');
        row.querySelector('.wt-fees__waive input')?.focus();
        break;
      case 'cancel-waive':
        row.classList.remove('is-waiving');
        row.querySelector('.wt-fees__waive input').value = '';
        break;
      case 'confirm-waive': {
        const note = row.querySelector('.wt-fees__waive input').value.trim();
        emit('wt:waive-fee', { invoiceId: row.dataset.invoiceId, note });
        break;
      }
      case 'change-fee':
        row.classList.add('is-changing');
        row.querySelector('.wt-fees__change input')?.select();
        break;
      case 'cancel-change':
        row.classList.remove('is-changing');
        break;
      case 'confirm-change': {
        // Pending fee → approve at this amount. Fee on the bill → lower it.
        const amount = row.querySelector('.wt-fees__change input').value;
        emit(row.dataset.feeMode === 'billed' ? 'wt:change-fee' : 'wt:approve-fee', { invoiceId: row.dataset.invoiceId, amount });
        break;
      }
      /* ---------- Recurring list ---------- */
      case 'recurring-edit': emit('wt:recurring-edit', { id: item.dataset.id }); openModal('wt-recurring-modal'); break;
      case 'recurring-toggle': {
        const nowActive = item.classList.contains('is-paused');
        emit('wt:recurring-toggle', { id: item.dataset.id, active: nowActive });
        break;
      }
      case 'recurring-delete': item.classList.add('is-deleting'); break;
      case 'recurring-keep': item.classList.remove('is-deleting'); break;
      case 'recurring-confirm-delete': emit('wt:recurring-delete', { id: item.dataset.id }); break;
    }
  });

  /* ---------- Modal ---------- */
  function openModal(id) { const m = document.getElementById(id); if (!m) return; m.hidden = false; m.querySelector('input, select, button')?.focus(); }
  function closeModal(m) { if (m) m.hidden = true; }
  window.WatchtowerUI = { openModal, closeModal: (id) => closeModal(document.getElementById(id)) };
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open-modal]');
    if (opener) { e.preventDefault(); openModal(opener.dataset.openModal); return; }
    const closer = e.target.closest('[data-close-modal]');
    if (closer) closeModal(closer.closest('.wt-modal'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.wt-modal:not([hidden])').forEach(closeModal);
  });

  /* ---------- Fee panel (shared by invoice + recurring forms) ---------- */
  function syncFeePanel(panel) {
    const type = panel.querySelector('.wt-fee-option.is-selected')?.dataset.fee || 'none';
    $$('[data-fee-input]', panel).forEach(el => { el.hidden = el.dataset.feeInput !== type; });
    panel.querySelector('input[name="fee_type"]').value = type;
    const grace = parseInt(panel.querySelector('.wt-fee-panel__grace').value, 10) || 0;
    const flat = parseMoney(panel.querySelector('[name="fee_flat"]')?.value) || 0;
    const pct = parseFloat(panel.querySelector('[name="fee_pct"]')?.value) || 0;
    const preview = panel.querySelector('.wt-fee-panel__preview');
    if (!preview) return;
    if (type === 'flat' && flat > 0) preview.textContent = `Your client sees: "A $${flat.toFixed(0)} late fee applies if unpaid ${grace} days after the due date."`;
    else if (type === 'pct' && pct > 0) preview.textContent = `Your client sees: "A ${pct}% late fee applies if unpaid ${grace} days after the due date."`;
    else preview.textContent = 'Your client sees: No late fee.';
  }
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('.wt-fee-option');
    if (!opt) return;
    const panel = opt.closest('.wt-fee-panel');
    $$('.wt-fee-option', panel).forEach(o => { o.classList.toggle('is-selected', o === opt); o.setAttribute('aria-pressed', o === opt); });
    syncFeePanel(panel);
  });
  document.addEventListener('input', (e) => { const p = e.target.closest('.wt-fee-panel'); if (p) syncFeePanel(p); });

  /* ---------- Recurring form ---------- */
  const TODAY = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  function nextFor(freq, day) {
    const t = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 12);
    if (freq === 'weekly') return iso(new Date(t.getTime() + 7 * 864e5));
    if (freq === 'biweekly') return iso(new Date(t.getTime() + 14 * 864e5));
    if (freq === 'monthly') { const last = new Date(t.getFullYear(), t.getMonth() + 2, 0).getDate(); return iso(new Date(t.getFullYear(), t.getMonth() + 1, Math.min(t.getDate(), last), 12)); }
    for (let m = 0; m < 3; m++) {
      const last = new Date(t.getFullYear(), t.getMonth() + m + 1, 0).getDate();
      const d = day === 'last' ? last : Math.min(Number(day), last);
      const dt = new Date(t.getFullYear(), t.getMonth() + m, d, 12);
      if (dt > t) return iso(dt);
    }
  }
  $$('form[data-recurring-form]').forEach(form => {
    const freq = form.querySelector('[name="frequency"]');
    const day = form.querySelector('[name="custom_day"]');
    const next = form.querySelector('[name="next_invoice_date"]');
    const customRow = form.querySelector('.wt-custom-day');
    const recalc = () => {
      customRow.hidden = freq.value !== 'custom';
      if (next.dataset.touched !== 'true') next.value = nextFor(freq.value, day.value);
    };
    freq.addEventListener('change', recalc);
    day.addEventListener('change', recalc);
    next.addEventListener('input', () => { next.dataset.touched = 'true'; });
    recalc();

    $$('.wt-seg__opt', form).forEach(b => b.addEventListener('click', () => {
      $$('.wt-seg__opt', form).forEach(x => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-pressed', x === b); });
      form.querySelector('[name="status"]').value = b.dataset.value;
    }));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      emit('wt:recurring-save', { data: Object.fromEntries(new FormData(form).entries()) });
    });
  });

  $$('.wt-fee-panel').forEach(syncFeePanel);

  /* ---------- Views (one-file dashboard, hash routing) ---------- */
  const VIEWS = ['dashboard', 'invoices', 'recurring', 'clients', 'reports', 'settings'];
  function showView() {
    if (!document.querySelector('[data-views]')) return;
    const h = location.hash.slice(1);
    const view = VIEWS.includes(h) ? h : 'dashboard';
    $$('[data-views]').forEach(el => { el.hidden = !el.dataset.views.split(' ').includes(view); });
    $$('[data-nav]').forEach(a => { const on = a.dataset.nav === view; a.classList.toggle('is-active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    emit('wt:view', { view });
  }
  window.addEventListener('hashchange', showView);
  showView();
})();
