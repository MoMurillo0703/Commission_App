import type { Metadata } from "next";
import "./theme.css";
import "./globals.css";
import "./demo.css";

export const metadata: Metadata = {
  title: "Commissions | Murillo Insurance",
  description: "Agency commission intake, reconciliation, and reporting",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
