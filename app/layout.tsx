import type { Metadata } from "next";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Recall - Project Intelligence Platform",
  description:
    "Index your project corpus, extract structured knowledge, and surface what needs attention.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;600&family=IBM+Plex+Mono:wght@400&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
