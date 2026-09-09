import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic", "vietnamese"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  weight: ["500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic", "vietnamese"],
  variable: "--font-inter",
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
    { media: "(prefers-color-scheme: light)", color: "#F5F2EA" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${jetbrainsMono.variable} ${spaceGrotesk.variable} ${inter.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        {/* Pre-hydration: apply stored appearance and color preset before first
            paint. This mirrors the selectors in globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var e=document.documentElement,t=localStorage.getItem("omp-theme"),p=localStorage.getItem("omp-theme-preset"),d=matchMedia("(prefers-color-scheme: dark)").matches,a=["signal","coral","mint","electric"],m={"obsidian":"electric","carbon":"signal","cyber":"electric","emerald":"mint","violet":"electric","amber":"signal","ember":"coral","graphite":"signal","ocean":"electric","forest":"mint","rose":"coral"};if(t==="dark"||(t!=="light"&&t!=="dark"&&d))e.classList.add("dark");if(p&&m[p])p=m[p];e.dataset.themePreset=a.indexOf(p)>-1?p:"signal"}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem("omp-lang");if(l!=="en"&&l!=="zh-CN"&&l!=="ja"){var n=(navigator.language||"").toLowerCase();l=n.indexOf("zh")===0?"zh-CN":n.indexOf("ja")===0?"ja":"en"}document.documentElement.lang=l}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var f=localStorage.getItem("omp-font-size");if(f==="sm"||f==="md"||f==="lg"||f==="xl")document.documentElement.setAttribute("data-font-size",f)}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("omp-ui-scale");if(s==="compact"||s==="standard"||s==="comfortable"||s==="large")document.documentElement.setAttribute("data-ui-scale",s)}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100%", maxHeight: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
