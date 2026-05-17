import Link from "next/link";

export const metadata = {
  title: "Free tools for STR operators — Prospect",
  description:
    "Free, public utilities for short-term rental hosts: estimate your OTA fee leak, audit your direct booking site, and more.",
};

export default function ToolsIndex() {
  const tools = [
    {
      slug: "direct-booking-calculator",
      title: "OTA Fee Leak Calculator",
      blurb:
        "How much money is Airbnb taking from you every year? Punch in your nightly rate and yearly nights — get an honest estimate in 5 seconds.",
      time: "5 sec",
    },
    {
      slug: "listing-audit",
      title: "Direct-Booking Site Audit",
      blurb:
        "Paste your own website URL. Get a Lighthouse-style report covering booking engine, schema, mobile, language, and conversion gaps.",
      time: "30 sec",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="text-center space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Free tools for STR operators</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Quick, honest utilities. No login, no email required unless you want
          the full report by email.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tools.map((t) => (
          <Link
            key={t.slug}
            href={`/tools/${t.slug}`}
            className="block rounded-2xl border border-border/60 bg-card p-6 hover:border-primary/50 transition-colors"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t.time}
            </div>
            <h2 className="font-semibold text-lg mt-1">{t.title}</h2>
            <p className="text-sm text-muted-foreground mt-2">{t.blurb}</p>
            <p className="text-xs text-primary mt-3">Run the tool →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
