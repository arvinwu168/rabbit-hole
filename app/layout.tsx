import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arbor — conversations that branch",
  description: "Explore ideas with AI without flattening every thought into one timeline.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
