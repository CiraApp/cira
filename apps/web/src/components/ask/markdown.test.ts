import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

/**
 * The answer text comes from a model that was reading data out of other
 * software. What matters most is what it can never do: become markup.
 */
describe("Markdown", () => {
  it("never turns text into markup", () => {
    const html = render('<script>alert(1)</script> and <img src=x onerror="bad()">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only links to http and https", () => {
    expect(render("[safe](https://example.com)")).toContain('href="https://example.com"');
    const html = render("[click](javascript:alert(1))");
    expect(html).not.toContain("href");
    expect(html).toContain("click");
  });

  it("renders bold, lists and a table", () => {
    const html = render(
      [
        "You made **$482,913.55** in August.",
        "",
        "- one",
        "- two",
        "",
        "| Month | Revenue |",
        "| --- | --- |",
        "| July | $451,208.10 |",
      ].join("\n"),
    );
    expect(html).toContain("<strong>$482,913.55</strong>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<th>Month</th>");
    expect(html).toContain("<td>$451,208.10</td>");
  });

  it("shows a stray heading as its words", () => {
    expect(render("## Revenue")).toBe("<p>Revenue</p>");
  });
});
