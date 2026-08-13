import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Rabbit Hole — follow ideas deeper",
  description: "Explore ideas with AI, branch freely, and never lose the path that brought you there.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f6" },
    { media: "(prefers-color-scheme: dark)", color: "#151617" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Script id="rabbit-hole-theme" strategy="beforeInteractive">
          {`try{var theme=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}`}
        </Script>
      </body>
    </html>
  );
}
