export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    // Callers surface `error.message`, so reject with a readable Error rather
    // than an empty rejection (which renders as "undefined" in a toast).
    return Promise.reject(new Error("Clipboard is unavailable in this browser context"));
  }
}

export async function pasteText(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return null;
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
