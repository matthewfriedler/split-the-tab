# Split the Tab

Split restaurant checks fairly. Snap a photo of each receipt, tap who had each item, and the app works out what everyone owes — with tax, tip and fees shared in proportion to what each person ordered.

## Features

- **Photo scanning**: reads items, tax, tip, fees and totals from a receipt photo, right in the browser (via [Tesseract.js](https://tesseract.projectnaptha.com/)). Nothing is uploaded.
- **Assign items**: tap one or more people per item, or "Shared by all". Items shared by several people are split evenly among them.
- **Fair extras**: fees (like SF mandates) and tip are split by each person's share of the items. Tax only follows *taxed* items, so an untaxed bottle of wine doesn't carry tax.
- **Couples and groups**: mark someone as "Covered by" another person and their costs roll up to that payer.
- **Multiple receipts**: track a whole night out across several bars and restaurants.
- **Settle up**: shows who pays whom, plus a per-receipt breakdown and a copyable summary.
- **Penny-accurate**: all math is done in cents with largest-remainder rounding, so shares always add up to the receipt total.

## Run it

It's a static site, so there is no build step.

- Open `index.html` in a browser, or
- Serve the folder: `npx serve .`, or
- Publish with GitHub Pages (Settings → Pages → deploy from the `main` branch).

Tap **Load example** to see a real three-stop night out.

## Files

| File | What it does |
|---|---|
| `index.html` | The app UI (people, receipts, results) |
| `split.js` | Core logic: splitting math, settle-up, receipt-text parser. No DOM, so it runs in Node too |
| `test.js` | Checks the math against a real night out: `node test.js` |

## How the split works

1. Each item's price is divided evenly among the people who had it.
2. Fees and tip are divided in proportion to each person's item total.
3. Tax is divided in proportion to each person's taxed items.
4. People who are "Covered by" someone are added to that payer's total.
5. Whoever paid each receipt is owed back everyone else's share.

## Roadmap

- Better receipt reading (column-aligned prices, image cleanup before scanning)
- Venmo / payment-request links
- Shareable link so friends can tap their own items
- Save past nights
