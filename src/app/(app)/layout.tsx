import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Subtle grid background */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, oklch(0.7 0.02 270 / 0.3) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Top gradient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] -z-10 pointer-events-none opacity-40 dark:opacity-20"
        style={{
          background: "radial-gradient(ellipse at top, oklch(0.541 0.281 283 / 0.15), transparent 70%)",
        }}
      />
      <Nav />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
