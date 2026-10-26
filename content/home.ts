// HOME PAGE CONTENT: the words on the landing sections. Edit the text here; no layout code needs to change.
// Numbers in the stats strip are not typed here: they are counted from the app's own rule list, carrier rate card and
// supported cities, so they cannot drift from what the app really does.
// The "ways to book" and "what we check" cards reuse the text in content/about.ts.

export type HomeContent = {
  eyebrow: string;
  headline: string[];          // each entry is one line of the big headline
  tagline: string;
  sub: string;
  heroCard: { title: string; primary: string };
  stats: { title: string };
  ways: { title: string; thirdTitle: string; thirdText: string; more: string };
  checks: { title: string; short: string[] };
  features: { title: string; items: { title: string; text: string }[] };
};

export const home: HomeContent = {
  eyebrow: "UK–EU Freight · Pre-flight Compliance",
  headline: ["Get Your Ship", "Together"],
  tagline: "Catch paperwork errors before customs does.",
  sub: "Ten fixed rules. Three carriers. A recommendation based on your priority. No surprises at the border.",
  heroCard: { title: "Start your shipment", primary: "Start" },
  stats: { title: "What is built in" },
  ways: {
    title: "Two ways to book, one set of checks",
    thirdTitle: "Try an example",
    thirdText: "See four sample bookings checked by the real rules, without uploading anything. Nothing is stored or sent.",
    more: "Know more",
  },
  checks: {
    title: "What we check on every booking",
    short: ["HS codes", "Declared value", "Carton counts", "Weight per pallet", "Restricted goods", "Delivery appointment", "Country of origin", "Ready date"],
  },
  features: {
    title: "Precise. Quick. Transparent.",
    items: [
      { title: "Fixed rules", text: "Every booking is judged by the same ten rules, so the same booking always gets the same result." },
      { title: "Carrier, with the reason", text: "You get a recommended carrier for your priority, and a plain explanation of why." },
      { title: "Fix it here", text: "Change a value and the checks re-run straight away, before anything is booked." },
      { title: "Read your invoice", text: "Attach an invoice in the chat and the details printed on it are filled in for you." },
    ],
  },
};
