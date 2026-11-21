import { Marked } from 'marked';

const markdown = new Marked({ breaks: true });
markdown.use({
  renderer: {
    html: () => '',
    image: () => '',
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      try {
        const url = new URL(href);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return label;
        const safe = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } catch {
        return label;
      }
    }
  }
});

export function renderReleaseNotes(body: string) {
  return markdown.parse(body, { async: false });
}
