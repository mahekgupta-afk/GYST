// ABOUT PAGE CONTENT: the only file you need to edit to change the About section.
//
// How to edit
//  - Change any text between the quotes. Add or remove items in the lists (steps, checks, limits, team).
//  - Every dummy string starts with the placeholder tag "[Placeholder]". When you replace a string with real
//    text, delete that tag from it. Section headings are real labels and have no tag.
//  - Run "npm run check:placeholders" to list every string that still has the tag. It exits with an error
//    while any are left, so it can also be used as a release check.
//  - Initials in the team circles are optional; if you leave them out they are taken from the name.
//  - Nothing here is code: no layout, links or HTML. The component only reads this file.

export type TeamMember = { name: string; role: string; initials?: string };

export type AboutContent = {
  heading: string;
  tagline: string;
  headings: { what: string; why: string; how: string; checks: string; scope: string; team: string; contact: string };
  what: string;
  why: string;
  steps: string[];
  checks: string[];
  scope: string[];
  team: TeamMember[];
  contact: string;
};

export const about: AboutContent = {
  heading: 'About',
  tagline: '[Placeholder] Catch shipping mistakes before the shipment leaves.',
  headings: {
    what: 'What it does',
    why: 'Why we built it',
    how: 'How it works',
    checks: 'What it checks',
    scope: 'Scope and limits',
    team: 'The team',
    contact: 'Contact',
  },
  what: '[Placeholder] Book a UK to EU shipment by chat or by uploading your sheets. Every booking is checked against ten rules, and you get a recommended carrier with the reason.',
  why: '[Placeholder] Small mistakes in shipping paperwork cause customs holds and missing stock. We wanted sellers to find and fix them before the goods leave.',
  steps: [
    '[Placeholder] Tell us about your shipment in the chat, or upload your Bookings and Items sheets.',
    '[Placeholder] Pre-flight checks: every booking is checked against the ten rules. Each problem is marked Red or Amber, with the fix.',
    '[Placeholder] Carrier recommendation and booking: you get a recommended carrier with the reason, and you can book once no Red problems are left.',
  ],
  checks: [
    '[Placeholder] HS codes: every item has one of at least 6 digits.',
    '[Placeholder] Declared value: it equals quantity × unit price, within 1%.',
    '[Placeholder] Carton counts: units per carton × cartons equals the quantity, and the item cartons add up to the booking total.',
    '[Placeholder] Weight per pallet: it is within the chosen carrier’s limit, and gross weight is at least the weight of the items.',
    '[Placeholder] Restricted goods: no lithium batteries, aerosols or flammable liquids.',
    '[Placeholder] Delivery appointment: a shipment to a warehouse has one (a warning).',
    '[Placeholder] Country of origin: every item has one (a warning).',
    '[Placeholder] Ready date: it is not in the past (a warning, and a past date has to be changed before booking).',
  ],
  scope: [
    '[Placeholder] UK to Germany, France and the Netherlands only.',
    '[Placeholder] Prices and values are in GBP only.',
    '[Placeholder] Delivery dates are estimates, based on calendar days in transit.',
    '[Placeholder] Bookings are recorded with a reference but are not transmitted to a carrier.',
  ],
  team: [
    { name: '[Placeholder] Team Member One', role: '[Placeholder] Product', initials: 'T1' },
    { name: '[Placeholder] Team Member Two', role: '[Placeholder] Engineering', initials: 'T2' },
    { name: '[Placeholder] Team Member Three', role: '[Placeholder] Operations', initials: 'T3' },
  ],
  contact: '[Placeholder] hello@example.com',
};
