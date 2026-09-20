import type { Metadata } from "next";
import { Manrope, Outfit } from "next/font/google";
import "./globals.css";

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
    "Upload a Bailey INFI 90 module ZIP, review mapped I/O and logic, then export — no project library.",
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
      <body className={`${sans.variable} ${display.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
