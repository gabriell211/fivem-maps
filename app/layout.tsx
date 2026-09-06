import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FiveM Map Forge",
  description: "Gerador de mapas para FiveM com preview 3D e pipeline Blender + Sollumz.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
