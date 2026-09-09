import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Three faces, each with a job. See docs/design-system.md.
//
// These deliberately do NOT use the --font-display / --font-body / --font-mono names.
// Those are the design-system role tokens, defined in globals.css, which compose these
// raw family variables with their fallback stacks. Naming them the same here would have
// the two definitions fight in the cascade.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Taperdeck",
  description:
    "What a band actually plays live. Gap, rotation and rarity across every show we hold.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface-000 text-text-primary">
        {children}
      </body>
    </html>
  );
}
