import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import { ThemeProvider } from "./ThemeContext"; // 👈 Import it here

export const metadata: Metadata = {
  title: "StreamAnime",
  description: "Discover and stream anime, movies, and TV series.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* 👈 Wrap everything inside the body */}
        <ThemeProvider> 
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
