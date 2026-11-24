import { Slugs, escape } from './text.js';

const punctuation = new Set('\\`*_[]()#+-.!>');
const special = /[\\`*[]/g;

function closing(text, from, marker) {
  let match = text.indexOf(marker, from);
  if (match < 0) return -1;
  let slash = text.indexOf('\\', from);
  while (match >= 0) {
    if (slash >= 0 && slash < match) {
      const escaped = punctuation.has(text[slash + 1]);
      const after = slash + (escaped ? 2 : 1);
      if (match < after) match = text.indexOf(marker, after);
      slash = text.indexOf('\\', after);
    } else if (marker === '*' && text[match + 1] === '*') {
      match = text.indexOf('*', match + 2);
    } else {
      return match;
    }
  }
  return -1;
}

function renderSpan(text, href) {
  let html = '';
  let from = 0;
  while (from < text.length) {
    special.lastIndex = from;
    const match = special.exec(text);
    if (match === null) return html + escape(text.slice(from));
    const start = match.index;
    const character = match[0];
    if (start !== from) html += escape(text.slice(from, start));
    from = start + 1;

    if (character === '\\' && punctuation.has(text[from])) {
      html += escape(text[from++]);
    } else if (character === '`') {
      const end = text.indexOf('`', from);
      if (end > from) {
        html += `<code>${escape(text.slice(from, end))}</code>`;
        from = end + 1;
      } else html += '`';
    } else if (character === '*') {
      const marker = text[from] === '*' ? '**' : '*';
      from = start + marker.length;
      const end = closing(text, from, marker);
      if (end > from) {
        const tag = marker.length === 1 ? 'em' : 'strong';
        html += `<${tag}>${renderSpan(text.slice(from, end), href)}</${tag}>`;
        from = end + marker.length;
      } else html += marker;
    } else if (character === '[') {
      const labelEnd = closing(text, from, ']');
      const targetEnd = labelEnd >= 0 && text[labelEnd + 1] === '(' ? text.indexOf(')', labelEnd + 2) : -1;
      if (targetEnd > labelEnd + 2) {
        const target = text.slice(labelEnd + 2, targetEnd);
        if (!/\s/.test(target)) {
          html += `<a href="${escape(href(target))}">${renderSpan(text.slice(from, labelEnd), href)}</a>`;
          from = targetEnd + 1;
          continue;
        }
      }
      html += '[';
    } else html += character;
  }
  return html;
}

function trim(line) {
  let start = 0;
  let end = line.length;
  while (start < end && (line[start] === ' ' || line[start] === '\t')) start++;
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  return start === 0 && end === line.length ? line : line.slice(start, end);
}
const blank = /^[ \t]*$/;
const fence = /^```([a-zA-Z0-9_+-]*)[ \t]*$/;
const fenceClose = /^```[ \t]*$/;
const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const rule = /^(?:---|\*\*\*)[ \t]*$/;
const items = [/^[-*] (.*)$/, /^(\d{1,9})\. (.*)$/];
const continuation = /^ {2,}\S/;

function stopsParagraph(line) {
  switch (line[0]) {
    case undefined: return true;
    case ' ':
    case '\t': return blank.test(line);
    case '`': return fence.test(line);
    case '#': return !!heading.exec(line)?.[2];
    case '-':
    case '*': return rule.test(line);
    default: return false;
  }
}

export function renderMarkdown(body, href, slug) {
  const lines = body.split('\n');
  const toc = [];
  const ids = new Slugs();
  let excerpt;
  const chunks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++];
    const first = line[0];
    if (!line || ((first === ' ' || first === '\t') && blank.test(line))) continue;

    const code = first === '`' ? fence.exec(line) : null;
    if (code) {
      chunks.push(code[1] ? `<pre><code class="language-${code[1]}">` : '<pre><code>');
      while (index < lines.length && !fenceClose.test(lines[index])) chunks.push(escape(lines[index++]) + '\n');
      index++;
      chunks.push('</code></pre>\n');
      continue;
    }

    const header = first === '#' ? heading.exec(line) : null;
    if (header?.[2]) {
      const level = header[1].length;
      const id = ids.take(slug(header[2]));
      const title = renderSpan(header[2], href);
      chunks.push(`<h${level} id="${id}">${title}</h${level}>\n`);
      if (level === 2 || level === 3) toc.push({ level, id, html: title });
      continue;
    }

    if ((first === '-' || first === '*') && rule.test(line)) {
      chunks.push('<hr>\n');
      continue;
    }
    if (first === '>') {
      const quoted = [];
      do {
        const quote = lines[index - 1];
        const text = trim(quote.slice(quote[1] === ' ' ? 2 : 1));
        if (text) quoted.push(text);
        if (lines[index]?.[0] !== '>') break;
        index++;
      } while (true);
      chunks.push('<blockquote>\n');
      if (quoted.length) chunks.push(`<p>${renderSpan(quoted.join('\n'), href)}</p>\n`);
      chunks.push('</blockquote>\n');
      continue;
    }

    let ordered = 0;
    let item = null;
    if (first === '-' || first === '*') item = items[0].exec(line);
    else if (first >= '0' && first <= '9') {
      item = items[1].exec(line);
      ordered = 1;
    }
    if (item) {
      const tag = ordered ? 'ol' : 'ul';
      chunks.push(ordered && +item[1] !== 1 ? `<ol start="${+item[1]}">\n` : `<${tag}>\n`);
      while (item) {
        let text = trim(item[ordered + 1]);
        while (index < lines.length && continuation.test(lines[index])) text += '\n' + trim(lines[index++]);
        chunks.push(`<li>${renderSpan(text, href)}</li>\n`);
        item = index < lines.length ? items[ordered].exec(lines[index]) : null;
        if (item) index++;
      }
      chunks.push(`</${tag}>\n`);
      continue;
    }

    let paragraph = trim(line);
    while (index < lines.length && !stopsParagraph(lines[index])) paragraph += '\n' + trim(lines[index++]);
    const rendered = renderSpan(paragraph, href);
    excerpt ??= rendered;
    chunks.push(`<p>${rendered}</p>\n`);
  }
  return { html: chunks.join(''), toc, excerpt: excerpt ?? '' };
}
