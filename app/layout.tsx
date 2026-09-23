import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "人物工作台 · Character Desk",
  description: "分析文本中的人物与关系，套用到 SillyTavern 角色卡与世界书，并根据游玩反馈审核修订。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
