import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Mono } from "next/font/google";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic", "vietnamese"],
  variable: "--font-sans",
  display: "swap",
});
export const metadata: Metadata = {
  title: "omp web",
  description: "Web UI for the oh-my-pi (omp) coding agent",
  // PWA-like behavior on iOS: standalone chrome, no telephone autodetect.
  appleWebApp: {
    capable: true,
    title: "omp web",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

// theme-color adapts to light/dark so the browser chrome / iOS status bar
// matches the active theme. `viewportFit: cover` lets us honor safe-area-inset
// (used by DirectoryPicker footer) on notched devices.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#09090B" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} ${inter.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        {/* Pre-hydration: apply stored appearance and color preset before first
            paint. This mirrors the selectors in globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var e=document.documentElement,t=localStorage.getItem("omp-theme"),p=localStorage.getItem("omp-theme-preset"),d=matchMedia("(prefers-color-scheme: dark)").matches,a=["obsidian","carbon","cyber","emerald","violet","amber"],m={"ember":"obsidian","graphite":"carbon","ocean":"cyber","forest":"emerald","rose":"violet","amber":"amber"};if(t==="dark"||(t!=="light"&&t!=="dark"&&d))e.classList.add("dark");if(p&&m[p])p=m[p];e.dataset.themePreset=a.indexOf(p)>-1?p:"obsidian"}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem("omp-lang");if(l!=="en"&&l!=="zh-CN"&&l!=="ja"){var n=(navigator.language||"").toLowerCase();l=n.indexOf("zh")===0?"zh-CN":n.indexOf("ja")===0?"ja":"en"}document.documentElement.lang=l}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
