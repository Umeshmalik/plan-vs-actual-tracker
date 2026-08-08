import type { Metadata } from "next";
import { Archivo, Bitter, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";
import "./globals.css";

// Three type roles from frontend-plan.md §2, self-hosted by next/font so first
// paint has no third-party hop. globals.css binds them to Tailwind's font-sans
// / font-mono / font-display.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-archivo",
  display: "swap",
});
const bitter = Bitter({ subsets: ["latin"], weight: ["600"], variable: "--font-bitter", display: "swap" });
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Plan vs Actual",
  description: "Monthly spending targets vs actuals, with variance and closed periods.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(archivo.variable, bitter.variable, plex.variable)}>
      <body>
        <Providers>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
