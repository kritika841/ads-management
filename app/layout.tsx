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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('adflow-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.theme=t;}catch(e){}})();`
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
