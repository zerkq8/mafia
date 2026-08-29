import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "مافيا الكويت",
  description: "نسخة إلكترونية من لعبة المافيا للديوانية",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-ink text-cream">{children}</body>
    </html>
  );
}
