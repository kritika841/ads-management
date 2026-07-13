import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdFlow",
  description: "Internal ad creative management and approval system"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
