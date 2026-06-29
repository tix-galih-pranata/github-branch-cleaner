import type { Metadata } from "next";
import type { ReactNode } from "react";
import Nav from "./components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitHub Branch Tools",
  description:
    "List a remote repo's branches and delete all but the ones you keep, or recover a branch after a force push - all without fetching branch content locally.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
