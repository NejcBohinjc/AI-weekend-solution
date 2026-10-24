import { splitLinks } from "@/lib/linkify";

/** Plain text with its line breaks kept and web addresses as links. Never renders HTML. */
export function LinkifiedText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-line break-words ${className}`}>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900">
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </p>
  );
}
