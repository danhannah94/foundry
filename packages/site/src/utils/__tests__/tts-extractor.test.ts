import { describe, it, expect } from "vitest";
import { extractSections } from "../tts-extractor";

function makeContainer(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("extractSections", () => {
  it("extracts sections from DOM with h2/h3/h4 headings", () => {
    const container = makeContainer(`
      <h2 id="intro">Introduction</h2>
      <p>Hello world.</p>
      <h3 id="details">Details</h3>
      <p>Some details here.</p>
      <h2 id="next">Next Section</h2>
      <p>More content.</p>
    `);
    const sections = extractSections(container);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({
      id: "intro",
      title: "Introduction",
      level: 2,
      text: "Hello world.",
    });
    expect(sections[1]).toMatchObject({
      id: "details",
      title: "Details",
      level: 3,
      text: "Some details here.",
    });
    expect(sections[2]).toMatchObject({
      id: "next",
      title: "Next Section",
      level: 2,
      text: "More content.",
    });
  });

  it("strips HTML tags from content", () => {
    const container = makeContainer(`
      <h2 id="s1">Title</h2>
      <p>Text with <strong>bold</strong> and <em>italic</em> words.</p>
    `);
    const sections = extractSections(container);
    expect(sections[0].text).toBe(
      "Text with bold and italic words.",
    );
  });

  it("skips elements with .mermaid class", () => {
    const container = makeContainer(`
      <h2 id="s1">Title</h2>
      <p>Before mermaid.</p>
      <div class="mermaid">graph TD; A-->B;</div>
      <p>After mermaid.</p>
    `);
    const sections = extractSections(container);
    expect(sections[0].text).toBe("Before mermaid. After mermaid.");
  });

  it("skips code blocks by default", () => {
    const container = makeContainer(`
      <h2 id="s1">Title</h2>
      <p>Some text.</p>
      <pre><code>const x = 1;</code></pre>
      <p>More text.</p>
    `);
    const sections = extractSections(container);
    expect(sections[0].text).toBe("Some text. More text.");
    expect(sections[0].text).not.toContain("const x");
  });

  it("includes code blocks when includeCode is true", () => {
    const container = makeContainer(`
      <h2 id="s1">Title</h2>
      <p>Some text.</p>
      <pre><code>const x = 1;</code></pre>
      <p>More text.</p>
    `);
    const sections = extractSections(container, { includeCode: true });
    expect(sections[0].text).toContain("const x = 1;");
  });

  it("handles tables by extracting cell text", () => {
    const container = makeContainer(`
      <h2 id="s1">Title</h2>
      <table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>Alpha</td><td>1</td></tr>
        <tr><td>Beta</td><td>2</td></tr>
      </table>
    `);
    const sections = extractSections(container);
    expect(sections[0].text).toContain("Name, Value");
    expect(sections[0].text).toContain("Alpha, 1");
    expect(sections[0].text).toContain("Beta, 2");
  });

  it("returns empty array when no headings", () => {
    const container = makeContainer(`<p>Just a paragraph.</p>`);
    const sections = extractSections(container);
    expect(sections).toEqual([]);
  });

  it("sections end at next heading of same or higher level", () => {
    const container = makeContainer(`
      <h2 id="a">Section A</h2>
      <p>Content A.</p>
      <h3 id="a1">Subsection A1</h3>
      <p>Content A1.</p>
      <h2 id="b">Section B</h2>
      <p>Content B.</p>
    `);
    const sections = extractSections(container);
    expect(sections).toHaveLength(3);
    // h2 "Section A" should only have content before h3
    expect(sections[0].text).toBe("Content A.");
    // h3 "Subsection A1" should only have its own content
    expect(sections[1].text).toBe("Content A1.");
    // h2 "Section B" gets its content
    expect(sections[2].text).toBe("Content B.");
  });

  it("provides element reference to heading", () => {
    const container = makeContainer(`<h2 id="x">Heading</h2><p>Text.</p>`);
    const sections = extractSections(container);
    expect(sections[0].element).toBeInstanceOf(HTMLElement);
    expect(sections[0].element.tagName).toBe("H2");
  });
});
