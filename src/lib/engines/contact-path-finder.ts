// CONTACT PATH FINDER (#6 from the brief)
// Given a lead, enumerates every lawful path to reach the decision-maker.
// Each path carries: source, risk_level, lawful_basis hypothesis,
// personalization context, opt-out handling, and whether prior consent is
// required before commercial messaging.
//
// Compliance: this module classifies — it does NOT send anything. It also
// does NOT fetch new data. It only labels what's already stored on the lead.

export type ContactChannel =
  | "email"
  | "phone"
  | "whatsapp"
  | "contact_form"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "google_maps_message"
  | "postal"
  | "partner_intro"
  | "event_followup";

export interface ContactPath {
  channel: ContactChannel;
  target: string;
  source: string;
  risk_level: "low" | "medium" | "high";
  lawful_basis: string;          // hypothesis under GDPR Article 6(1)
  consent_required_before_marketing: boolean;
  personalization_context: string;
  opt_out_handling: string;
  recommended_order: number;     // 1 = best path, 9 = last resort
}

export interface LeadForContactPaths {
  primary_name?: string | null;
  company_name?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp_url?: string | null;
  contact_form_url?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  google_maps_url?: string | null;
  address?: string | null;
  lead_type?: string | null;
  source_type?: string | null;
}

const TYPE_IS_PROFESSIONAL = (t?: string | null): boolean => {
  if (!t) return false;
  return /(?:concierge|manager|agency|operator|gîte|villa|professional)/i.test(t);
};

export function findContactPaths(lead: LeadForContactPaths): ContactPath[] {
  const isPro = TYPE_IS_PROFESSIONAL(lead.lead_type);
  const paths: ContactPath[] = [];

  // 1. Professional email — strongest B2B path
  if (lead.email) {
    paths.push({
      channel: "email",
      target: lead.email,
      source: "Public contact email captured from operator website / business registry",
      risk_level: isPro ? "low" : "medium",
      lawful_basis: isPro
        ? "Legitimate interest (GDPR Art. 6(1)(f)) — B2B prospecting to a publicly published professional email"
        : "Requires explicit consent before commercial messaging (ePrivacy)",
      consent_required_before_marketing: !isPro,
      personalization_context: "Reference the public business activity, not the email source.",
      opt_out_handling: "Include a one-click unsubscribe footer in every email. Honour DNC immediately.",
      recommended_order: 1,
    });
  }

  // 2. Contact form on the operator's website — explicit invitation to contact
  if (lead.contact_form_url) {
    paths.push({
      channel: "contact_form",
      target: lead.contact_form_url,
      source: "Public contact form on operator's own website",
      risk_level: "low",
      lawful_basis: "The form is an explicit invitation to contact (GDPR-compliant by design)",
      consent_required_before_marketing: false,
      personalization_context: "Cite a specific page or service on their site that motivated the message.",
      opt_out_handling: "If they reply 'no thanks', tag them DNC and never re-contact.",
      recommended_order: 2,
    });
  }

  // 3. Phone — only for B2B operators with a publicly listed professional number
  if (lead.phone) {
    paths.push({
      channel: "phone",
      target: lead.phone,
      source: "Public business phone number (Google Maps verified or SIRENE registry)",
      risk_level: isPro ? "medium" : "high",
      lawful_basis: isPro
        ? "Legitimate interest, but ePrivacy phone-marketing rules apply — check Bloctel (FR) before calling individuals"
        : "Likely personal mobile — do not cold call; use written channels only",
      consent_required_before_marketing: !isPro,
      personalization_context: "Call during business hours, identify yourself immediately, ask if it's a good time.",
      opt_out_handling: "Honour 'do not call' on first request. Check Bloctel registry for FR individual numbers.",
      recommended_order: isPro ? 3 : 7,
    });
  }

  // 4. LinkedIn company page — neutral B2B channel
  if (lead.linkedin_url) {
    paths.push({
      channel: "linkedin",
      target: lead.linkedin_url,
      source: "Public LinkedIn company page",
      risk_level: "low",
      lawful_basis: "LinkedIn ToS allows B2B outreach via InMail / connect-with-note within platform rules",
      consent_required_before_marketing: false,
      personalization_context: "Reference a recent post, hire, or company update if visible.",
      opt_out_handling: "If they decline the connection, do not re-attempt.",
      recommended_order: 3,
    });
  }

  // 5. Google Maps message — works if they have a Google Business Profile
  if (lead.google_maps_url) {
    paths.push({
      channel: "google_maps_message",
      target: lead.google_maps_url,
      source: "Google Business Profile messaging feature",
      risk_level: "low",
      lawful_basis: "The business has opted into messaging by enabling the feature on their listing",
      consent_required_before_marketing: false,
      personalization_context: "Mention something specific about their reviews or location.",
      opt_out_handling: "Stop on no-reply after one follow-up.",
      recommended_order: 4,
    });
  }

  // 6. Instagram DM — only for businesses that publish their handle
  if (lead.instagram_url) {
    paths.push({
      channel: "instagram",
      target: lead.instagram_url,
      source: "Public Instagram business profile",
      risk_level: "medium",
      lawful_basis: "Instagram permits B2B outreach via DM within platform rules",
      consent_required_before_marketing: false,
      personalization_context: "Reference a recent post (NOT a story — that crosses into intrusive).",
      opt_out_handling: "Stop on no-reply after one DM. No follow-up.",
      recommended_order: 5,
    });
  }

  // 7. Facebook page message
  if (lead.facebook_url) {
    paths.push({
      channel: "facebook",
      target: lead.facebook_url,
      source: "Public Facebook business page",
      risk_level: "medium",
      lawful_basis: "Facebook permits B2B outreach via Page Messages within platform rules",
      consent_required_before_marketing: false,
      personalization_context: "Reference a recent post or photo.",
      opt_out_handling: "Stop on no-reply after one message.",
      recommended_order: 6,
    });
  }

  // 8. WhatsApp Business — explicit invitation to contact if visible
  if (lead.whatsapp_url) {
    paths.push({
      channel: "whatsapp",
      target: lead.whatsapp_url,
      source: "Public WhatsApp Business link on operator website",
      risk_level: "low",
      lawful_basis: "The wa.me link is an explicit public invitation to message",
      consent_required_before_marketing: false,
      personalization_context: "Keep it short — WhatsApp is conversational, not pitch-heavy.",
      opt_out_handling: "Honour 'stop' or any decline immediately.",
      recommended_order: 4,
    });
  }

  // 9. Postal letter — slow but compliance-clean
  if (lead.address) {
    paths.push({
      channel: "postal",
      target: lead.address,
      source: "Public business postal address",
      risk_level: "low",
      lawful_basis: "Legitimate interest, B2B postal mail — exempt from most digital marketing rules",
      consent_required_before_marketing: false,
      personalization_context: "Personalise the letter (city, business type, a specific public observation).",
      opt_out_handling: "Maintain a paper DNC log; any returned 'refusé' marks the address DNC.",
      recommended_order: 8,
    });
  }

  // 10. Partner introduction — always available, highest-quality channel
  paths.push({
    channel: "partner_intro",
    target: `Photographers / cleaning / linen / smart-locks / interior designers active in ${lead.city ?? "the area"}`,
    source: "Inferred — partner network mapping (Reverse Concierge strategy)",
    risk_level: "low",
    lawful_basis: "Introduction via mutual professional contact — outside cold-outreach rules",
    consent_required_before_marketing: false,
    personalization_context: "The partner makes the intro; we don't reveal we found the lead via prospecting.",
    opt_out_handling: "If the lead declines, never approach via another channel.",
    recommended_order: 9,
  });

  return paths.sort((a, b) => a.recommended_order - b.recommended_order);
}
