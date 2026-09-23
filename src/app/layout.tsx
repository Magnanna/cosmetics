import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kenfri POS",
  description: "Point of sale and books for Kenfri Cosmetics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
