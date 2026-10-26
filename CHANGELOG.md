# Changelog

The ten rules (R-01 to R-10), their Red/Amber severities and the carrier rate card are unchanged. Checks stay deterministic code. Where an item says "proved by", the named test or manual check is what shows it works.

## A. Confirmed bugs from live testing

**A1. Relative dates.** Cause: the Gemini path let the model supply `readyDate`, and it returned today's date for "tomorrow". Fix: dates are never taken from the model. A new typed module, `lib/parse/dates.ts`, resolves dates from the text and the browser's local today: today, tomorrow, day after tomorrow, "in N days/weeks", "next Monday", "this Friday", "5 Nov", "5th November", "05/11/2026". Numeric dates are always day first. Vague phrases ("next week", "end of the month", "asap") are not saved; the seller is asked for an exact date. The resolved date is echoed as DD-MM-YYYY. A ready date equal to today passes R-10. Proved by: `tests/regression.test.ts` section 1 (clock mocked to 26-10-2026) and a live check in the browser with Gemini on ("ready date tomorrow" became 27-10-2026).

**A2. R-05 contradicted the recommendation.** `recommend()` now filters to carriers whose limit is at least the weight per pallet (exactly equal passes), picks among those by priority, and breaks ties by price, then days, then carrier letter. R-05 is checked against the carrier in use: the recommendation by default, or one the user picked. It passes when a feasible carrier exists. Carriers ruled out for weight appear as a neutral note under the recommendation, with the pallets and price at which they would fit. R-05 is Red only when no carrier can take the load (or a carrier the user picked cannot), with each carrier's pallets and price and a one-click "Use N pallets with Carrier X" button. Pallets 0, blank, negative or fractional raise a clear message, never Infinity or NaN. Proved by: section 2-3 tests (1,500 kg / 2 pallets gives Carrier B £440; 3 pallets gives Carrier A £540; 4,000 kg / 4 pallets to Lyon gives Red with C 10 pallets £3,300, A 8 pallets £1,360, B 6 pallets £1,260).

**A3. Invented SKUs.** The generated SKU was removed. A SKU the seller types ("SKU HS-1", "SKU is HS-1") is kept exactly. With none given the field stays blank and shows "—". A SKU returned by the model is dropped unless the seller typed it. Proved by: section 6-7 tests.

**A4. Out-of-scope places and currency.** New typed module `lib/parse/scope.ts`, run on every message in both the built-in and Gemini paths. An unsupported origin or destination is named in the same reply with the supported list and is not stored. Also handled: city and country mismatch ("Lyon, Germany"), city only, country only, "Frankfurt am Main", close misspellings ("Rotterdm", with a note saying how it was read), and euros, dollars, `€` and `$` (only GBP is supported; the amounts from that message are not stored). Ordinary words are not flagged ("cork coasters", "a nice gift", "made in China"). Proved by: section 6-7 tests and a live check ("Ship 4 pallets of gel to Madrid").

**A5. Balanced.** Price, transit days and on-time rate are each scaled 0 to 1 across the carriers that can take the load, averaged with equal weight (one third each), and the highest wins. The reason shows the numbers, each carrier's score and why the others lost. The method is written in the "Rulebook and rate card" section on the page. Proved by: section 2-3 tests (scores C 0.67, B 0.64, A 0.33).

## B. Upload hardening

**B1. Sheets, headers and columns.** Sheets are found by trimmed, case-insensitive name; Carrier options, Rulebook and other reference sheets are ignored (the built-in rate card and rules are always used). The header row is found by name in the first rows, with or without a title row. Blank and whitespace-only rows are skipped, and the template's example row is treated as an ordinary booking. A missing sheet or column is named exactly ("The Bookings sheet is missing the column: Pallets."). Corrupt or empty files give a message, never a crash. Proved by: section 10 and 12 tests.

**B2. Dates from files.** Excel serial numbers, text in DD-MM-YYYY, D-M-YYYY or DD/MM/YYYY, and `Date` values are read without timezone shifts. Unreadable dates give a row-level error that quotes the value and asks for DD-MM-YYYY. Proved by: tests for real .xlsx and .ods date cells, run in six timezones including UTC+14 and UTC−11 (`npm run test:tz`).

**B3. Numbers and text.** Text numbers ("1,080", "£5.00", " 12 ") are read. R-02 compares whole pence, with exactly 1% passing and a penny more failing, against the sum over all items of the booking; zero and blank declared values give clear messages. Proved by: section 4-6 tests (including 0.1 + 0.2 pence safety).

**B4. HS codes.** Spaces, dots and dashes are stripped ("6912.00" passes, "6912" fails, blank, "TBC" and "N/A" fail, 691200.0 as a number passes). A 5-digit code mentions a dropped leading zero and says to store the column as text. Proved by: section 8 tests.

**B5. Linking and per-booking results.** Booking IDs match case-insensitively and trimmed. Orphan items, duplicate Booking IDs and bookings with no items each give a specific message with spreadsheet rows; a booking with no items skips R-02, R-04 and R-07 as "n/a" instead of showing a misleading mismatch. Each issue shows the Booking ID, SKU and sheet row. The summary table now has a Problems column. Proved by: section 10 and 12 tests.

**B6. R-03 and R-04 text.** Both options with numbers; non-whole carton counts are named, never shown as decimals; R-04 gives the exact expected number. Proved by: section 4-6 tests.

**B7. R-06 matching.** Case-insensitive and word-boundary aware, with the full list from the brief plus perfume, aftershave and matches. "Batteries not included" is flagged because it is ambiguous. "Battery-free", "no battery", "without battery", "lithium soap", "non-aerosol spray bottle", "alcohol-free" and "candle" pass. The matched word is shown, with the fix. Proved by: section 9 tests (19 flagged, 10 not).

**B8. R-07 to R-10.** R-07 states the expected minimum weight and equal passes. R-08 accepts Yes, yes, Y, TRUE. R-09 treats blank, whitespace, N/A, "-" and unknown as missing. R-10 compares to the browser's local today. Proved by: section R-07 to R-10 tests.

**B9. Storage never blocks checking.** Checking happens in the browser before anything is stored. If saving fails, is not configured, or the file is over 4 MB, a small note appears and the results stay. Empty files get a clear message. Proved by: manual check; the storage call is wrapped so no failure reaches the results.

## C. Chat robustness

**C1. Fewer questions.** Origin country, currency and destination country are never asked. Missing booking details are asked in one message (business name, collection and delivery city, warehouse or business address, appointment, date, priority), and a terse reply like "Acme Ltd, Leeds, warehouse, appointment booked, ready 5 Nov, cheapest" fills them all. Missing product details are asked together. "Roughly 360 kg" is used as given and the seller is told so. Proved by: section C1-C2 tests.

**C2. Every change re-runs the checks.** "add a pallet" is +1, "make it 5 pallets" sets 5, plus city, destination type and priority changes, from typing or the chips. Each reports what changed and the before and after Red and Amber counts. Proved by: section C1-C2 tests.

**C3. AI failure.** The browser stops waiting after 14 seconds, the server stops trying more models after 8, and the built-in parser takes over silently. If it also cannot read the message, the seller sees a friendly retry message and the booking is kept. The "Reading your message…" indicator is always removed.

**C4. Start over** resets the booking, items, chat history and results. Proved by: test (reset detection and a fresh state) and a browser check.

**C5. Booking.** The Book button is disabled while any Red remains. With only warnings, each warning must be acknowledged (tick boxes, or "I acknowledge the warnings" in chat); the server enforces both. The confirmation shows reference, route, carrier and service, pallets, total price (price per pallet × pallets), estimated delivery (ready date plus transit days, calendar days, labelled as an estimate), the acknowledged warnings and next steps. Proved by: section 13 tests and a browser check of the button states.

## D. Deployment and compatibility

**D1. Public with no login.** Checked through the Vercel connection: password protection and Vercel login protection are both off for the project, and `https://gyst-omega.vercel.app` (the stable production domain) returns HTTP 200 with no login, with Gemini and storage reported enabled. Submit that URL, not a per-deployment one like `gyst-1mu9giz41-…`. This applies to the version currently deployed; the changes in this changelog go live once pushed.

**D2. Console, phones, Safari.** No console errors in Chromium. A sideways-scrolling bug on phone-width booking pages (content 900 to 1,040 px wide) was found and fixed, and every screen now measures exactly the phone width. Seven lookbehind regular expressions were removed because Safari before 16.4 cannot parse them and would have failed the chat. **Not verified:** real Safari. A WebKit test browser was installed but could not open a page inside this sandbox, so Safari behaviour is unconfirmed beyond removing that known incompatibility. A manual check on an iPhone and a Mac is still needed.

## Input validation (three new rules)

R-01 to R-10, their severities and the rate card are unchanged. All three rules live in one module, `lib/validate.ts`. Chat (built-in and Gemini paths), quick replies, typed edits, the "Fix it here" inputs, the editable table and uploaded sheets all call it. The engine calls it for files, `applyChange` calls it for in-app edits, and the chat parser calls it after extraction and again after applying a change, so a language model never decides validity.

**Rule 1: HS codes must not be all zeros.** Spaces and dots are ignored; "0", "000000", "00 00 00", "0000.00.00", 0 and 0.0 are invalid whatever their length; "090111" is valid; a minus sign or a letter is invalid. An invalid code is an R-01 Red failure with the message "<SKU> has the HS code “<value>”, which is all zeros. Enter a real code of at least 6 digits from the UK Trade Tariff." In chat an all-zero (or negative, or lettered) code is not stored, the reason is given in the same reply, and the real code is asked for again. A bare reply of "-691200" used to be stored as 691200 because extraction dropped the minus; it is now checked as typed and refused. The Set HS code input and the table cell apply the same check.

**Rule 2: numeric fields must be greater than 0.** Covers Pallets, Cartons, Total declared value and Total gross weight (Bookings) and Quantity, Unit price, Units per carton, Cartons and Unit weight (Items). Counts (Pallets, Cartons, Quantity, Units per carton) must be whole numbers; weights, prices and the declared value may have decimals. Rejected: 0, 0.0, "zero", "none", "no pallets", negatives, "minus 3", "-0", NaN, text, blank where a number is needed.
- Chat: the invalid value is never stored, the old valid value is kept, and the same reply says which field and why and asks for it again ("Pallets can’t be 0 or negative. How many pallets are you sending?"). In a message with several values the valid ones are stored and only the invalid ones are re-asked. "make it 0 pallets", "remove all the pallets" and "remove a pallet" down to zero are refused. A bare reply right after a refusal answers the refused field and is validated again. The Gemini path is covered: values returned by the model are validated, negatives are no longer silently dropped, and the model is told the re-ask question.
- "Fix it here" inputs and table cells: invalid values give an inline error and a disabled button and are not applied; `applyChange` refuses them as a backstop.
- Uploaded files: each bad cell is a Red input error (rule id `INPUT`, labelled "Input error") naming booking, sheet, row, column and value, for example "BK-003 · Items sheet, row 6 · Quantity is 0. Enter a whole number greater than 0." It blocks booking like any Red. Checks that depend on the bad value (for example R-02, R-03 or R-05) are shown as n/a and the issue says they were skipped because of the input error. Nothing shows NaN or Infinity, other bookings are unaffected, and the input error has its own Fix it here box.

**Rule 3: past dates are not accepted.** Today is allowed; yesterday and earlier are not. Chat refuses explicit past dates and "yesterday", "last Friday", "2 days ago" and the like, in the same reply: "That date is in the past. Today is 26-10-2026. What date will the goods be ready?", keeps any earlier valid date, and applies to mid-conversation edits (including "change the ready date to yesterday", which used to bypass the check). Uploaded files keep R-10 as Amber with the same label and message, and no other result is dropped or changed, but a booking with a past date cannot be booked until the date is corrected: the Book button says "Fix the date to book", the warning cannot be acknowledged away, and the server refuses it (`past_date`). The date input and the date cell enforce today-or-later. An unreadable date is re-asked in chat, or reported with its row in a file.

### Structured light scheduler restyle

Visual only. Flat grey canvas, white cards with hairline borders and tight low shadows, a near-black pill button with a white outlined secondary, pill tabs, a framed page with corner plus-marks, and Cal Sans headings with Inter body text. Red, amber and green, their tints and the status tiles are unchanged and still locked by `tests/theme.test.tsx`; the booked tile is now blue. Differences from the design brief: dark mode is kept (you asked for light and dark), the brief's muted grey is darkened to pass 4.5:1 contrast, and the header is trimmed on phones so the message box is on screen when the page opens. Proved by: theme tests (contrast pairs, locked status colours, flat-design checks) and a manual phone check at 375x812 in both themes (no sideways scroll, message box visible).

## Header navigation, Try an example, Carrier options, About

R-01 to R-10, their severities, the carrier rate card and all existing validation and recommendation logic are unchanged. Checks stay deterministic code.

**Part 1. Header navigation.** `components/Nav.tsx`, sticky, with Chat to book, Upload a file, Try an example, Rulebook and Carrier options on the left, and New booking, About (a plain text link) and the Light/Dark switch (rightmost) on the right. Every scroll target carries `scroll-margin-top` equal to the measured header height (`--nav-h`), the sticky chat panel sits below it, and the safe-area insets are respected. The current view has an active style and `aria-current`; it follows the scroll position. Under 700px the left group, New booking and About give way to a Menu button (five items, New booking, About last; closes after a choice, on Escape, or on a click outside). Switching tabs keeps the booking; New booking (and typing "start over", which now does the same) clears chat, booking, results, uploaded file and any example. Proved by: `tests/nav.test.tsx` (19 tests: order, About left of the switch, tab order, each item's action, aria-current, menu open/close/Escape, tabs keep the booking, New booking resets, sticky and scroll-margin rules in the stylesheet) and a browser check at 375, 1100 and 1280px (no horizontal scroll, targets land below the header).

**Part 2. Try an example.** `lib/example.ts` builds a small workbook in memory (EX-001 clean, EX-002 Amber only, EX-003 four Reds, EX-004 a heavy load) and reads it with the same `parseWorkbook` and rule engine as a real upload; the results are never written into the data. Ready dates are today plus 2 to 5 days. A banner says "Example data, not your file" with Clear example. It is never stored or sent, and booking is switched off for it (the buttons say so). Proved by: `tests/example.test.tsx` (the four outcomes through the real engine, dates at two different "todays", banner and Clear example, no request other than the AI-status check).

**Part 3. Carrier options.** The rate card is rendered from `PF.CARRIERS` (no second copy). The compare tool (`lib/compare.ts`) validates with the shared `checkNumber`/`inputErrorText`, then calls the same `PF.recommend` as booking and upload, once per priority for the winner row and once for Balanced for the scores. It shows total price, days, on-time, kg per pallet against the limit, "Fits, X kg spare" or "Over by X kg", the pallets and price that would make a carrier fit, and a one-line reason. "Use these details in a booking" starts a chat booking through the normal parser and validation (built-in parser, so the pre-fill is deterministic). Proved by: `tests/carriers.test.tsx` (the three worked examples, six rejected inputs with no NaN or Infinity, and an equality check of the tool against `evaluate()` for 3 countries x 4 priorities x 7 loads).

**Part 4. About.** `content/about.ts` holds all About text; `components/About.tsx` only renders it. Every dummy string starts with "[Placeholder]". `npm run check:placeholders` lists each remaining one and exits 1 while any exist (comment lines are ignored). Proved by: `tests/about.test.tsx` (renders every item, heading hierarchy, a changed content object and a replaced content module change the output with no code change, the script fails and passes as specified).

## Real About content

`content/about.ts` now holds the real About text (what we do as two cards, why we built it, how it works, what we check, scope and limits, two partners, contact). The content file has a new shape, so `components/About.tsx` was adapted to render every field; no rules, validation or recommendation logic changed. What we do is two cards side by side on desktop and stacked under 700px. The team is exactly two cards (MG, ND). Contact is a `mailto:` link and a `tel:+449876543210` link showing "+44 987-654-3210", with no form. All "[Placeholder]" strings are gone and `npm run check:placeholders` passes. The About link still lands with the heading below the sticky header. Proved by: `tests/about.test.tsx` and a browser check at 1100px and phone width.

## About: more formal team and contact layout

Layout only. Team cards have a fixed, even width instead of stretching across the page; Contact is a bordered card of labelled rows (Email, Telephone, set in `content/about.ts`) with the same mailto and tel links; headings get more space above them. Wording is unchanged.

## About next to Carrier options in the header, team section removed, smaller theme switch

About is now in the left group of the header, directly after Carrier options, styled like its neighbours; the right cluster is New booking and the Light/Dark switch (the phone Menu is unchanged, About last). An earlier change that put the About section beside the Carrier options section on the page was a misreading and has been reverted: the page order is again Carrier options, Rulebook, About. The team section ("The team" and the two partner cards) stays removed. The Light/Dark switch text is 11px (was 13px) with smaller icons and padding. The header highlight follows the section most recently scrolled past. Proved by: `tests/nav.test.tsx` (About immediately after Carrier options, switch rightmost, tab order), `tests/about.test.tsx` (no team content, About last on the page) and a browser check at 1280px (one-row header) and 1000px (the header wraps to two rows, no horizontal scroll).

## Not changed, and why
- **Short HS codes** ("6912") are still stored and reported by R-01, as before. The new rule only refuses values that are not codes at all (zeros, negatives, letters).
- **Blank number cells** remain "missing data" messages (already Red) and are not turned into input errors.
- **Word numbers** ("three", "zero") are read in chat only. In spreadsheet cells and typed inputs they are text and are reported as "isn’t a number".
- **A negative number written with no cue word** (for example "-10 mugs") is not read as a quantity at all, so nothing invalid is stored, but the seller is asked the normal question instead of being told why. "quantity -10", "-10 units", "-3 pallets" and similar are caught with an explanation.
- **Past date in a file stays Amber.** It is not upgraded to Red, so the judges' rulebook behaviour for R-10 is unchanged; only the booking step is blocked.
- **The chat never stores a past date**, so the extra booking gate matters for uploaded files and in-app edits.

## Upload fixes (messy-file retest)

Tests: `tests/messy.test.tsx` builds a deliberately messy .xlsx and asserts the exact outcomes below, including a check of the rendered HTML (no "NaN", "Infinity" or "undefined" in the summary table or any booking page). The tests also confirm that the chat and "Fix it here" paths refuse the same values.

**Bug 1: all-zero HS codes passing R-01.** Not reproducible on the current code: "000000", "0", "0000.00.00", 0, 0.0, "00 00 00", "000000.0", "-691200", "TBC", blank, whitespace and "N/A" all fail R-01 in a real .xlsx, "090111", "691200" and "6912.00" pass, and the message names the SKU, sheet and row. The fix was already in the previous release (commit 15dd7e6), so this was most likely seen on the build before it. One real defect turned up and is fixed: "change the HS code to 000000" in chat was read as the code "to 000000" and refused for the wrong reason; it is now refused as all zeros.

**Bug 2: zero and negative numbers.** The input validation was also already in 15dd7e6 and passes every case: Quantity 0, Unit price -5, Unit weight 0, Units per carton 0, Cartons -5, Total declared value 0, Total gross weight -100, Pallets 0 and 2.5 are each their own Red input error naming booking, sheet, row, column and value, with the dependent checks (R-02, R-03, R-04, R-05, R-07) shown as n/a and explained. What was still wrong, and is fixed now, is the recommendation: a carrier and price were still shown from the pallets that were valid. When pallets or gross weight is invalid or missing, no carrier is recommended, the booking page says "Fix the input errors above to get a carrier recommendation", and the summary table shows "—" for that row (and the CSV and corrected-file exports leave it blank).

**Bug 3: a row with a blank Booking ID was silently dropped.** A Bookings row with data and no ID is now kept, shown as "(no ID)" with a Red status, and given the Red input error "Bookings sheet, row N has no Booking ID. Add one and upload again." It cannot be booked. An Items row with data and no Booking ID gives the visible notice "Items sheet, row N has no Booking ID, so it was ignored." Completely blank rows (and whitespace-only rows) are still ignored with no notice. The number of bookings shown equals the number of non-empty Bookings rows.

**P1: Booking IDs.** IDs are trimmed and shown upper-case everywhere ("  bk-002 " is BK-002). Matching between sheets stays case-insensitive and trimmed.

**P2: why there is no carrier.** Plain-English message instead of a dash on the booking page and in chat.

### Not changed, and why
- **A booking with a valid pallet count and weight but other input errors** (for example a zero unit price) still shows its carrier and price. Your rule is that a carrier is withheld when pallets or gross weight is invalid; the price depends only on pallets, and the weight check only on weight.
- **The "(no ID)" row also shows a carrier when its own numbers are valid.** It is still Red and cannot be booked. I did not hide it because its pallets and weight are valid.
- **Duplicate-ID matching** is by the normalised ID, so "bk-003" and "BK-003" count as the same ID, as before.
- **Blank numeric cells** remain "missing data" messages, not input errors.

## Review round 3: blank IDs, display IDs, recommendation, booking robustness

**Items 1 to 3 were already shipped in commit 5fe9feb.** The live bundle at gyst-omega.vercel.app contains their strings, and they are covered again here by the exact fixtures from the review (`tests/review3.test.tsx`, 14 tests). If they looked unfixed, the retest probably ran before that build finished (about a minute after the push).

**1. Blank Booking ID rows.** A Bookings row with data and no ID is kept, shown as "(no ID)" with a Red status and the Red input error "Bookings sheet, row N has no Booking ID. Add one and upload again."; it cannot be booked. An Items row with no ID gives the visible warning "Items sheet, row N has no Booking ID, so it was ignored." Entirely blank (or whitespace-only) rows are ignored without a notice. Fixture test: one clean booking, one row with data and a blank ID, one fully blank row gives 2 summary rows, the blank-ID row Red, and the blank row ignored. The bookings count equals the non-empty data rows.

**2. Display IDs.** Trimmed and upper-cased everywhere: summary table, cards, issue text, the issue CSV and the corrected workbook (all three sheets). Matching between sheets stays case-insensitive and trimmed. Tested.

**3. No carrier on unusable pallets or weight.** With pallets or gross weight at 0, negative, fractional, text or blank, nothing is recommended: no "Recommended" badge, no "scores highest / can take this load" text, the card says "Fix the input errors above to get a carrier recommendation.", and the summary table shows "—". When only other inputs are invalid (a zero unit price, a zero declared value) the load can still be assessed and the recommendation stays. Tested with 0 pallets, 2.5 pallets, a valid booking with gross weight -100, gross weight 0, blank pallets, blank gross weight and text pallets.

**4. Booking robustness.**
- **15-second limit on every network call for booking and chat parsing** (`lib/net.ts`): booking, the chat message reader, the AI-status check, upload storage and the second-opinion check. The whole request, including reading the reply, is raced against the timer, so a request that ignores abort is still given up on.
- **On timeout or error** the button comes back, all booking data is kept, nothing is booked, and the seller sees "That took too long. Nothing has been booked. Please try again." (also used for network errors and 5xx replies; refusals keep their own specific messages). The chat reader falls back to the built-in parser, and "Reading your message…" and "Booking…" can no longer stay forever.
- **No double booking.** The button is disabled while a request is in flight, a second click does nothing (an in-flight guard on the booking itself), and the request is idempotent: the browser sends one key per booking content (a new key if any data changes), the server derives the reference from it and stores it under a unique index, so a retry after a timeout returns the first booking instead of creating a second.
- **Likely cause of the 45-second hangs, fixed.** The database setup step was cached as one shared promise, so if it stalled once, every later booking waited on it. It now has an 8 s limit and a failed or stalled setup is discarded and retried. The booking query has a 12 s limit and the routes have a 20 s `maxDuration`. This is the most plausible server-side cause, not a proven one, because I could not reproduce a 45 s stall.
- **Tests.** `tests/booking-timeout.test.tsx` renders the real app, uploads a file, clicks Book shipment against a request that never answers, and asserts: "Booking…" with the button disabled while waiting, still waiting at 14 s, the exact message and a re-enabled "Book shipment" button after 15 s, no booking made, the booking still on screen, one request for two clicks, and a retry that succeeds with the same key. `tests/idempotency.test.ts` covers the server. An opt-in test (`RUN_DB_TESTS=1`, `tests/db-idempotency.live.test.ts`) ran against the real database: the same key twice gave one row and the same reference.
- **Dev dependencies added:** `jsdom` (version 25, because 27 needs a newer Node than 20.18) and `@testing-library/react` / `@testing-library/dom`.

### Not changed, and why
- A request that has already succeeded on the server but whose reply never reached the browser shows "Nothing has been booked", which is wrong in that one case. The retry is safe (it returns the same booking, not a second one), but the first message cannot know. Making the message depend on a status lookup would add another network call to the same failing path.
- The database timeout cuts off waiting, not the query itself, so a query that is already running may still finish in the background.

## Light and dark mode, new colours

**Theme switch.** A Light / Dark control in the header (icons only on a phone). A first-time visitor starts on whichever matches their device, and there is no third "System" button. The choice is saved in the browser and applied before the page first paints, so there is no flash of the wrong theme. If browser storage is blocked (some private windows) the choice still applies for that visit and nothing breaks. The browser's address-bar colour also follows the theme.

**New palette.** A cooler off-white page with white cards and soft depth in light mode; a deep navy page with raised dark cards in dark mode. The primary colour is a clear blue (a lighter periwinkle in dark mode) instead of the previous dull navy, with hover and pressed states, and a small logo mark next to the title. Status colours (red, amber, green) are kept distinct and readable in both themes. Every text and background pair is at least WCAG AA (4.5:1); `tests/theme.test.tsx` reads the real stylesheet and checks all of them, checks the two dark blocks cannot drift apart, and tests the switch (including blocked storage and the no-flash script).

**Also fixed.** The message box could get stuck at its maximum height because it measured itself once at page load; an empty box now keeps its natural height. A duplicated block of styles was removed.

### Not changed, and why
- The theme control is on every screen but is not a setting stored on the server, so a choice does not follow someone to another device.
- Colours inside the downloaded Excel and CSV files are not themed (they have none).

## Solid status tiles

The summary tiles (All, Red, Amber, Green, Booked) are now filled with their status colour, with plain black or white text chosen for contrast: white on red, green, blue (booked) and the dark "All" tile in light mode, black on amber, and black on all of them in dark mode. The selected tile gets a two-tone ring that does not rely on colour. `tests/theme.test.tsx` checks that the text on every tile is exactly black or white with at least 4.5:1 contrast in both themes, and that each filled tile stands out from the card behind it (the amber tile gets a darker edge in light mode because a bright yellow on white is hard to see otherwise).

## Claymorphic comic ledger restyle

Restyled from the "Claymorphic Comic Ledger" design brief, in both Light and Dark. Red, amber and green (the status colours, the rule chips, the stamp and the red/amber/green tile fills) are exactly as before; `tests/theme.test.tsx` now locks their values.

- **Look.** Thick 2px outlines and hard offset shadows with no blur on cards, buttons, chips, tiles and bubbles. Cards 16px round, buttons 12px. Buttons press down on click. Lavender (#B09CFB) and coral (#FFBE98) are the brand colours; coral is kept for the main actions only. Mint was left out because it would read as the status green.
- **Header.** A lavender band with a squared, outlined nav bar (logo, theme switch, date), a big title and a wavy drop into the page. The band is the same in both themes. In dark mode it sits above a near-black page with lavender-outlined cards.
- **Type.** Gasoek One (the brief's display face) only for headlines, the stamp and big numerals; Geist for all other text.
- **Rulebook panel.** Shown as the dark "ledger" register (near-black with a lavender outline) in both themes.
- **Chat.** Ruled-paper background, lavender bubbles for the user, outlined white bubbles for the assistant, pill suggestion chips.
- **Tiles and tables.** Status tiles keep their fills and gain outlines and a lift when selected; the "Booked" tile is lavender; table header rows are lavender.
- **Still true.** The message box is on screen when the page opens (the chat panel height now follows the measured header height), no sideways scrolling on a phone, and every text pair still passes WCAG AA in both themes.

### Not changed, and why
- The brief's 125px display size and 64px section padding are scaled down: the app is a tool, and the chat box has to stay on screen when the page opens.
- The brief's wavy transitions and light/lavender/dark section rhythm are used once (header to page, and the dark rulebook panel) rather than between every section, because the results screens are dense working views.
- The faint grid and aurora background effects were not added; they would sit behind small text.

## Not changed, and why

- **No inline "edit description" fix for R-06.** Editing a description to dodge the restricted-goods check would defeat the rule. Removing the item is the only inline fix.
- **Dates with no year ("5 Nov") assume the current year**, with the date echoed back. A past date is then flagged by R-10 rather than silently moved to next year.
- **"Next Friday" means the first Friday after today.** The echoed date lets the seller correct it.
- **Booking is a recorded reference, not a carrier dispatch.** There is no carrier integration, and the screen says so.
- **Booking from the example is off.** The brief says the example is never stored or sent anywhere, and a booking is sent to the server, so the example can be fixed and read but not booked.
- **The Rulebook section keeps its own rate card table.** It reads the same `PF.CARRIERS`, so there is still one source of data; removing it was not asked for.
- **"Use these details in a booking" asks before it clears a chat that already has your messages**, and keeps any uploaded results.
- **Smooth scrolling is skipped when the device asks for reduced motion.**
- **Section headings in `content/about.ts` have no [Placeholder] tag**, because they are the labels you specified; only the dummy text does.

