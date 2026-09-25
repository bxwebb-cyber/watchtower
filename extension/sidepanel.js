const STORAGE_KEY = 'dunn_sidepanel_config';
const STATE_KEY = 'dunn_sidepanel_state';

let config = { serverUrl: '', apiToken: '' };
let state = { lastPaidCount: 0, lastOverdueCount: -1 };

async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    config = stored[STORAGE_KEY];
    document.getElementById('server-url').value = config.serverUrl;
    document.getElementById('api-token').value = config.apiToken;
    loadData();
  }

  const savedState = await chrome.storage.local.get(STATE_KEY);
  if (savedState[STATE_KEY]) state = savedState[STATE_KEY];

  document.getElementById('save-settings').addEventListener('click', async () => {
    config.serverUrl = document.getElementById('server-url').value.trim().replace(/\/+$/, '');
    config.apiToken = document.getElementById('api-token').value.trim();
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
    loadData();
  });

  // Request notification permission on first launch
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

async function loadData() {
  if (!config.serverUrl || !config.apiToken) {
    setStatus('Enter server URL and API token above.', 'wait');
    return;
  }

  setStatus('Loading...', 'wait');
  const container = document.getElementById('cards-container');

  try {
    const [invoicesRes, reportsRes] = await Promise.all([
      fetch(`${config.serverUrl}/invoices`, { headers: { Authorization: `Bearer ${config.apiToken}` } }),
      fetch(`${config.serverUrl}/reports/revenue`, { headers: { Authorization: `Bearer ${config.apiToken}` } }),
    ]);

    if (!invoicesRes.ok) throw new Error(`Invoices API: ${invoicesRes.status}`);
    if (!reportsRes.ok) throw new Error(`Reports API: ${reportsRes.status}`);

    const invoices = await invoicesRes.json();
    const reports = await reportsRes.json();

    const now = new Date();
    const invoiceList = invoices.invoices || [];
    const overdue = invoiceList.filter(i => i.status === 'open' && new Date(i.due) < now);
    const dueSoon = invoiceList.filter(i => i.status === 'open' && new Date(i.due) > now && (new Date(i.due).getTime() - now.getTime()) < 7 * 86400000);
    const paidThisMonth = invoiceList.filter(i => i.status === 'paid');
    const overdueTotal = overdue.reduce((s, i) => s + parseFloat(String(i.amount).replace('$','') || '0'), 0);

    const collected = reports.totalCollected ?? reports.revenue?.totalCollected ?? 0;
    const feeRevenue = reports.feeRevenue ?? reports.revenue?.feeRevenue ?? 0;
    const paidCount = paidThisMonth.length;

    // Check for new payments since last poll — trigger notification
    if (paidCount > state.lastPaidCount && state.lastPaidCount >= 0) {
      const newCount = paidCount - state.lastPaidCount;
      const newestPaid = paidThisMonth.sort((a, b) => new Date(b.due) - new Date(a.due)).slice(0, newCount);
      for (const inv of newestPaid) {
        sendNotification('Payment received', `${inv.amount} from ${inv.client || 'a client'}`);
      }
    }

    // Check for new overdue — notify on first overdue or increase
    if (overdue.length > state.lastOverdueCount && state.lastOverdueCount >= 0) {
      const increase = overdue.length - state.lastOverdueCount;
      if (increase > 0) {
        sendNotification('Invoice overdue', `${overdue.length} invoice${overdue.length > 1 ? 's' : ''} past due — ${overdueTotal > 0 ? `$${overdueTotal.toFixed(0)} total` : ''}`);
      }
    }

    // Save state
    state.lastPaidCount = paidCount;
    state.lastOverdueCount = overdue.length;
    await chrome.storage.local.set({ [STATE_KEY]: state });

    // Find the most recent paid invoice for the highlight card
    const recentPaid = paidThisMonth.sort((a, b) => new Date(b.due) - new Date(a.due))[0];

    let html = '';

    // Payment alert card
    if (recentPaid) {
      html += `
        <div class="card card--ok card--accent">
          <div class="card__head">
            <span class="card__label">Payment received</span>
            <span class="badge" style="background:#6ae8a0;color:#0a0f0a">${paidCount} this month</span>
          </div>
          <div class="card__value">${recentPaid.amount}</div>
          <div class="card__sub">${recentPaid.client || 'a client'} — paid</div>
        </div>
      `;
    }

    // Overdue card
    html += `
      <div class="card card--danger card--clickable" id="overdue-card">
        <div class="card__head">
          <span class="card__label">Overdue</span>
          <span class="badge">${overdue.length}</span>
        </div>
        <div class="card__value">${overdue.length > 0 ? `$${overdueTotal.toFixed(0)}` : 'None'}</div>
        <div class="card__sub">${overdue.length} invoice${overdue.length !== 1 ? 's' : ''} past due</div>
        <div class="details" id="overdue-details">
          ${overdue.map(i => `
            <div class="detail-row">
              <span>${i.client || 'Unknown'}</span>
              <span><span class="amount">${i.amount}</span> <span class="days">· ${Math.round((now - new Date(i.due)) / 86400000)} days late</span></span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Fee revenue card
    html += `
      <div class="card card--warn">
        <div class="card__label">Fee revenue</div>
        <div class="card__value">$${feeRevenue.toFixed(0)}</div>
        <div class="card__sub">Late fees recovered this month</div>
      </div>
    `;

    // Due soon card
    html += `
      <div class="card card--neutral card--clickable" id="due-card">
        <div class="card__head">
          <span class="card__label">Due soon</span>
          <span class="badge" style="background:#e8b26a">${dueSoon.length}</span>
        </div>
        <div class="card__value">${dueSoon.length}</div>
        <div class="card__sub">${dueSoon.length > 0 ? 'Due within 7 days' : 'Nothing coming up'}</div>
        <div class="details" id="due-details">
          ${dueSoon.map(i => `
            <div class="detail-row">
              <span>${i.client || 'Unknown'}</span>
              <span><span class="amount">${i.amount}</span> <span class="days">· due ${new Date(i.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Wire up click-to-expand
    const overdueCard = document.getElementById('overdue-card');
    const dueCard = document.getElementById('due-card');
    if (overdueCard) {
      overdueCard.addEventListener('click', () => {
        document.getElementById('overdue-details')?.classList.toggle('open');
      });
    }
    if (dueCard) {
      dueCard.addEventListener('click', () => {
        document.getElementById('due-details')?.classList.toggle('open');
      });
    }

    setStatus(`Connected — ${paidCount} paid this month`, 'ok');
  } catch (e) {
    setStatus(`Failed: ${e.message}`, 'err');
    container.innerHTML = `<div class="loading" style="color:#e86a6a">Couldn't reach Dunn. Check your server URL and API token.</div>`;
  }
}

function sendNotification(title, body) {
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '../lighthouse-transparent.png' });
  } catch (e) {
    console.log('Notification:', title, '—', body);
  }
  // Play a cash-register chime for payment notifications
  if (title === 'Payment received') {
    playChime();
  }
}

// Cash register "cha-ching" sound via Web Audio API
let audioCtx;
function playChime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;

    // First note: C5 (523 Hz) — short, percussive
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.frequency.value = 523;
    osc1.type = 'sine';
    gain1.gain.setValueAtTime(0.3, now);
    gain1.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Second note: E5 (659 Hz) — slightly later, longer
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.frequency.value = 659;
    osc2.type = 'sine';
    gain2.gain.setValueAtTime(0.25, now + 0.1);
    gain2.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  } catch (e) {
    // Audio not supported — no big deal
  }
}

function setStatus(text, type) {
  const bar = document.getElementById('status-bar');
  bar.className = `conn-status conn-status--${type}`;
  bar.textContent = text;
}

let refreshInterval;
function startRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(loadData, 60000);
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  startRefresh();
});