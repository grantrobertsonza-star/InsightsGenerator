import Link from "next/link";

/**
 * A Research assistant message as text, with links to the Knowledge base and Manual pages it names
 * ("/knowledge/crosstabs#significance"), so a cited guide opens in one click. Only those two
 * in-app paths become links; nothing else in a reply is treated as a link.
 */
const GUIDE_PATH = /(\/(?:knowledge|manual)(?:\/[a-z0-9-]+)?(?:#[a-z0-9-]+)?)/g;

export function AssistantMessageText({ text }: { text: string }) {
  const parts = text.split(GUIDE_PATH);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} href={part} className="text-primary underline underline-offset-2 hover:text-primary-hover">
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </>
  );
}
