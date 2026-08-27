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
    return Promise.reject();
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
