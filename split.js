/* Split the Tab — core logic (no DOM). Runs in the browser and in Node for tests. */
(function (root) {
  'use strict';

  // ---------- money helpers (everything is integer cents internally) ----------
  const cents = (v) => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const money = (c) => (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toFixed(2);
  const uid = () => Math.random().toString(36).slice(2, 9);

  // Split `total` cents across ids in proportion to `weights`, using the
  // largest-remainder method so the pieces always add back up to the total.
  function allocate(total, weights) {
    const ids = Object.keys(weights);
    const out = {};
    ids.forEach((id) => (out[id] = 0));
    const pos = ids.filter((id) => weights[id] > 0);
    const sum = pos.reduce((a, id) => a + weights[id], 0);
    if (!total || !sum) return out;
    const sign = total < 0 ? -1 : 1;
    const abs = Math.abs(total);
    let used = 0;
    const rems = pos.map((id) => {
      const exact = (abs * weights[id]) / sum;
      const f = Math.floor(exact + 1e-9);
      out[id] = f;
      used += f;
      return [id, exact - f];
    });
    rems.sort((a, b) => b[1] - a[1]);
    for (let i = 0; used < abs; i++, used++) out[rems[i % rems.length][0]]++;
    if (sign < 0) ids.forEach((id) => (out[id] = -out[id]));
    return out;
  }

  // Who ultimately pays for this person (follows "covered by" links).
  function payerOf(people, pid) {
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    let cur = pid;
    for (let i = 0; i < people.length; i++) {
      const p = byId[cur];
      if (!p || !p.payer || p.payer === cur || !byId[p.payer]) return cur;
      cur = p.payer;
    }
    return cur;
  }

  const tipCents = (r, itemsTotal) =>
    r.tipMode === 'pct'
      ? Math.round((itemsTotal * (parseFloat(r.tip) || 0)) / 100)
      : cents(r.tip);

  // Split one receipt per person.
  //  - Items: split evenly among the people assigned to them.
  //  - Fees + tip: in proportion to each person's item total.
  //  - Tax: in proportion to each person's *taxed* items (e.g. untaxed wine).
  // Allocate across payer groups first (so each group's share is rounded once),
  // then split each group's piece among its members.
  function allocateGrouped(total, weights, groupOf) {
    const gW = {};
    Object.keys(weights).forEach((id) => {
      const g = groupOf(id);
      gW[g] = (gW[g] || 0) + weights[id];
    });
    const gA = allocate(total, gW);
    const out = {};
    Object.keys(gA).forEach((g) => {
      const members = {};
      Object.keys(weights).forEach((id) => { if (groupOf(id) === g) members[id] = weights[id]; });
      Object.assign(out, allocate(gA[g], members));
    });
    return out;
  }

  function computeReceipt(r, people, groupOf) {
    groupOf = groupOf || ((id) => id);
    const ids = people.map((p) => p.id);
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    const items = zero();
    const taxable = zero();
    let itemsTotal = 0;
    let unassigned = 0;

    (r.items || []).forEach((it) => {
      const c = cents(it.price);
      itemsTotal += c;
      const who = (it.people || []).filter((id) => ids.includes(id));
      if (!who.length) {
        unassigned += c;
        return;
      }
      const share = allocate(c, Object.fromEntries(who.map((id) => [id, 1])));
      who.forEach((id) => {
        items[id] += share[id];
        if (it.taxable !== false) taxable[id] += share[id];
      });
    });

    const feeTotal = (r.fees || []).reduce((s, f) => s + cents(f.amount), 0);
    const tax = cents(r.tax);
    const tip = tipCents(r, itemsTotal);
    const hasTaxable = ids.some((id) => taxable[id] > 0);

    const feeA = allocateGrouped(feeTotal, items, groupOf);
    const taxA = allocateGrouped(tax, hasTaxable ? taxable : items, groupOf);
    const tipA = allocateGrouped(tip, items, groupOf);

    const rows = {};
    ids.forEach((id) => {
      rows[id] = {
        items: items[id],
        fees: feeA[id],
        tax: taxA[id],
        tip: tipA[id],
        total: items[id] + feeA[id] + taxA[id] + tipA[id],
      };
    });

    const computed = itemsTotal + feeTotal + tax + tip;
    const printed = String(r.total || '').trim() ? cents(r.total) : null;
    return { rows, itemsTotal, feeTotal, tax, tip, computed, printed, unassigned };
  }

  // Turn balances (positive = is owed money) into a short list of payments.
  function settle(balances) {
    const cred = [];
    const debt = [];
    Object.entries(balances).forEach(([id, v]) => {
      if (v > 0) cred.push([id, v]);
      else if (v < 0) debt.push([id, -v]);
    });
    cred.sort((a, b) => b[1] - a[1]);
    debt.sort((a, b) => b[1] - a[1]);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i][1], cred[j][1]);
      if (amt > 0) out.push({ from: debt[i][0], to: cred[j][0], amount: amt });
      debt[i][1] -= amt;
      cred[j][1] -= amt;
      if (!debt[i][1]) i++;
      if (!cred[j][1]) j++;
    }
    return out;
  }

  function computeAll(state) {
    const people = state.people || [];
    const groups = {};
    people.forEach((p) => {
      const g = payerOf(people, p.id);
      if (!groups[g])
        groups[g] = { id: g, members: [], perReceipt: {}, items: 0, fees: 0, tax: 0, tip: 0, total: 0, paid: 0 };
      groups[g].members.push(p.id);
    });
    // Payer first in each member list.
    Object.values(groups).forEach((g) => g.members.sort((a, b) => (a === g.id ? -1 : b === g.id ? 1 : 0)));

    const receipts = (state.receipts || []).map((r) => {
      const res = computeReceipt(r, people, (id) => payerOf(people, id));
      res.id = r.id;
      res.groupRows = {};
      Object.keys(groups).forEach((g) => (res.groupRows[g] = { items: 0, fees: 0, tax: 0, tip: 0, total: 0 }));
      people.forEach((p) => {
        const g = payerOf(people, p.id);
        ['items', 'fees', 'tax', 'tip', 'total'].forEach((k) => {
          res.groupRows[g][k] += res.rows[p.id][k];
          groups[g][k] += res.rows[p.id][k];
        });
      });
      Object.keys(groups).forEach((g) => (groups[g].perReceipt[r.id] = res.groupRows[g].total));
      if (r.paidBy && people.some((p) => p.id === r.paidBy))
        groups[payerOf(people, r.paidBy)].paid += res.computed - res.unassigned;
      return res;
    });

    const balances = {};
    Object.values(groups).forEach((g) => (balances[g.id] = g.paid - g.total));
    return {
      groups,
      receipts,
      transfers: settle(balances),
      grand: receipts.reduce((s, r) => s + r.computed, 0),
    };
  }

  // ---------- receipt text (OCR) -> draft fields ----------
  function parseReceiptText(text) {
    const res = { name: '', items: [], tax: '', tip: '', fees: [], total: '' };
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const priceRe = /(-?\$?\s?\d{1,4}[.,]\d{2})\s*$/;
    const payRe = /(visa|master|amex|discover|credit|debit|card|cash|change|balance|auth|approv|payment|xxxx|aid\s)/i;

    const firstWords = lines.find((l) => /[a-z]{3,}/i.test(l) && !priceRe.test(l));
    if (firstWords) res.name = firstWords.replace(/[^A-Za-z0-9 '&-]/g, '').trim().slice(0, 40);

    lines.forEach((line) => {
      if (/suggested|\+\s*\d+\s*%/i.test(line)) return;
      const m = line.match(priceRe);
      if (!m) return;
      const amount = m[1].replace(/[$\s]/g, '').replace(',', '.');
      const label = line.slice(0, m.index).replace(/[.\s$:]+$/, '').trim();
      const L = label.toLowerCase();

      if (/sub\s*-?\s*total/.test(L)) return;
      if (/\btotal\b|amount due/.test(L)) {
        if (!res.total) res.total = amount;
        return;
      }
      if (/\btax\b/.test(L)) return void (res.tax = amount);
      if (/\btip\b|gratuity/.test(L)) return void (res.tip = amount);
      if (payRe.test(line)) return;
      if (/mandate|ordinance|surcharge|service|\bfee\b|\bsf\b/.test(L)) {
        res.fees.push({ id: uid(), label: label.slice(0, 40) || 'Fee', amount });
        return;
      }
      if (!/[a-z]{2,}/i.test(label)) return;

      // Quantity: "2 Horchata Colada" or "Side Pita x 2"
      let qty = 1;
      let name = label;
      let q = name.match(/^(\d{1,2})\s*[x×]?\s+(.+)$/i);
      if (q) { qty = +q[1]; name = q[2]; }
      else if ((q = name.match(/^(.+?)\s*[x×]\s*(\d{1,2})$/i))) { name = q[1]; qty = +q[2]; }
      qty = Math.max(1, Math.min(qty, 20));

      const totalC = cents(amount);
      const each = Math.floor(totalC / qty);
      for (let k = 0; k < qty; k++) {
        const c = each + (k === 0 ? totalC - each * qty : 0);
        res.items.push({ id: uid(), name: name.trim(), price: (c / 100).toFixed(2), people: [], taxable: true });
      }
    });
    return res;
  }

  // ---------- example data (a real night out, names made generic) ----------
  function demoState() {
    const P = (id, name, payer) => ({ id, name, payer: payer || '' });
    const people = [P('me', 'Me'), P('pt', 'Partner', 'me'), P('fr', 'Friend'), P('fp', "Friend's partner", 'fr'), P('rm', 'Roommate')];
    const ALL = people.map((p) => p.id);
    const ME = ['me', 'pt'];
    const FR = ['fr', 'fp'];
    const RM = ['rm'];
    const I = (name, price, who, taxable = true) => ({ id: uid(), name, price: Number(price).toFixed(2), people: who.slice(), taxable });
    const F = (label, amount) => ({ id: uid(), label, amount });
    return {
      people,
      active: 0,
      receipts: [
        {
          id: uid(), name: 'Lobalita', paidBy: 'me', tax: '6.35', tip: '14.00', tipMode: 'amt', total: '93.85',
          fees: [F('SF Business Mandates', '3.50')],
          items: [I('La Loba', 14, FR), I('Horchata Colada', 14, ME), I('Horchata Colada', 14, RM), I('Lolo-Lito', 14, FR), I('Lolo-Lito', 14, FR)],
        },
        {
          id: uid(), name: 'Roaming Goat', paidBy: 'me', tax: '9.40', tip: '35.80', tipMode: 'amt', total: '233.15',
          fees: [F('SF Mandates', '8.95')],
          items: [
            I('Trio of Dips', 18, ALL), I('Side Pita', 4, ALL), I('Side Pita', 4, ALL), I('Aleppo Potatoes', 12, ALL),
            I('Burrata', 15, ALL), I('Champalou Vouvray 2024', 70, ALL, false), I('Lamb Loin', 24, FR),
            I('Merguez Sausage', 17, ME), I('Crisp Brussels Sprouts', 15, ME.concat(FR)),
          ],
        },
        {
          id: uid(), name: 'Palm House', paidBy: 'me', tax: '6.18', tip: '20', tipMode: 'pct', total: '91.52',
          fees: [F('Cost of SF ordinances', '3.74')],
          items: [I('Margarita', 13, FR), I('Vodka Soda', 11, ME), I('Vodka Soda', 11, ME), I('Vodka Soda', 11, ME), I('Tequila Soda', 11, RM), I('Gin & Tonic', 11, FR)],
        },
      ],
    };
  }

  const api = { cents, money, uid, allocate, payerOf, computeReceipt, computeAll, settle, parseReceiptText, demoState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
