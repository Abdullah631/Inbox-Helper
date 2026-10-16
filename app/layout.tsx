import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Header } from "@/components/Header";
import { themeInitScript } from "@/components/ThemeToggle";
import { SITE } from "@/lib/limits";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: SITE.name,
  description: SITE.description,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Set by middleware.ts. Without it the theme script would be blocked by the CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // The theme script sets data-theme before React hydrates, hence the warning suppression.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Browsers hide the nonce attribute after load (it reads as ""), so React would
            report a mismatch on hydration. That's expected for nonces, hence the suppression. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Header />
        {children}
      </body>
    </html>
  );
}
