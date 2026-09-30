// Dollar amounts. parseMoney reads "1500", "1,500", "$1,500.00" the same way
// (parseFloat alone stops at the first comma: "1,500" would be a $1 invoice).
// Every dollar box is shown as "1,500.00" once the owner leaves it.
(function () {
  function parseMoney(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  function formatMoney(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  window.parseMoney = parseMoney;
  window.formatMoney = formatMoney;

  const DOLLAR_BOXES = '#amount, #fee-flat, #flat-amount, input[name="amount"], input[name="fee_flat"]';
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches(DOLLAR_BOXES) || el.value.trim() === '') return;
    const n = parseMoney(el.value);
    if (!Number.isFinite(n) || n < 0) return;
    el.value = formatMoney(n);
    el.dispatchEvent(new Event('input', { bubbles: true })); // keep live previews in step
  });
})();
