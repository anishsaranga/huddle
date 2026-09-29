import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Huddle", template: "%s · Huddle" },
  description: "Private fitness group app: recovery, strain and sleep, together.",
  applicationName: "Huddle",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Huddle",
  },
  formatDetection: { telephone: false },
  // Next only emits mobile-web-app-capable; iOS Safari still keys off the apple- variant.
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0B0D",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark ${hanken.variable} ${barlowCondensed.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
