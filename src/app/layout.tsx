import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "Luna & Lorelai's Sourdough | Local Sourdough Delivery in Canton, GA",
    template: "%s | Luna & Lorelai's Sourdough",
  },
  description:
    "Warm, naturally leavened sourdough bread and add-ons delivered locally from Canton, Georgia.",
  openGraph: {
    title: "Luna & Lorelai's Sourdough",
    description:
      "Weekly sourdough drops, local delivery, and small-batch add-ons from Canton, Georgia.",
    url: "https://landlsourdough.com",
    siteName: "Luna & Lorelai's Sourdough",
    images: ["/images/sourdough-hero.png"],
    locale: "en_US",
    type: "website",
  },
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
      <body className="min-h-full bg-[#fffaf2] text-stone-950">{children}</body>
    </html>
  );
}
