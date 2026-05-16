import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Subtle dotted grid — drawn with the muted-foreground token so it adapts to theme */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none opacity-[0.18] dark:opacity-[0.12]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--muted-foreground) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Soft accent glow at the top of the page — picks up the active accent */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[720px] h-[340px] -z-10 pointer-events-none opacity-40 dark:opacity-25 blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse at top, oklch(from var(--primary) l c h / 0.22), transparent 70%)",
        }}
      />
      <Nav />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
