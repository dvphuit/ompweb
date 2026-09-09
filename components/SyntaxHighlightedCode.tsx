"use client";

import { useEffect, useState } from "react";
import { ensureLanguageRegistered, isLanguageRegistered, SyntaxHighlighter, vscDarkPlus } from "@/lib/syntax-highlight";

interface Props {
  code: string;
  lang: string;
}

function PlainCode({ code }: { code: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "11px 13px",
        fontSize: "var(--chat-code-font-size)",
        lineHeight: 1.62,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "var(--code-text)",
        backgroundColor: "transparent",
        fontFamily: "var(--font-mono)",
      }}
    >
      {code}
    </pre>
  );
}

export function SyntaxHighlightedCode({ code, lang }: Props) {
  const [ready, setReady] = useState(() => isLanguageRegistered(lang));

  useEffect(() => {
    let cancelled = false;
    setReady(isLanguageRegistered(lang));
    const promise = ensureLanguageRegistered(lang);
    if (promise) {
      promise.then(() => { if (!cancelled) setReady(true); });
    }
    return () => { cancelled = true; };
  }, [lang]);

  if (!ready) {
    return <PlainCode code={code} />;
  }

  return (
    <SyntaxHighlighter
      language={lang || "text"}
      // Code blocks always sit on the dark ink surface (--code-bg), in both
      // light and dark themes, so the dark token palette is the right one.
      style={vscDarkPlus}
      showLineNumbers
      lineNumberStyle={{ color: "color-mix(in srgb, var(--code-text) 40%, transparent)", fontStyle: "normal" }}
      customStyle={{
        margin: 0,
        padding: "11px 13px",
        fontSize: "var(--chat-code-font-size)",
        lineHeight: 1.62,
        borderRadius: 0,
        backgroundColor: "transparent",
      }}
      codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
