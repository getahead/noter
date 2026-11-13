// A small safe Markdown subset. Links and raw HTML stay literal text (PM-08).
import type { ReactNode } from "react";

type ListBlock = { type: "ul" | "ol"; items: Array<{ text: string; children: ListBlock[] }> };

const inline = (text: string): ReactNode[] =>
  text.split(/(\[[^\]\n]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
        : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : p,
  );

const renderList = (list: ListBlock, key: number): ReactNode => {
  const Tag = list.type;
  return <Tag key={key}>{list.items.map((item, i) => <li key={i}>{inline(item.text)}{item.children.map((child, j) => renderList(child, j))}</li>)}</Tag>;
};

// @cpt-component:cpt-noter-component-ui-output-section:p1
export function MarkdownBody({ md, lang }: { md: string; lang?: string }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let lists: ListBlock[] = [];
  let stack: Array<{ indent: number; list: ListBlock; item: ListBlock["items"][number] }> = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushLists = () => {
    for (const list of lists) blocks.push(renderList(list, blocks.length));
    lists = [];
    stack = [];
  };

  for (const line of md.split("\n")) {
    if (!line.trim()) {
      flushParagraph();
      flushLists();
      continue;
    }
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const indent = item[1]!.replace(/\t/g, "    ").length;
      const type = /^\d/.test(item[2]!) ? "ol" : "ul";
      while (stack.length && indent <= stack[stack.length - 1]!.indent) stack.pop();
      const parent = stack[stack.length - 1];
      let list = parent?.item.children.at(-1);
      if (parent && (!list || list.type !== type)) {
        list = { type, items: [] };
        parent.item.children.push(list);
      } else if (!parent) {
        list = lists.at(-1);
        if (!list || list.type !== type) {
          list = { type, items: [] };
          lists.push(list);
        }
      }
      const current = list!;
      const node = { text: item[3]!, children: [] };
      current.items.push(node);
      stack.push({ indent, list: current, item: node });
      continue;
    }
    flushLists();
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      flushParagraph();
      const Tag = `h${head[1]!.length + 2}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={blocks.length}>{inline(head[2]!)}</Tag>);
    } else paragraph.push(line.trim());
  }
  flushParagraph();
  flushLists();
  return <div className="pc-md" lang={lang}>{blocks}</div>;
}
