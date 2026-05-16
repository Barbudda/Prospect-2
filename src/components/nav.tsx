"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { useColorTheme, COLOR_THEMES, type ColorThemeId } from "@/components/color-theme-provider";
import { cn } from "@/lib/utils";
import {
  Sun, Moon, LogOut, LayoutDashboard, Users, Settings, History, ScanSearch, Map,
  Network, BarChart3, ShieldAlert, Handshake, CheckSquare, Sparkles, Activity, Palette, Check,
} from "lucide-react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, highlight: true },
  { href: "/visual", label: "Visual", icon: ScanSearch, highlight: true },
  { href: "/maps", label: "Maps", icon: Map, highlight: true },
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

  // Close picker on outside click
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

          {/* Right actions */}
          <div className="flex items-center gap-1 ml-auto">
            {/* Color theme picker */}
            <div ref={pickerRef} className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Change accent color"
                aria-haspopup="menu"
                aria-expanded={pickerOpen}
              >
                <Palette className="h-4 w-4" />
              </button>
              {pickerOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg p-1.5 z-50">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">Accent</p>
                  {COLOR_THEMES.map((t) => {
                    const active = colorTheme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setColorTheme(t.id as ColorThemeId); setPickerOpen(false); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors",
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
