"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { useColorTheme, COLOR_THEMES, type ColorThemeId } from "@/components/color-theme-provider";
import { cn } from "@/lib/utils";
import {
  Sun, Moon, LogOut, LayoutDashboard, Users, Settings, History, ScanSearch, Map,
  Network, BarChart3, ShieldAlert, Handshake, CheckSquare, Sparkles, Activity, Palette, Check, Mail,
} from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, highlight: true },
  { href: "/visual", label: "Visual", icon: ScanSearch, highlight: true },
  { href: "/maps", label: "Maps", icon: Map, highlight: true },
  { href: "/mailing", label: "Mailing", icon: Mail, highlight: true },
  { href: "/ecosystem", label: "Ecosystem", icon: Sparkles, highlight: false },
  { href: "/operators", label: "Operators", icon: Network, highlight: false },
  { href: "/partners", label: "Partners", icon: Handshake, highlight: false },
  { href: "/review", label: "Review", icon: ShieldAlert, highlight: false },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, highlight: false },
  { href: "/", label: "Search", icon: LayoutDashboard, highlight: false },
  { href: "/runs", label: "Runs", icon: History, highlight: false },
  { href: "/leads", label: "Leads", icon: Users, highlight: false },
  { href: "/health", label: "Health", icon: Activity, highlight: false },
  { href: "/settings", label: "Settings", icon: Settings, highlight: false },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { theme: colorTheme, setTheme: setColorTheme } = useColorTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const activeSwatch = COLOR_THEMES.find((t) => t.id === colorTheme)?.sample ?? "var(--primary)";

  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

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
        {/* Three-column grid keeps the nav perfectly centered regardless of how
            wide the logo or right-side actions become. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center h-14 gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground text-xs font-bold tracking-tight">P</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">Prospect</span>
          </Link>

          {/* Centered nav links — overflow-x scrolls on narrow screens so the
              actions on the right never get clipped. */}
          <div className="flex justify-center min-w-0">
            <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
              {NAV_LINKS.map(({ href, label, icon: Icon, highlight }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap shrink-0",
                      active && highlight
                        ? "bg-primary/15 text-primary"
                        : active
                        ? "bg-primary/10 text-primary"
                        : highlight
                        ? "text-primary hover:bg-primary/10"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Right actions — always pinned to the right edge */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Theme picker — shows the active accent as a visible swatch so
                users can spot it at a glance. */}
            <div ref={pickerRef} className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="h-8 pl-1.5 pr-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors border border-border/60"
                aria-label="Change color theme"
                aria-haspopup="menu"
                aria-expanded={pickerOpen}
                title="Change color theme"
              >
                <span
                  className="h-4 w-4 rounded-full ring-1 ring-border/40"
                  style={{ background: activeSwatch }}
                  aria-hidden
                />
                <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline text-muted-foreground">Theme</span>
              </button>
              {pickerOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg p-1.5 z-50">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">Accent color</p>
                  {COLOR_THEMES.map((t) => {
                    const active = colorTheme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setColorTheme(t.id as ColorThemeId); setPickerOpen(false); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors",
                          active ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/60"
                        )}
                      >
                        <span
                          className="h-4 w-4 rounded-full shrink-0 ring-1 ring-border/40"
                          style={{ background: t.sample }}
                          aria-hidden
                        />
                        <span className="flex-1 text-left">{t.label}</span>
                        {active && <Check className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Toggle light / dark"
              title="Toggle light / dark"
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
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
