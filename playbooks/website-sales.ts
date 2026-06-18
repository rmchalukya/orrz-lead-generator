import type { Playbook } from "../core/playbooks/index.js";

// Reference business case: the BRD's "website in 90 minutes for ₹999" campaign,
// expressed entirely as Playbook config. A second vertical is just another file like this.
export const websiteSales: Playbook = {
  key: "website-sales",
  name: "Website Sales (₹999, 90 min)",

  discovery: {
    sources: [{ key: "google-places" }],
    queryTemplates: ["{businessType} in {city}"],
  },

  analyzers: [{ key: "website" }],

  // BRD Module C: P1 no website, P2 poor (<50), P3 average (50-70), exclude >70.
  scoring: {
    rules: [
      { id: "no-website", fact: "website.status", op: "==", value: "NONE", points: 60 },
      { id: "poor", fact: "website.score", op: "<", value: 50, points: 40 },
      { id: "average", fact: "website.score", op: "<", value: 70, points: 20 },
      { id: "missing-contact", fact: "website.status", op: "!=", value: "GOOD", points: 10 },
    ],
    bands: [
      { band: "P1", min: 60, max: 100 },
      { band: "P2", min: 40, max: 59 },
      { band: "P3", min: 20, max: 39 },
      { band: "EXCLUDE", min: 0, max: 19 },
    ],
  },

  qualification: { excludeBand: "EXCLUDE" },

  personalization: {
    promptKey: "website-sales",
    offer: {
      headline: "Professional Business Website Ready in 90 Minutes",
      price: "₹999",
      features: ["Mobile responsive", "WhatsApp integration", "Contact forms", "Google Maps", "Basic SEO"],
    },
  },

  // 5-touch email sequence: curiosity first, price held until touch 3.
  // Add WhatsApp touches later by changing `channel`.
  sequence: [
    { day: 0, channel: "email", templateKey: "observation", stopOn: ["replied", "unsubscribed", "bounced"] },
    { day: 3, channel: "email", templateKey: "mockup", stopOn: ["replied", "unsubscribed", "bounced"] },
    { day: 7, channel: "email", templateKey: "offer", stopOn: ["replied", "unsubscribed", "bounced"] },
    { day: 14, channel: "email", templateKey: "reminder", stopOn: ["replied", "unsubscribed", "bounced"] },
    { day: 21, channel: "email", templateKey: "breakup", stopOn: ["replied", "unsubscribed", "bounced"] },
  ],
};
