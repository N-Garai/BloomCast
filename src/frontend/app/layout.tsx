import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BloomCast — Algal Bloom Early Warning System",
  description: "Predictive early warning for cyanobacteria blooms in urban freshwater. 3-7 day lead time, free and open source.",
  openGraph: {
    title: "BloomCast",
    description: "From seeing blooms to seeing them coming.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}