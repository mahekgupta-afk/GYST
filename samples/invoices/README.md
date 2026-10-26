# Sample invoices

Made-up invoices for trying the invoice upload in the chat (the paperclip next to the message box). All of them are fictional.
Each was run through the live reader once when it was made; the result is in the last column.

| File | What it shows | What the chat should do |
|---|---|---|
| `1-clean-gbp-germany.png` | A full invoice: one product, HS code, country of origin, 90 cartons, 3 pallets, 620 kg | Fills the seller, Berlin, £5,400, the mug line, cartons, pallets and weight, then asks for the collection city, delivery type, ready date and priority. Read correctly. |
| `2-two-products-france.png` | Two products with SKUs, HS codes and countries of origin | Fills two product lines and £8,300, then asks for the rest. Read correctly. |
| `3-minimal-netherlands.png` | Almost nothing printed: no SKU, HS code, cartons or weights | Fills the seller, Amsterdam, 800 prints at £3 and £2,400, then asks for everything else. Read correctly. |
| `4-has-problems-for-the-rulebook.png` | An aerosol and a lithium power bank, a short HS code (3307), and a goods total of £4,500 when the lines add up to £4,000 | After you answer the questions, the checks flag them: restricted goods (R-06), HS code too short (R-01), declared value mismatch (R-02). Read correctly. |
| `5-euro-invoice-refused.png` | Prices in EUR | "This invoice is in EUR. I can only book in £". Nothing is changed. Read as EUR. |
| `6-delivers-to-poland-refused.png` | Delivers to Warsaw | Reads the invoice but says it can't book Poland (only Germany, France and the Netherlands). Read as Warsaw, Poland. |
| `7-two-products-france.pdf` | The same as 2, as a PDF | As 2. Read correctly (on the second try: the first hit a Gemini timeout). |

The reader depends on Gemini, which is sometimes slow or busy. If a read fails, the chat says so and nothing changes: try again.
