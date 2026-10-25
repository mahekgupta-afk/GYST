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

## Not changed, and why

- **No inline "edit description" fix for R-06.** Editing a description to dodge the restricted-goods check would defeat the rule. Removing the item is the only inline fix.
- **Dates with no year ("5 Nov") assume the current year**, with the date echoed back. A past date is then flagged by R-10 rather than silently moved to next year.
- **"Next Friday" means the first Friday after today.** The echoed date lets the seller correct it.
- **Booking is a recorded reference, not a carrier dispatch.** There is no carrier integration, and the screen says so.
