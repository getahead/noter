// A small Markdown subset (paragraphs, `#`/`##` headings, `-`/`*` lists, **bold**, `code`) drawn as React nodes. Never
// `innerHTML`: raw HTML in the text stays literal text (PM-08).
import type { ReactNode } from "react";

const inline = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : p));

export function MarkdownBody({ md, lang }: { md: string; lang?: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of md.split(/\n{2,}|\n(?=#|[-*] )/)) {
    for (const line of raw.split("\n")) {
      const item = /^[-*] (.*)/.exec(line);
      const head = /^(#{1,2}) (.*)/.exec(line);
      if (item) list.push(item[1]!);
      else if (head) (flush(), blocks.push(head[1]!.length === 1 ? <h3 key={blocks.length}>{inline(head[2]!)}</h3> : <h4 key={blocks.length}>{inline(head[2]!)}</h4>));
      else if (line.trim()) (flush(), blocks.push(<p key={blocks.length}>{inline(line)}</p>));
    }
  }
  flush();
  return <div className="pc-md" lang={lang}>{blocks}</div>;
}
