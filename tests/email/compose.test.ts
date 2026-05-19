import { describe, it, expect } from "vitest";
import { applyTemplate, parseJsonish, type LeadForCompose } from "@/lib/email/compose";

const lead: LeadForCompose = {
  id: "lead-1",
  primary_name: "Marie Dupont",
  person_name: "Marie",
  company_name: "Villa Marie SAS",
  lead_type: "Gîte / Villa Operator",
  city: "Biarritz",
  country: "France",
  website_url: "https://villa-marie.fr",
  email: "marie@villa-marie.fr",
  phone: "+33612345678",
  superhost: true,
  review_count: 87,
  estimated_property_count: 3,
  has_booking_engine: false,
  has_chatbot: false,
  automation_level: "low",
  quality_summary: "Superhost in Biarritz, no booking engine.",
  suggested_angle: "Direct booking funnel",
};

describe("applyTemplate — placeholder substitution", () => {
  it("replaces {{primary_name}} and {{city}}", () => {
    const out = applyTemplate("Bonjour {{primary_name}} à {{city}}", lead);
    expect(out).toBe("Bonjour Marie Dupont à Biarritz");
  });

  it("handles whitespace inside the placeholder", () => {
    expect(applyTemplate("Hi {{ primary_name }}", lead)).toBe("Hi Marie Dupont");
    expect(applyTemplate("Hi {{  primary_name  }}", lead)).toBe("Hi Marie Dupont");
  });

  it("is case-insensitive on the placeholder key", () => {
    expect(applyTemplate("Hi {{PRIMARY_NAME}}", lead)).toBe("Hi Marie Dupont");
  });

  it("substitutes numeric fields as strings", () => {
    expect(applyTemplate("{{review_count}} reviews", lead)).toBe("87 reviews");
  });

  it("collapses unknown placeholders to an empty string instead of leaving mustaches visible", () => {
    expect(applyTemplate("Hi {{nonexistent_field}}, ok?", lead)).toBe("Hi , ok?");
  });

  it("leaves untemplated text untouched", () => {
    expect(applyTemplate("No placeholder here.", lead)).toBe("No placeholder here.");
  });

  it("works on multi-line bodies", () => {
    const tmpl = "Bonjour {{primary_name}},\n\nNotre offre pour {{city}}…\n\n— L'équipe";
    expect(applyTemplate(tmpl, lead)).toContain("Bonjour Marie Dupont");
    expect(applyTemplate(tmpl, lead)).toContain("offre pour Biarritz");
  });

  it("substitutes boolean fields as empty string (not 'true'/'false') to keep copy clean", () => {
    // applyTemplate only emits strings/numbers; booleans collapse to "".
    // This means writers shouldn't put {{superhost}} in templates — confirms intent.
    expect(applyTemplate("Status: {{superhost}}", lead)).toBe("Status: ");
  });
});

describe("parseJsonish — tolerant LLM-output parser", () => {
  it("parses a clean JSON object", () => {
    const out = parseJsonish(`{"subject":"Hello","body":"World"}`);
    expect(out).toEqual({ subject: "Hello", body: "World" });
  });

  it("trims whitespace around the JSON", () => {
    const out = parseJsonish(`\n\n  {"subject":"S","body":"B"}  \n`);
    expect(out).toEqual({ subject: "S", body: "B" });
  });

  it("strips ```json fenced code blocks", () => {
    const out = parseJsonish('```json\n{"subject":"S","body":"B"}\n```');
    expect(out).toEqual({ subject: "S", body: "B" });
  });

  it("strips plain ``` fenced blocks", () => {
    const out = parseJsonish('```\n{"subject":"S","body":"B"}\n```');
    expect(out).toEqual({ subject: "S", body: "B" });
  });

  it("extracts the first JSON-like blob when there's leading prose", () => {
    // Loose extraction with /\{[\s\S]*?\}/ — minimal blob
    const out = parseJsonish(
      `Sure, here's the email you asked for:\n\n{"subject":"S","body":"B"}`
    );
    expect(out).toEqual({ subject: "S", body: "B" });
  });

  it("returns null when there's no JSON at all", () => {
    expect(parseJsonish("nothing here")).toBeNull();
  });

  it("returns null when fields are wrong types", () => {
    expect(parseJsonish(`{"subject": 42, "body": "x"}`)).toBeNull();
    expect(parseJsonish(`{"subject": "x"}`)).toBeNull(); // missing body
  });

  it("preserves newlines inside the body field", () => {
    const out = parseJsonish(`{"subject":"S","body":"Line one.\\nLine two."}`);
    expect(out?.body).toBe("Line one.\nLine two.");
  });

  it("handles JSON whose values contain literal '{{placeholder}}' strings (general_template mode)", () => {
    // The chatbot is INSTRUCTED to emit {{primary_name}} / {{city}} when
    // drafting a general template. The previous loose extractor used a
    // non-greedy /\{[\s\S]*?\}/ match which would stop at the FIRST }
    // inside the body's }}-closer and produce truncated, unparseable JSON.
    const raw = `{"subject":"Bonjour {{primary_name}}","body":"Salut {{primary_name}} à {{city}}, on parle ?"}`;
    const out = parseJsonish(raw);
    expect(out?.subject).toBe("Bonjour {{primary_name}}");
    expect(out?.body).toBe("Salut {{primary_name}} à {{city}}, on parle ?");
  });

  it("handles JSON with leading prose AND mustache placeholders in the body", () => {
    const raw = `Voici votre email :\n{"subject":"Sujet pour {{primary_name}}","body":"Bonjour {{primary_name}}.\\nÀ propos de {{city}}…\\n\\n— L'équipe"}`;
    const out = parseJsonish(raw);
    expect(out).not.toBeNull();
    expect(out?.subject).toContain("{{primary_name}}");
    expect(out?.body).toContain("{{city}}");
  });
});
