// Line items editor, shared by the new-invoice form and the recurring form:
// rows of description · qty · price, a running total, and a search of the
// owner's saved services (every match shows, scrolling; no cap).
//
//   const editor = DunnLines.mount(containerEl, { api });
//   editor.read()     → [{ description, quantity, price }] (blank rows dropped)
//   editor.problem()  → '' or a plain-English error to show
//   editor.set(lines) → fill from [{ description, quantity, unitCents }]
//   editor.saveChecked() → the "Save these services" box
// Needs money.js (parseMoney, formatMoney).
(function () {
  function mount(root, opts) {
    const api = opts.api;
    root.classList.add('wt-lines');
    root.innerHTML =
      '<div class="wt-lines__label">Services</div>' +
      '<div class="wt-lines__head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Price</span><span>Total</span><span></span></div>' +
      '<div class="wt-lines__rows"></div>' +
      '<div class="wt-lines__foot"><button class="wt-lines__add" type="button">+ Add a line</button>' +
      '<div class="wt-lines__total">Total <strong>$0.00</strong></div></div>' +
      '<label class="wt-lines__save"><input type="checkbox" checked> Save these services for next time</label>';
    const rows = root.querySelector('.wt-lines__rows');
    const totalEl = root.querySelector('.wt-lines__total strong');

    function addLine(values) {
      const row = document.createElement('div');
      row.className = 'wt-line';
      row.innerHTML =
        '<div class="wt-line__desc-wrap"><input class="wt-line__desc" placeholder="What you did, e.g. Logo design" aria-label="Description" maxlength="200" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false"></div>' +
        '<input class="wt-line__qty" inputmode="decimal" value="1" aria-label="Quantity">' +
        '<input class="wt-line__price" inputmode="decimal" placeholder="0.00" aria-label="Price">' +
        '<div class="wt-line__total">$0.00</div>' +
        '<button class="wt-line__remove" type="button" aria-label="Remove line">×</button>';
      if (values) {
        row.querySelector('.wt-line__desc').value = values.description || '';
        row.querySelector('.wt-line__qty').value = values.quantity || 1;
        const price = values.unitCents != null ? values.unitCents / 100 : values.price;
        if (price) row.querySelector('.wt-line__price').value = formatMoney(price);
      }
      row.querySelector('.wt-line__remove').addEventListener('click', () => { row.remove(); refresh(); });
      rows.append(row);
      refresh();
      return row;
    }
    function read() {
      return [...rows.querySelectorAll('.wt-line')].map(r => ({
        description: r.querySelector('.wt-line__desc').value.trim(),
        quantity: parseFloat(r.querySelector('.wt-line__qty').value.replace(',', '.')),
        price: parseMoney(r.querySelector('.wt-line__price').value),
      })).filter(l => l.description || Number.isFinite(l.price));
    }
    function problem() {
      const lines = read();
      if (!lines.length) return 'Enter the amount.';
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i], n = lines.length > 1 ? 'Line ' + (i + 1) + ': ' : '';
        // One line can skip the description (a plain invoice); a breakdown can't.
        if (!l.description && lines.length > 1) return n + 'describe the service.';
        if (!Number.isFinite(l.quantity) || l.quantity <= 0) return n + 'the quantity must be more than 0.';
        if (!Number.isFinite(l.price) || l.price <= 0) return n + 'enter a price greater than $0.';
      }
      return '';
    }
    function refresh() {
      let total = 0;
      const all = [...rows.querySelectorAll('.wt-line')];
      all.forEach(r => {
        const q = parseFloat(r.querySelector('.wt-line__qty').value.replace(',', '.'));
        const p = parseMoney(r.querySelector('.wt-line__price').value);
        const t = Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p * 100) / 100 : 0;
        total += t;
        r.querySelector('.wt-line__total').textContent = '$' + formatMoney(t);
        r.querySelector('.wt-line__remove').hidden = all.length === 1;
        r.querySelector('.wt-line__desc').placeholder = all.length === 1 ? "What's it for? (optional)" : 'Describe this service';
      });
      totalEl.textContent = '$' + formatMoney(total);
    }
    function set(lines) {
      rows.replaceChildren();
      (lines && lines.length ? lines : [null]).forEach(l => addLine(l));
    }

    // Saved services: type to search, pick to fill description + price.
    let services = [];
    function loadServices() { api('GET', '/services').then(r => { services = r.services || []; }).catch(() => {}); }
    loadServices();
    let suggest = null, activeIdx = -1;
    function closeSuggest() {
      if (suggest) { suggest.previousElementSibling && suggest.previousElementSibling.setAttribute('aria-expanded', 'false'); suggest.remove(); }
      suggest = null; activeIdx = -1;
    }
    function openSuggest(input) {
      closeSuggest();
      const q = input.value.trim().toLowerCase();
      const matches = services.filter(sv => !q || sv.name.toLowerCase().includes(q));
      if (!matches.length || (matches.length === 1 && matches[0].name.toLowerCase() === q)) return;
      suggest = document.createElement('ul');
      suggest.className = 'wt-suggest'; suggest.setAttribute('role', 'listbox');
      matches.forEach(sv => {
        const li = document.createElement('li'); li.setAttribute('role', 'option');
        const n = document.createElement('span'); n.textContent = sv.name;
        const p = document.createElement('span'); p.textContent = '$' + formatMoney(sv.unitCents / 100);
        li.append(n, p);
        li.addEventListener('mousedown', e => { e.preventDefault(); pick(input, sv); });
        suggest.append(li);
      });
      input.after(suggest); input.setAttribute('aria-expanded', 'true');
    }
    function pick(input, sv) {
      const row = input.closest('.wt-line');
      input.value = sv.name;
      row.querySelector('.wt-line__price').value = formatMoney(sv.unitCents / 100);
      closeSuggest(); refresh();
      row.querySelector('.wt-line__qty').focus();
    }
    rows.addEventListener('input', e => { refresh(); if (e.target.matches('.wt-line__desc')) openSuggest(e.target); });
    rows.addEventListener('focusin', e => { if (e.target.matches('.wt-line__desc')) openSuggest(e.target); });
    rows.addEventListener('focusout', e => { if (e.target.matches('.wt-line__desc')) setTimeout(closeSuggest, 100); });
    rows.addEventListener('keydown', e => {
      // Enter in a line never submits the surrounding form by accident.
      if (e.key === 'Enter' && !suggest) { e.preventDefault(); return; }
      if (!suggest || !e.target.matches('.wt-line__desc')) return;
      const items = [...suggest.children];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((li, i) => li.classList.toggle('is-active', i === activeIdx));
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        const name = items[activeIdx].firstChild.textContent;
        pick(e.target, services.find(sv => sv.name === name));
      } else if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); }
    });
    root.querySelector('.wt-lines__add').addEventListener('click', () => addLine().querySelector('.wt-line__desc').focus());

    set();
    return {
      read, problem, set, refresh, reloadServices: loadServices,
      saveChecked: () => root.querySelector('.wt-lines__save input').checked,
    };
  }
  window.DunnLines = { mount };
})();
