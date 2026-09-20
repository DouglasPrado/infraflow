import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "@xyflow/react/dist/style.css";
import "./globals.css";

/**
 * Superfamília IBM Plex: sans e mono compartilham esqueletos, então métricas em
 * mono alinham com rótulos em sans sem sobressalto (design.md §3).
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "InfraFlow",
  description: "Planeje. Teste. Evolua sua infraestrutura.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
