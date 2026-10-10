import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MessageContent({ text }: { text: string }) {
  return <div className="min-w-0 break-words text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
    <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
      p: ({ children }) => <p className="my-3 whitespace-pre-line">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      h1: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold">{children}</h3>,
      h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>,
      h3: ({ children }) => <h4 className="mb-2 mt-4 font-semibold">{children}</h4>,
      h4: ({ children }) => <h4 className="mb-2 mt-4 font-semibold">{children}</h4>,
      ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children, start }) => <ol start={start} className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
      li: ({ children }) => <li className="pl-1 [&>p]:my-1">{children}</li>,
      a: ({ children, href }) => href
        ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-current/50 underline-offset-2 hover:decoration-current">{children}</a>
        : <span>{children}</span>,
      code: ({ children }) => <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
      pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-black/5 p-3 text-xs leading-5 [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
      blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-current/25 pl-3 opacity-85">{children}</blockquote>,
      table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
      th: ({ children }) => <th className="border border-current/15 bg-black/5 px-3 py-2 font-semibold">{children}</th>,
      td: ({ children }) => <td className="border border-current/15 px-3 py-2 align-top">{children}</td>,
      hr: () => <hr className="my-4 border-current/15" />,
      // Replies may contain untrusted source data; do not load remote images.
      img: ({ alt }) => <span>{alt}</span>,
    }}>{text}</Markdown>
  </div>;
}
