import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hodnotitel projevů — Toastmasters",
  description: "Poslouchá projev, přepíše ho a připraví podklad pro hodnocení.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
