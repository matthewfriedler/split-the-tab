// Run with: node test.js
const assert = require('assert');
const C = require('./split.js');

// A real night out (3 receipts, 5 people, 3 payers) — expected numbers were worked out by hand.
const res = C.computeAll(C.demoState());
const g = res.groups;
const by = (id) => Object.values(g[id].perReceipt).map(C.money);

assert.deepStrictEqual(by('fr'), ['$56.31', '$105.42', '$32.30']);
assert.deepStrictEqual(by('me').slice(0, 2), ['$18.77', '$96.07']);
assert.strictEqual(C.money(res.grand), '$418.52');
assert.strictEqual(C.money(g.fr.total + g.me.total + g.rm.total), '$418.52');

// Each receipt splits back to exactly its total.
res.receipts.forEach((r) => {
  const sum = Object.values(r.rows).reduce((s, x) => s + x.total, 0);
  assert.strictEqual(sum, r.computed);
  if (r.printed != null) assert.strictEqual(r.computed, r.printed);
});

// Rounding never loses a cent.
const a = C.allocate(100, { a: 1, b: 1, c: 1 });
assert.strictEqual(a.a + a.b + a.c, 100);

// Receipt text parsing.
const p = C.parseReceiptText([
  'LOBALITA', '2 HORCHATA COLADA $28.00', 'Side Pita x 2 $8.00', 'SF Business Mandates (5.00%) $3.50',
  'Subtotal $73.50', 'Tax $6.35', 'Tip $14.00', 'Total $93.85', 'Visa xxxx9981 93.85', '+ 2%: (Tip $1.40 Total $81.25)',
].join('\n'));
assert.strictEqual(p.items.length, 4);
assert.strictEqual(p.items[0].price, '14.00');
assert.strictEqual(p.tax, '6.35');
assert.strictEqual(p.tip, '14.00');
assert.strictEqual(p.total, '93.85');
assert.strictEqual(p.fees.length, 1);

console.log('All tests passed ✓');
