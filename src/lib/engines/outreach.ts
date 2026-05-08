import type { LeadType } from "@/lib/types";

export const OUTREACH_ANGLES: Record<LeadType, string> = {
  "Airbnb Concierge":
    "Pitch as a 24/7 AI guest assistant that eliminates repetitive guest questions across all managed properties — reducing team workload at scale.",
  "Property Manager":
    "Pitch as a digital welcome book and automated guest messaging layer that saves hours per week per property.",
  "Direct Booking Owner":
    "Pitch as an AI concierge that improves guest experience, generates 5-star reviews, and handles check-in info automatically.",
  "Vacation Rental Agency":
    "Pitch as a scalable guest support layer that works across all seasonal rentals without adding headcount.",
  "Gîte / Villa Operator":
    "Pitch as a smart digital guidebook that answers guest questions instantly and upsells local experiences.",
  "Co-host / Consultant":
    "Pitch as a tool to offer premium guest experience services to your host clients — a differentiator for your co-hosting offer.",
  "Real Estate Seasonal Rental":
    "Pitch as a guest communication automation layer for seasonal property portfolios.",
  "Unknown STR Lead":
    "Pitch as an AI guest assistant for short-term rentals — personalized follow-up after qualification.",
};

export function generateOutreachAngle(leadType: LeadType): string {
  return OUTREACH_ANGLES[leadType] ?? OUTREACH_ANGLES["Unknown STR Lead"];
}
