/**
 * Root layout.
 *
 * Wraps the app in Clerk's <ClerkProvider> ONLY when Clerk is configured, so the
 * scaffold builds and renders without keys. Once NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 * is set, auth context becomes available app-wide automatically.
 */
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Podzi.ai — Platform",
  description:
    "Podcast concatenation platform: auth, database, payments, and integrations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const body = (
    <html lang="en">
      <body>{children}</body>
    </html>
  );

  // Only mount ClerkProvider when keys exist; otherwise render plainly so local
  // dev and CI builds work with no credentials.
  if (!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return body;
  }
  return <ClerkProvider>{body}</ClerkProvider>;
}
