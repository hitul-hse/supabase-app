import type { Metadata } from "next";
import { Poppins, Cormorant_Garamond, Plus_Jakarta_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

// App-shell UI font. Poppins is the real brand face used on hs-experts.com
// (see DESIGN.md) -- the app shell had drifted to Roboto, which matched
// neither the brand nor the marketing pages.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Demo page display serif — editorial, cinematic
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

// Demo page UI grotesk — optical balance, modern
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

// Demo page display grotesk. Space Grotesk is the closest freely-licensed analogue to
// ABC Monument Grotesk, the face used by the reference sites (sstr.tech) — squarish
// counters, tight apertures, engineered rather than friendly. Drives all display type
// on /demo; do not swap for a humanist sans, it loses the technical register.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Demo page mono — numbers, badges, metadata
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
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
      className={`${poppins.variable} ${cormorant.variable} ${plusJakarta.variable} ${jetbrains.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans bg-[var(--page)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}
