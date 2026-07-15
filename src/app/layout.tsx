import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AnalyticsEvents } from "@/components/analytics-events";
import {
  AnalyticsScripts,
  GoogleTagManagerNoScript,
} from "@/components/analytics-scripts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://landlsourdough.com"),
  applicationName: "Luna & Lorelai's Sourdough",
  title: {
    default:
      "Luna & Lorelai's Sourdough | Local Sourdough Delivery in Canton & Woodstock, GA",
    template: "%s | Luna & Lorelai's Sourdough",
  },
  description:
    "Order naturally leavened sourdough bread, cinnamon sourdough, crackers, and small-batch add-ons for local delivery around Canton and Woodstock, Georgia.",
  keywords: [
    "Canton GA sourdough",
    "sourdough delivery Canton GA",
    "Woodstock GA sourdough",
    "sourdough delivery Woodstock GA",
    "local sourdough bread",
    "cottage bakery Canton Georgia",
    "cottage bakery Woodstock Georgia",
    "fresh bread delivery Canton",
    "fresh bread delivery Woodstock",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/images/luna-lorelais-logo-square-180.png",
    apple: "/images/luna-lorelais-logo-square-180.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "L&L Sourdough",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "Luna & Lorelai's Sourdough | Canton & Woodstock, GA Local Delivery",
    description:
      "Fresh sourdough loaves and small-batch add-ons available by weekly preorder for local delivery around Canton and Woodstock, Georgia.",
    url: "https://landlsourdough.com",
    siteName: "Luna & Lorelai's Sourdough",
    images: [
      {
        url: "/images/sourdough-hero-og.jpg",
        width: 1200,
        height: 630,
        alt: "Fresh sourdough loaves from Luna & Lorelai's Sourdough",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Luna & Lorelai's Sourdough | Canton & Woodstock, GA",
    description:
      "Order weekly sourdough loaves and small-batch add-ons for local delivery around Canton and Woodstock, Georgia.",
    images: ["/images/sourdough-hero-og.jpg"],
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    other: {
      "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || "",
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#23443b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#fffaf2] text-stone-950">
        <GoogleTagManagerNoScript />
        <AnalyticsScripts />
        <AnalyticsEvents />
        {children}
      </body>
    </html>
  );
}
