// What the client actually wrote in a reply, as plain text. Mail apps often
// send only HTML, and every reply carries a quoted copy of our email under
// "On <date>, Dunn wrote:". The owner needs the new words, not the markup.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*<\/blockquote>/gi, '') // the quoted original
    .replace(/<div[^>]*class="?gmail_quote[\s\S]*$/i, '') // Gmail's quote wrapper
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li|tr|h\d)(\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : m));
}

export function replyText(body: string | null | undefined): string {
  let text = body ?? '';
  if (/<[a-z!][\s\S]*>/i.test(text)) text = htmlToText(text);

  const kept: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const l = line.trim();
    // Everything after the quote header is our own email coming back.
    if (/^On .+wrote:?$/i.test(l) || /^On .+(at|,) .+$/i.test(l) && /wrote/i.test(l)) break;
    if (/^-{2,}\s*Original Message/i.test(l) || /^From: .+/i.test(l) && kept.length > 0) break;
    if (l.startsWith('>')) continue;
    if (/^Sent from my (iPhone|iPad|Android|mobile)/i.test(l)) continue;
    kept.push(line.trimEnd());
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
