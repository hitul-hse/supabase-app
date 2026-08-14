import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "HSE Hub — BI Portal & Analytics Console",
  description:
    "Internal operational BI portal aggregating Asana, TrackingTime, Samdock and FactorialHR into unified executive, team-lead, project, and timesheet dashboards.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans bg-[var(--page)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}
