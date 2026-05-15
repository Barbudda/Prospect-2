"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Sun, Moon, LogOut, LayoutDashboard, Users, Settings, History, ScanSearch, Map, Network, BarChart3, ShieldAlert, Handshake } from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, highlight: true },
  { href: "/visual", label: "Visual", icon: ScanSearch, highlight: true },
  { href: "/maps", label: "Maps", icon: Map, highlight: true },
  { href: "/operators", label: "Operators", icon: Network, highlight: false },
  { href: "/partners", label: "Partners", icon: Handshake, highlight: false },
  { href: "/review", label: "Review", icon: ShieldAlert, highlight: false },
  { href: "/", label: "Search", icon: LayoutDashboard, highlight: false },
  { href: "/runs", label: "Runs", icon: History, highlight: false },
  { href: "/leads", label: "Leads", icon: Users, highlight: false },
  { href: "/settings", label: "Settings", icon: Settings, highlight: false },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  async function signOut() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground text-xs font-bold tracking-tight">P</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">Prospect</span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label, icon: Icon, highlight }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active && highlight
                      ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                      : active
                      ? "bg-primary/10 text-primary"
                      : highlight
                      ? "text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Link>
              );
            })}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={signOut}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
