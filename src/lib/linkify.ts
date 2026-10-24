// Finds web addresses in plain text so they can be shown as links. Pure, unit-tested (linkify.test.ts).

export type TextPart = { text: string; href?: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Splits text into plain parts and links. Trailing punctuation ("see https://x.org.") is not part of a link. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // Drop trailing punctuation, and a closing bracket that has no opening one in the address.
    while (/[.,;:!?)\]]$/.test(url)) {
      const ch = url[url.length - 1];
      if ((ch === ")" && url.split("(").length > url.split(")").length - 1) || (ch === "]" && url.includes("["))) break;
      url = url.slice(0, -1);
    }
    const start = m.index!;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: url.toLowerCase().startsWith("www.") ? `https://${url}` : url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
