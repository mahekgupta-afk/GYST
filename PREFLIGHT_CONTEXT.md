# Preflight: Conversational Shipment Booking and "Pre-Flight" Error Checker

Full context for Claude Code. This file covers the hackathon problem statement, the fixed test data and rules, every design decision made so far, the state of the working prototype, its known limits, and what to do next. Read it fully before touching code.

---

## 0. Quick brief (paste this first)

> You are continuing a hackathon project called **Preflight**. The goal is an MVP that lets a seller book a UK-to-EU shipment through chat or by uploading a spreadsheet, and that catches paperwork mistakes before the shipment leaves. Judges will test it via a link with no login and no help from us, so it must be self-explanatory and work without any account.
>
> A working single-file prototype already exists (see section 8 for the file layout). Read `PREFLIGHT_CONTEXT.md` end to end, then read `engine.js`, `chat.js`, `ui.js` and `template.html`. Do not rewrite the rulebook or carrier logic: they are tested and match the case. Your job is the next steps in section 12.
>
> Hard constraints: the ten rules in section 4 are the only rules judges test. The carrier rate card in section 5 is fixed. Checks must be deterministic code, never LLM arithmetic. The same booking must produce the same result from chat and from file upload.

---

## 1. The problem statement (verbatim from the case)

### Case 2: Conversational Shipment Booking and "Pre-Flight" Error Checker

Booking a cross-border shipment means filling long, confusing forms. Small mistakes in them cause most of the pain later: goods held at customs or units reported missing at the receiving warehouse. Sellers often only find out days later, when their stock is already stuck.

**Build a solution that makes booking a shipment easy and catches mistakes before the shipment leaves.**

Reference companies:
- **Flexport**: freight forwarder that lets businesses book and track international shipments online.
- **Amazon**: sellers sending stock into Amazon warehouses must label cartons and match counts exactly to what they declared.
- **Delhivery**: Indian logistics company offering freight and cross-border shipping for businesses.

Key terms:
- **Commercial invoice**: the document listing what is in a shipment, how many, and what it is worth. Customs relies on it.
- **HS code**: an international code that classifies every product for customs.
- **Declared value**: the total value of the goods as stated on the paperwork.
- **Carton / pallet**: a carton is a box of units; a pallet is a platform holding many cartons.
- **Customs hold**: when customs stops a shipment until a problem with it is fixed.
- **Delivery appointment**: a booked time slot at the receiving warehouse.
- **Transit time**: how many days a shipment takes to arrive.

Primer reading: the UK government guide to creating an export (commercial) invoice on business.gov.uk.

### How the MVP will be tested

**Part 1, conversation (no file)**
- Judges describe a shipment in plain language, the way a seller would, often leaving details out.
- The solution must ask only for what is missing and end up with a complete booking.
- Judges change a detail mid-conversation (for example, add a pallet) and check that the booking and its checks update.

**Part 2, file upload**
- Judges upload their own Bookings and Items sheets in the template format. Some bookings contain planted mistakes that break the rulebook.

**For every booking, from either part, judges expect:**
- What is wrong, how serious it is, and how to fix it.
- A recommended carrier option based on the seller's priority, with the reason, then a confirmation the seller can understand and what happens next.
- Judges assess the reasoning and how clearly the solution explains its decisions. There is no single right answer.
- The link must work for judges without our help or a login.

### Competition context
80+ teams; only 10 are selected for their MVP. Judging weighs explanation quality and a clean, self-explanatory experience as much as raw error catching.

---

## 2. Our reading of the problem

- It is a **shipment booking tool with a built-in pre-flight checker**. Sellers ship from the UK to Germany, France or the Netherlands.
- There are **two input paths** (chat, and Excel upload of Sheets 1 and 2) and they must give the **same output**.
- Sheets 3 (carrier options) and 4 (rulebook) are fixed and judges never upload them, so they are hard-coded.
- **Three outputs per booking**: (1) issues with severity and fix, (2) recommended carrier with reason, (3) plain-language confirmation with next steps. The carrier recommendation is easy to forget because it is not "error checking".
- A voice agent is **not** required. We did not build one.
- The chat agent builds the booking, not just reviews it: it must ask only for what is missing and re-run checks when a detail changes.
- R-05 couples error checking with carrier choice: weight per pallet is checked against the chosen carrier's limit.

---

## 3. Test data format (judges upload only Sheets 1 and 2)

The template is a spreadsheet with these sheets: **Bookings**, **Items**, **Carrier options**, **Rulebook**, **Allowed values**, **Field guide**, **Glossary**. Sheets 3 and 4 are fixed.

### Physical layout of Bookings and Items sheets
- Row 1: a title banner (for example "Bookings — one row per record. Row 3 is an example (grey); enter data from row 4.").
- Row 2: the column headers.
- Row 3: a grey example row (BK-001).
- Row 4 onward: data.
- The parser therefore finds the header row by searching for a cell equal to "Booking ID", and maps columns by normalised header name, never by position. The example row is treated as a normal booking (it is a clean one, so it simply passes).

### Sheet 1: Bookings (one row per shipment)

| Column | Meaning | Format | Example |
|---|---|---|---|
| Booking ID | Reference label | ID | BK-001 |
| Seller name | Business sending the goods | Any text | Northfield Goods |
| Origin city | Collection city | London, Manchester, Birmingham, Leeds | Manchester |
| Origin country | | United Kingdom | United Kingdom |
| Destination city | Delivery city | Germany: Berlin, Frankfurt, Hamburg. France: Paris, Lyon. Netherlands: Amsterdam, Rotterdam | Frankfurt |
| Destination country | | Germany, France, Netherlands | Germany |
| Destination type | Kind of receiving site | Warehouse / Business address | Warehouse |
| Ready to ship date | Day goods are packed and ready for collection | Date, DD-MM-YYYY | 05-11-2026 |
| Seller priority | What matters most | Cheapest / Fastest / Most reliable / Balanced | Cheapest |
| Pallets | Number of pallets, as the seller states it | Number | 3 |
| Cartons | Total cartons, as the seller states it | Number | 90 |
| Total declared value | Total value, as the seller states it | Number | 5400 |
| Currency | Currency of every money value | GBP only | GBP |
| Total gross weight (kg) | Everything shipped, incl. cartons and pallets, as the seller states it | Number | 620 |
| Delivery appointment booked | Whether a slot is booked at the receiving site | Yes / No | Yes |

Seller priority definitions: *Most reliable* = highest on-time rate. *Balanced* = no strong preference, best trade-off of cost, speed and reliability.

### Sheet 2: Items (one row per product in a booking)

| Column | Meaning | Format | Example |
|---|---|---|---|
| Booking ID | Matches Sheet 1 | ID | BK-001 |
| SKU | Seller's product code | Any text | MUG-01 |
| Description | Plain description | Any text | Ceramic coffee mug, 350 ml |
| HS code | Customs code as stated by the seller | Number, **may be blank** | 691200 |
| Quantity (units) | Total units of this product | Number | 1080 |
| Unit price | Price of one unit, GBP | Number | 5.00 |
| Units per carton | Units packed in one carton | Number | 12 |
| Cartons | Cartons of this product | Number | 90 |
| Unit weight (kg) | Weight of one unit | Number | 0.5 |
| Country of origin | Where the product was made (not where it ships from) | United Kingdom, China, India, Vietnam, Turkey, Germany. **May be blank** | United Kingdom |

Values marked "as the seller states it" may be wrong. Checking them is the job.

### Allowed values (test data uses only these)

| Field | Allowed |
|---|---|
| Origin country | United Kingdom |
| Origin city | London, Manchester, Birmingham, Leeds |
| Destination country | Germany, France, Netherlands |
| Destination city | Germany: Berlin, Frankfurt, Hamburg. France: Paris, Lyon. Netherlands: Amsterdam, Rotterdam |
| Currency | GBP only |
| Country of origin (items) | United Kingdom, China, India, Vietnam, Turkey, Germany |

Every test shipment goes from the UK to Germany, France or the Netherlands.

---

## 4. The rulebook (Sheet 4, fixed, the only rules tested)

| Rule | Check | Severity |
|---|---|---|
| R-01 | Every item must have an HS code of at least 6 digits | Red |
| R-02 | Total declared value must equal the sum of quantity × unit price across all items (within 1%) | Red |
| R-03 | For each item, units per carton × cartons must equal quantity | Red |
| R-04 | Total cartons on the booking must equal the sum of cartons across all items | Red |
| R-05 | Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet | Red |
| R-06 | No lithium batteries, aerosols or flammable liquids | Red |
| R-07 | Total gross weight must be at least the sum of unit weight × quantity across all items | Amber |
| R-08 | Shipments to a warehouse must have a delivery appointment booked | Amber |
| R-09 | Every item must have a country of origin | Amber |
| R-10 | Ready to ship date must not be in the past | Amber |

Glossary: **Red** = the shipment must not go until fixed. **Amber** = risky, should be fixed or checked.

---

## 5. Carrier options (Sheet 3, fixed rate card)

| Carrier | Service | To | Price per pallet (GBP) | Transit (days) | On-time (%) | Max kg per pallet |
|---|---|---|---|---|---|---|
| Carrier A | Road economy | Germany | 180 | 5 | 92 | 500 |
| Carrier B | Road standard | Germany | 220 | 3 | 95 | 750 |
| Carrier C | Road express | Germany | 340 | 2 | 98 | 400 |
| Carrier A | Road economy | France | 170 | 5 | 92 | 500 |
| Carrier B | Road standard | France | 210 | 3 | 95 | 750 |
| Carrier C | Road express | France | 330 | 2 | 98 | 400 |
| Carrier A | Road economy | Netherlands | 160 | 5 | 92 | 500 |
| Carrier B | Road standard | Netherlands | 200 | 3 | 95 | 750 |
| Carrier C | Road express | Netherlands | 320 | 2 | 98 | 400 |

All routes originate in the United Kingdom. Currency GBP. Judges use exactly this card.

### Structural insights that shaped the logic
- Natural winners: Cheapest = A, Fastest = C, Most reliable = C, Balanced = B.
- **Carrier C has the lowest weight limit (400 kg/pallet)** yet is the one sellers pick for speed or reliability, so heavy loads often make the priority-matching carrier break R-05.
- Only Carrier B accepts pallets above 500 kg. Above 750 kg/pallet no carrier works, so the fix is more pallets, not a different carrier.
- Pricing is per pallet, so total = pallets × price. Adding pallets to fix weight raises cost, so every pallet-based fix shows its cost.

---

## 6. Design decisions (and why)

### 6.1 Deterministic checks, AI only for language
All ten rules, the arithmetic and the carrier ranking are plain code. An LLM is used only (optionally) to read free text in chat. Reason: judges plant mistakes that map to rules, and arithmetic like "units per carton × cartons = quantity" must never be hallucinated.

### 6.2 The "chosen carrier" for R-05
- `preferred` = best carrier for the seller's priority, **ignoring weight**.
- `recommended` = best carrier for the priority **among carriers that can take the weight**.
- `selected` = the carrier the user picked, defaulting to `preferred`.
- **R-05 is evaluated against `selected`.**

Why default to `preferred`, not `recommended`: a planted R-05 error (for example "Cheapest" with 620 kg on one pallet, Carrier A limit 500) must be visible. If we silently switched carriers the error would vanish and the judges would not see it detected. Instead we flag R-05 against the first-choice carrier, recommend the best working alternative with the reason, and offer a one-click switch (which then clears R-05) or a pallet split.

### 6.3 Balanced scoring
Min-max normalise price (inverted), transit time (inverted) and on-time rate across the candidate carriers, then score = 0.4 × cost + 0.3 × speed + 0.3 × reliability. Ties break to lowest price. The weights are shown in the UI. Carrier B wins on the current card.

Other priorities and tie-breaks:
- Cheapest: lowest price, then fastest, then most reliable.
- Fastest: lowest transit, then highest on-time, then lowest price.
- Most reliable: highest on-time, then fastest, then lowest price.
- Missing or unknown priority defaults to Balanced and the UI says it was assumed.

### 6.4 Missing data is not a rule break
Blank or unreadable inputs (no pallets, no gross weight, non-numeric quantity, no items, unsupported destination country, bad date) produce a separate Red pseudo-rule labelled **DATA / "Missing data"**, and the rules that depend on that input are marked n/a instead of firing spuriously.

### 6.5 Business address and R-08
R-08 only applies when destination type is Warehouse. In chat, if the destination is a Business address the appointment answer is set to "No" automatically without asking.

### 6.6 Chat derives what it can, asks for the rest
- Booking ID is auto-set (BK-001), SKU is auto-generated from the description.
- For a single product, if the seller states total cartons and item cartons are missing, item cartons = booking cartons (and the user is told).
- Otherwise item cartons = quantity ÷ units per carton when it divides exactly (and the user is told).
- Totals (pallets, cartons, gross weight, declared value) are asked last, with hints showing what the products add up to. The seller's stated totals are never overwritten, so mismatches (R-02, R-04, R-07) still surface.
- HS code and country of origin may legitimately be blank. The bot asks once; "I don't know" leaves them blank and the checks flag them.

### 6.7 The verdict motif
A rubber-stamp style badge (HOLD / CHECK / CLEAR) rotated slightly, with a ten-cell rule strip (Pass / Fail / Warn / n/a). This is the one memorable visual element; everything else is quiet. Typefaces: Bricolage Grotesque (display) and Hanken Grotesk (body), with system fallbacks. Light and dark themes via CSS variables.

---

## 7. Engine specification (what the code does)

### 7.1 Rule implementations (`evaluate(booking, {todayISO})`)

Each issue has: `rule`, `sev` (red/amber), `title`, `what` (numbers included), `fix` (concrete action), optional `item` (SKU).

- **R-01**: per item. Blank HS fails. Non-digit characters (other than spaces, dots, dashes) fail. Fewer than 6 digits fails. A numeric 5-digit code gets a note that a leading zero may have been dropped by the spreadsheet (chapters 01–09 start with 0), so HS codes are read as text where possible.
- **R-02**: declared vs Σ(qty × unit price). Fails when |declared − sum| ÷ sum > 1%. Message shows both numbers and the percentage.
- **R-03**: per item. Fails when upc × cartons ≠ qty. Fix text states what cartons should be if the quantity is right, or what the quantity should be if the cartons are right, or reports the leftover units if qty is not a whole number of cartons.
- **R-04**: booking cartons vs Σ item cartons.
- **R-05**: wpp = gross weight ÷ pallets, versus the selected carrier's max. Fix lists: switch to the recommended carrier (with total cost), or keep the selected carrier with the minimum pallet count (`ceil(weight ÷ max)`) and its cost. When no carrier fits, it lists the minimum pallets and cost per carrier.
- **R-06**: keyword detection on description + SKU (see 7.2).
- **R-07**: gross weight < Σ(unit weight × qty). The fix warns if the corrected weight would break the selected carrier's limit.
- **R-08**: Warehouse and appointment ≠ Yes.
- **R-09**: blank country of origin, per item.
- **R-10**: ready date earlier than today. Uses the real current date from the browser. Today's date is displayed in the page header. The date comparison is on calendar days, so "today" passes.

Result object: `{issues, rec, counts:{red,amber}, status ('blocked'|'warning'|'clear'), ruleStatus{R-01..R-10: pass|red|amber|na}, calc, today}`.

### 7.2 R-06 hazard detection
Regex groups on the description (and SKU): lithium / li-ion / li-po / power bank / e-cigarette / vape; generic "battery" (treated as possibly lithium); aerosol / spray paint / spray can / hairspray / body spray / deodorant spray / dry shampoo / canned air / pressurised can; flammable liquids (flammable, petrol, gasoline, kerosene, lighter fluid, white spirit, turpentine, acetone, methylated spirits, denatured alcohol, paint thinner, nail polish remover, butane, propane, isopropyl, rubbing alcohol, hand sanitiser, alcohol-based).
Negations are stripped first: non-flammable, not flammable, non-aerosol, battery-free, lithium-free, no battery, without battery, batteries not included, non-lithium.
Generic "spray" alone is deliberately not flagged. Foods such as olive oil pass. The list is not exhaustive. An optional "second opinion" button asks Claude to review descriptions for restricted goods that avoid the keywords (advisory only, not one of the ten rules).

### 7.3 Spreadsheet reading (`parseWorkbook`)
- Uses SheetJS 0.18.5. Reads xlsx, xls, xlsm and ods.
- Picks sheets named Bookings and Items (ignores Carrier options, Rulebook, Allowed values, Field guide, Glossary), falling back to the first two.
- Header row located by "Booking ID" within the first 15 rows. Columns matched by normalised header.
- Dates accepted as Excel serial numbers, JS dates, `DD-MM-YYYY` text (also with `/` or `.`), or ISO text.
- Numbers accept strings such as "1,080" or "£5400". Blank stays null (not 0), because blank HS and blank country of origin are meaningful.
- Orphan items (no matching Booking ID) produce a visible warning. Bookings with no items produce a DATA issue.
- Appointment normalised to Yes/No; destination type to Warehouse/Business address; unknown priority becomes assumed Balanced.

### 7.4 Confirmation and next steps (`summarise`)
- Blocked: "Not ready to ship yet", the count of red and amber issues, "Nothing has been booked", and steps to fix and re-check.
- Warning or clear: a one-sentence shipment summary, carrier, collection date, estimated delivery (collection + transit days, calendar days), total price, and next steps (collection, commercial invoice matching the booking, appointment note or recipient note, tracking).
- The Confirm button is disabled while any red issue exists. Confirming is a demo and contacts no real carrier.

---

## 8. Repository layout (source files provided alongside this document)

```
preflight-src/
  engine.js        Reference data, rules R-01..R-10, carrier logic, spreadsheet reading, sample data
  chat.js          Chat state machine, built-in language parser, AI merge helpers
  ui.js            All DOM rendering and interactions (no framework)
  template.html    Page shell, CSS tokens and layout, script placeholders
  build.py         Inlines engine.js + chat.js + ui.js into template.html -> preflight.html
  preflight.html   Built single-file output (this is what was published)
  tests/           Node test scripts (t1..t8), see section 10
  Preflight_test_bookings_with_planted_errors.xlsx   14-booking test file
```

Build: `python3 build.py` produces `preflight.html`. Tests need `npm install xlsx@0.18.5 jsdom`.

The engine files are plain scripts that attach to `window.PF` (or `globalThis.PF` in Node), so they can be required directly in tests. Converting them to ES modules is a reasonable refactor (see section 12).

---

## 9. The chat layer in detail

### 9.1 Flow (`nextAsk`)
Asks in this order, skipping anything already known:
1. Seller name
2. Route (origin and destination city; falls back to separate origin/destination questions; if only the destination country is known, asks for the city in that country)
3. Destination type (chips: Warehouse / Business address)
4. Delivery appointment (only for warehouses; chips Yes / No)
5. Ready date (DD-MM-YYYY, also accepts "5 Nov", "tomorrow", "next Friday", "in 3 days")
6. Priority (chips)
7. Products, one at a time: description + quantity, unit price, units per carton, cartons (often derived), unit weight, HS code, country of origin; then "Is that everything, or another product?"
8. Totals: pallets, cartons, gross weight, declared value (only the missing ones, in one question, with hints)
9. Complete: runs `evaluate`, posts a short summary in chat, and the full detail appears in the right-hand panel.

Questions have optional `chips` (quick replies) and `hint` (shown when the reply isn't understood, for example the allowed cities).

### 9.2 Built-in language understanding (no AI needed)
`extractAll(text)` pulls as many fields as it can from one message by consuming matched text so later patterns don't double-count. It handles: seller ("I'm X", "we are X", "seller is X"), cities and countries, warehouse vs business address, appointment yes/no phrases, priority words, dates, declared value, unit price vs total value (£5 each vs declared £5,400), unit weight vs gross weight (0.5 kg each vs 620 kg), pallets, cartons, units per carton, HS code, explicit country of origin phrases ("made in UK"), product description and quantity ("1,080 ceramic mugs").

A short reply is interpreted using the question just asked (`answerFor`), so "3", "yes", "UK", "Fastest" work. Unit hints help: "200g" becomes 0.2 kg.

### 9.3 Mid-conversation changes
- Relative: "add a pallet", "add 2 cartons", "another pallet", "remove a pallet", "one fewer carton".
- Absolute: "make it 4 pallets", "change priority to Fastest", "update the weight to 800kg", "set the HS code to 691200", "the quantity is 700", "use Carrier B".
- Each change prints "Updated X from A to B", re-runs all checks, and shows before/after red and amber counts.
- "Confirm booking" confirms if no red issues; "start over" / "new booking" resets.

### 9.4 Optional AI path (Claude via the artifact `sample` capability)
When available, each user message sends the current booking JSON, the question just asked and the new message to Claude, which returns the full updated booking as JSON. The code sanitises it: allowed cities and countries only, numbers parsed, enums validated, only non-null values applied, no arithmetic by the model. Instructions tell the model not to correct the seller's numbers and to treat "add a pallet" as current + 1. On any failure (malformed JSON, no understanding, rate limit, declined consent) the built-in parser handles the same message from a snapshot, so behaviour never gets worse.

**Important caveat:** this runs on the viewer's own Claude account. A judge without a Claude login gets the built-in parser. That is why the built-in parser is a first-class path, not a fallback afterthought.

---

## 10. Test assets and results

### 10.1 Planted-error test file (14 bookings)

Generated from `sampleTables()` in `engine.js` (the same data powers the in-page "Try the built-in sample bookings" button; its dates are relative to today). The xlsx has real Excel dates on most rows and text dates on some, to test both.

| Booking | Scenario | Expected outcome |
|---|---|---|
| BK-001 | Clean (the template example) | Clear. Cheapest = Carrier A, £540 |
| BK-002 | One HS code blank, one HS code only 5 digits | R-01 × 2 |
| BK-003 | Declared £6,200 vs items £5,400 (+14.8%) | R-02 |
| BK-004 | 24 per carton × 60 cartons = 1,440 vs quantity 1,200 | R-03 |
| BK-005 | Booking cartons 100 vs items 80 | R-04 |
| BK-006 | Fastest, 2 pallets, 1,000 kg = 500 kg/pallet vs Carrier C limit 400 | R-05; recommend Carrier B (£400); alternative 3 pallets on C (£960) |
| BK-007 | Cheapest, 1 pallet, 900 kg | R-05; no carrier fits; split into pallets (A needs 2, £360) |
| BK-008 | Lithium-ion power bank and aerosol deodorant | R-06 × 2 |
| BK-009 | Gross 300 kg vs items 400 kg | R-07 (amber) |
| BK-010 | Warehouse, no appointment; HS "090240" as text | R-08 (amber) |
| BK-011 | Country of origin blank | R-09 (amber) |
| BK-012 | Ready date 20 days in the past | R-10 (amber) |
| BK-013 | Everything wrong at once | R-01, R-03, R-04, R-05 (Carrier C), R-06, R-08, R-09, R-10 |
| BK-014 | Business address, no appointment; declared £1,009 vs £1,000 (0.9%, within tolerance); olive oil | Clear (negative controls for R-08, R-02, R-06) |

Result: all expectations verified in `t1.js`; round-trip through the generated xlsx verified in `t7.js`; the original `.ods` template (one example row) parses and passes clean.

### 10.2 Scripts
- `t1.js`: runs all sample bookings through the rule engine and prints rules and issues.
- `t2.js`: prints the wording of key explanations for quality review.
- `t3.js`, `t4.js`: simulated chat conversations with no AI (full description in one message, sparse description answered turn by turn, then mid-conversation edits).
- `t5.js`: AI-assisted extraction merge using a mocked model response.
- `t6.js`: jsdom end-to-end of the page: chat flow to completion, add pallet, change priority, set weight, click the fix button, switch to upload, load sample, open BK-006, apply the switch.
- `t7.js`: parses the real `.ods` template, generates the xlsx test file, and reads it back.
- `t8.js`: jsdom test with a stubbed `claude.use('sample')` and `downloads`, covering the AI path, garbage-response fallback, rate-limit fallback, and CSV export.
- No visual or browser screenshot QA has been done. Layout and CSS have not been reviewed in a real browser.

---

## 11. Deployment and platform constraints

Currently published as a Claude artifact: https://claude.ai/artifact/VnZE9S9RzG1A6zoGsZFgfC (declares capabilities `sample` and `downloads`).

Constraints of that hosting environment, which the page already respects:
- Content-security policy: external scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, cdn.tailwindcss.com, code.jquery.com; stylesheets only from fonts.googleapis.com (fonts from fonts.gstatic.com). SheetJS is loaded from cdnjs at pinned version 0.18.5. No remote images, no calls to other origins. Inline styles are set through the CSSOM (`el.style.cssText`), not style attributes.
- `window.claude.use('sample')` and `use('downloads')` return null for viewers who can't use them; the page hides those features.
- No localStorage is used; state lives in memory.
- Dark mode and mobile are supported through CSS variables and breakpoints at 960px and 560px.

If moving off the artifact host (recommended for judging, see section 12), the `sample` and `downloads` calls need replacing: the LLM call should go through a server route holding the API key, and CSV download can use a normal Blob download link.

---

## 12. Known limitations and suggested next steps

### Known limitations
1. **Claude-assisted reading depends on the viewer's Claude login.** Without it, the built-in parser is used.
2. The built-in parser reads one product per message. A message listing several products is only partly captured; the bot then asks for the rest.
3. In built-in mode an unsupported city (for example "Madrid") is not named back to the user; the bot re-asks with the list of supported cities.
4. Dates without a year use the current year, so "5 Oct" typed in late October is read as the past. The date echoed back makes this visible. "next Friday" means the next Friday after today.
5. Estimated delivery counts calendar days (no weekends or holidays).
6. The R-06 keyword list is not exhaustive.
7. No automated tests run in CI; the Node scripts are manual.
8. No browser or visual QA was done.
9. Chat currently supports one booking at a time.

### Suggested next steps (priority order)
1. **Host it independently** (for example Vercel or Netlify) so the link works with no login for every judge, with a small server route calling the LLM using a server-held API key. Keep the built-in parser as the fallback. Remove dependence on the artifact `sample` and `downloads` capabilities.
2. **Visual QA** in real browsers at desktop and mobile widths, light and dark. Check the stamp animation, the ten-cell rule strip on narrow screens, table overflow, and the sticky chat panel height.
3. **Turn the scripts into a real test suite** (Vitest or Jest): the engine tests from `t1` and `t2`, the parser tests from `t3` and `t4`, plus new cases (see below). Run in CI.
4. **Refactor to ES modules** and, if wanted, a small framework build (Vite), keeping behaviour identical.
5. **Parser hardening**: multiple products in one message; "£5 each" vs totals in edge phrasing; unsupported-city naming; more date phrases; quantity words ("a dozen").
6. **More edge-case tests**: duplicate Booking IDs; items with commas in numbers; HS codes with dots; CSV upload; booking with zero pallets; priority missing; weights at exactly the carrier limit (500 kg/pallet on Carrier A must pass); declared value exactly at the 1% boundary.
7. **Polish for judging**: a one-screen "how this decides" explainer; copy-to-clipboard for the confirmation; print-friendly results.

### Do not change without good reason
- Rule definitions, severities and the 1% tolerance.
- The rate card values.
- R-05 evaluated against the selected carrier that defaults to the priority-matching carrier (section 6.2).
- Deterministic checks (no LLM arithmetic).
- Identical results from chat and file upload.

---

## 13. Quick reference: expected behaviours judges are likely to try

| Judge action | Expected behaviour |
|---|---|
| Describes a shipment with gaps | Bot acknowledges what it understood, asks one focused question at a time |
| "Add a pallet" mid-conversation | Pallets +1, cost and weight per pallet update, checks re-run, before/after counts shown |
| Uploads a file with planted errors | Table of bookings with red/amber counts, drill-down per booking, CSV export |
| 1 pallet, heavy load, Cheapest | R-05 flagged on Carrier A, Carrier B recommended with reason, one-click switch |
| Over 750 kg per pallet | R-05 flagged on all carriers, minimum pallets and cost listed per carrier |
| Warehouse with no appointment | Amber R-08 with fix; can still confirm |
| Past ready date | Amber R-10 showing how many days ago and today's date |
| Lithium battery in description | Red R-06 on that item, suggestion to remove or ship via dangerous-goods carrier |
| Blank HS code or 5-digit code | Red R-01 per item |
| Confirms a booking with red issues | Button disabled, reason given |
