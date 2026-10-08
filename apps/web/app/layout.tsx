import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Exhibit A",
  description: "An agency intelligence workspace where good ideas come with receipts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
