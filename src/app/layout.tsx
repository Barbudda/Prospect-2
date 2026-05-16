import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ColorThemeProvider } from "@/components/color-theme-provider";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "Prospect — Airbnb Leads",
  description: "Find contactable Airbnb-related B2B prospects automatically",
};

// Applied before React hydrates so the stored color theme class is already on
// <html> on first paint — no flash between the default violet and the user's
// chosen accent.
const colorThemeBootScript = `
(function(){try{
  var t=localStorage.getItem('prospect-color-theme');
  var valid=['violet','emerald','azure','amber','rose'];
  if(!t||valid.indexOf(t)===-1)t='violet';
  document.documentElement.classList.add('theme-'+t);
}catch(e){document.documentElement.classList.add('theme-violet');}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorThemeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background font-sans">
        <ThemeProvider>
          <ColorThemeProvider>
            {children}
            <Toaster richColors position="top-right" />
          </ColorThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
