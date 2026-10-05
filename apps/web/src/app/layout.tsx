import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Manrope, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ABB Bailey INFI 90 Migration Studio | Valmet",
  description:
    "Decode legacy ABB Bailey INFI 90 engineering data, reconstruct graphics and engineering relationships, and generate traceable migration-ready outputs.",
  icons: {
    icon: [
      { url: "/valmet-logo.png", type: "image/png", sizes: "213x212" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/valmet-logo.png",
    shortcut: "/valmet-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} ${inter.variable} ${plexMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
