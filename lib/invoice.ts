// Shared by the invoice route and the chat: what may be uploaded, and what the reader is asked to do.
// The reader only COPIES what is printed on the invoice. Whether a booking is acceptable is decided later by the
// same deterministic validators and rulebook as for anything typed; no model decides pass or fail.

export const INVOICE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const INVOICE_MAX_BYTES = 4 * 1024 * 1024;       // the hosting platform rejects request bodies much over 4.5 MB
export const INVOICE_TIMEOUT_MS = 42000;
export const INVOICE_MAX_ITEMS = 25;

export const INVOICE_PROMPT = [
  'You read a seller’s invoice (an image or PDF) so a shipment can be booked. Return ONLY a JSON object, no prose, no code fences.',
  'Shape: {"isInvoice":bool,"currency":str|null,"transcript":str,"seller":str|null,"destCity":str|null,"destCountry":str|null,"declaredValue":num|null,"cartons":num|null,"pallets":num|null,"grossWeight":num|null,"items":[{"sku":str|null,"desc":str|null,"hs":str|null,"qty":num|null,"price":num|null,"upc":num|null,"cartons":num|null,"unitWeight":num|null,"coo":str|null}]}',
  'Rules:',
  '- "transcript" is every line of the document that contains a number or a code, copied exactly as printed (skip lines with no digits). If it is not an invoice, an order or a packing list, set isInvoice false.',
  '- Copy only what is printed. Use null for anything not printed. Never estimate, never calculate, never add up, never convert currency.',
  '- "seller" is the business that issued the invoice. "destCity"/"destCountry" are where the goods are delivered to (the ship-to or delivery address), not the billing address.',
  '- "currency" is the 3-letter code of the prices (GBP, EUR, USD...), from the currency symbol or code printed.',
  '- Each line of goods is one entry in items. "qty" is the number of units, "price" is the price of ONE unit before tax. "sku" and "hs" only if printed. "coo" only if a country of origin or “made in” is printed.',
  '- "declaredValue" is the total value of the goods as printed, before VAT and before shipping, only if a total is printed. "cartons", "pallets" and "grossWeight" (kg) only if printed.',
  '- Do not guess the collection city, dates, priority or delivery type: they are not in the schema.',
].join('\n');
