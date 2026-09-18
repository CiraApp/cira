import { Fragment } from "react";

/**
 * The little Markdown Ask Cira's answers are allowed.
 *
 * Paragraphs, bold and italic, inline code, bullet and numbered lists, tables,
 * and links - which is everything the instructions permit and nothing else.
 * Built as React elements, never as an HTML string: the text comes from a
 * model that was reading data from other software, and nothing it writes
 * should ever reach the page as markup. A link is only a link when it is
 * http or https.
 */
export function Markdown({ text }: { text: string }) {
  return <>{blocks(text).map((block, i) => renderBlock(block, i))}</>;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function blocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // A table needs a header row and the rule beneath it; a lone line of
    // pipes is only text.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) {
        rows.push(cells(lines[i] ?? ""));
        i += 1;
      }
      out.push({ kind: "table", head, rows });
      continue;
    }

    const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (list !== null) {
      const items: string[] = [];
      while (i < lines.length && list.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(list, "$1"));
        i += 1;
      }
      out.push({ kind: list === BULLET ? "ul" : "ol", items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !BULLET.test(lines[i] ?? "") &&
      !NUMBERED.test(lines[i] ?? "") &&
      !(TABLE_ROW.test(lines[i] ?? "") && TABLE_RULE.test(lines[i + 1] ?? ""))
    ) {
      // Headings are not part of the vocabulary; one that slips through is
      // shown as its words rather than as a stray row of hashes.
      paragraph.push((lines[i] ?? "").replace(/^#{1,6}\s+/, ""));
      i += 1;
    }
    out.push({ kind: "p", lines: paragraph });
  }

  return out;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderBlock(block: Block, key: number) {
  switch (block.kind) {
    case "p":
      return (
        <p key={key}>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? <br /> : null}
              {inline(line)}
            </Fragment>
          ))}
        </p>
      );
    case "ul":
      return (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="ask-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.head.map((_, c) => (
                    <td key={c}>{inline(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Bold, italic, code and links, in one pass over a line. */
const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));

    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={at}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code key={at}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]("));
      const href = token.slice(token.indexOf("](") + 2, -1);
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={at} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      out.push(<em key={at}>{token.slice(1, -1)}</em>);
    }

    last = at + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}
