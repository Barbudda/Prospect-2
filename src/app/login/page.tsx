"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Zap } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "magic">("login");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email });
        if (error) throw error;
        toast.success("Magic link sent! Check your inbox.");
        setLoading(false);
        return;
      }

      const { error } =
        mode === "signup"
          ? await supabase.auth.signUp({ email, password })
          : await supabase.auth.signInWithPassword({ email, password });

      if (error) throw error;

      if (mode === "signup") {
        toast.success("Account created! Check your email to confirm.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 -z-10"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, oklch(0.7 0.02 270 / 0.3) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] -z-10"
        style={{
          background: "radial-gradient(ellipse at top, oklch(0.541 0.281 283 / 0.12), transparent 70%)",
        }}
      />

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary shadow-lg mb-4">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Prospect</h1>
          <p className="text-sm text-muted-foreground mt-1">Airbnb B2B Lead Generation</p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {mode === "signup" ? "Create an account" : mode === "magic" ? "Magic link" : "Welcome back"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === "signup"
                ? "Enter your email to get started"
                : mode === "magic"
                ? "We'll send you a sign-in link"
                : "Sign in to your account"}
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== "magic" && (
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            <Button type="submit" className="w-full font-semibold" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                  Please wait...
                </span>
              ) : mode === "magic"
                ? "Send Magic Link"
                : mode === "signup"
                ? "Create Account"
                : "Sign In"}
            </Button>
          </form>

          <div className="flex flex-col gap-1.5 text-center text-xs text-muted-foreground">
            {mode === "login" && (
              <>
                <button type="button" onClick={() => setMode("signup")} className="hover:text-foreground transition-colors">
                  Don&apos;t have an account? <span className="font-medium underline underline-offset-2">Sign up</span>
                </button>
                <button type="button" onClick={() => setMode("magic")} className="hover:text-foreground transition-colors">
                  <span className="underline underline-offset-2">Sign in with magic link</span>
                </button>
              </>
            )}
            {mode !== "login" && (
              <button type="button" onClick={() => setMode("login")} className="hover:text-foreground transition-colors">
                ← <span className="underline underline-offset-2">Back to sign in</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
