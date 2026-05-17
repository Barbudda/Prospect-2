import Link from "next/link";

export const dynamic = "force-dynamic";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Public-facing top bar — no app nav, no auth-aware UI */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/tools" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground text-xs font-bold tracking-tight">P</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">Prospect — Free tools</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/tools/direct-booking-calculator" className="hover:text-foreground">
              Leak calculator
            </Link>
            <Link href="/tools/listing-audit" className="hover:text-foreground">
              Listing audit
            </Link>
            <Link href="/partners/register" className="hover:text-foreground">
              Partners
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10">
        {children}
      </main>
      <footer className="border-t border-border/60 mt-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-xs text-muted-foreground">
          Tools are free and public. We never share your inputs without your
          explicit opt-in. Email captures (when consented) are stored under
          GDPR Article 6(1)(a) — consent — with a 12-month retention.
        </div>
      </footer>
    </div>
  );
}
