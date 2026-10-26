// ABOUT SECTION CONTENT: edit the text here; no layout code needs to change.
//  - Change any text between the quotes, or add and remove items in the lists.
//  - Nothing here is code: no layout, links or HTML. The component builds the email and phone links from the
//    `contact` values (phoneLink is the number without spaces or dashes, used for the tap-to-call link).
//  - Run "npm run check:placeholders" before a release: it fails while any dummy-text tag is left in this folder.

export type Way = { title: string; text: string };
export type AboutContent = {
  heading: string;
  tagline: string;
  whatWeDo: { title: string; intro: string; ways: Way[] };
  why: { title: string; text: string };
  howItWorks: { title: string; steps: string[] };
  whatWeCheck: { title: string; items: string[] };
  scope: { title: string; items: string[] };
  contact: { title: string; email: string; phone: string; phoneLink: string; emailLabel?: string; phoneLabel?: string };
};

export const about: AboutContent = {
  heading: "About",
  tagline: "Catch shipping mistakes before the shipment leaves.",

  whatWeDo: {
    title: "What we do",
    intro:
      "Get Your Ship Together helps sellers book UK to EU shipments and find problems in their paperwork before the goods leave. There are two ways to use it:",
    ways: [
      {
        title: "Chat to book",
        text: "Describe your shipment in your own words. We ask only for what is missing, check everything against our ten rules, recommend the right carrier with the reason, and book it for you.",
      },
      {
        title: "Upload a file",
        text: "Upload your Bookings and Items sheets. We check every booking, show you what is wrong, how serious it is and how to fix it, then book the shipments that are ready.",
      },
    ],
  },

  why: {
    title: "Why we built it",
    text: "Small mistakes in shipping paperwork cause big problems later: goods held at customs, or units reported missing at the receiving warehouse. Sellers often only find out days afterwards, when their stock is already stuck. We built this so mistakes are found and fixed first.",
  },

  howItWorks: {
    title: "How it works",
    steps: [
      "Tell us about your shipment in chat, or upload your sheets.",
      "We check it against ten rules and tell you what to fix.",
      "We recommend a carrier based on what matters most to you, and book it.",
    ],
  },

  whatWeCheck: {
    title: "What we check",
    items: [
      "HS codes are present and valid",
      "Declared value matches the items",
      "Carton counts add up",
      "Weight per pallet is within the carrier's limit",
      "No restricted goods (lithium batteries, aerosols, flammable liquids)",
      "A delivery appointment is booked for warehouse deliveries",
      "Every item has a country of origin",
      "The ready to ship date is not in the past",
    ],
  },

  scope: {
    title: "Scope and limits",
    items: [
      "Shipments from the UK to Germany, France and the Netherlands",
      "Prices in GBP only",
      "Delivery dates are estimates based on calendar days in transit",
      "Bookings are recorded under a reference but are not yet transmitted to a carrier",
    ],
  },

  contact: {
    title: "Contact",
    email: "Getyouship2gether@hotmail.in",
    phone: "+44 987-654-3210",
    phoneLink: "+449876543210", // used for the tap-to-call link
    emailLabel: "Email",
    phoneLabel: "Telephone",
  },
};
