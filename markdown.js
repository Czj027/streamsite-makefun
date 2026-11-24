import { Slugs, entity, escape } from './text.js';

const punctuation = new Set('\\`*_[]()#+-.!>');
const special = /[\\`*[&<>"']/g;

function closing(text, from, marker) {
  for (let cursor = from; cursor < text.length; cursor++) {
    if (text[cursor] === '\\' && punctuation.has(text[cursor + 1])) {
      cursor++;
    } else if (marker === '*' && text[cursor] === '*' && text[cursor + 1] === '*') {
      cursor++;
    } else if (text.startsWith(marker, cursor)) {
      return cursor;
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
    if (match === null) return html + text.slice(from);
    const start = match.index;
    const character = match[0];
    html += text.slice(from, start);
    from = start + 1;

    if (character === '\\' && punctuation.has(text[from])) {
      html += entity(text[from++]);
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
    } else html += entity(character);
  }
  return html;
}

const trim = line => line.replace(/^[ \t]+|[ \t]+$/g, '');
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
  let html = '';
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++];
    const first = line[0];
    if (!line || ((first === ' ' || first === '\t') && blank.test(line))) continue;

    const code = first === '`' ? fence.exec(line) : null;
    if (code) {
      html += code[1] ? `<pre><code class="language-${code[1]}">` : '<pre><code>';
      while (index < lines.length && !fenceClose.test(lines[index])) html += escape(lines[index++]) + '\n';
      index++;
      html += '</code></pre>\n';
      continue;
    }

    const header = first === '#' ? heading.exec(line) : null;
    if (header?.[2]) {
      const level = header[1].length;
      const id = ids.take(slug(header[2]));
      const title = renderSpan(header[2], href);
      html += `<h${level} id="${id}">${title}</h${level}>\n`;
      if (level === 2 || level === 3) toc.push({ level, id, html: title });
      continue;
    }

    if ((first === '-' || first === '*') && rule.test(line)) {
      html += '<hr>\n';
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
      html += '<blockquote>\n';
      if (quoted.length) html += `<p>${renderSpan(quoted.join('\n'), href)}</p>\n`;
      html += '</blockquote>\n';
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
      html += ordered && +item[1] !== 1 ? `<ol start="${+item[1]}">\n` : `<${tag}>\n`;
      while (item) {
        let text = trim(item[ordered + 1]);
        while (index < lines.length && continuation.test(lines[index])) text += '\n' + trim(lines[index++]);
        html += `<li>${renderSpan(text, href)}</li>\n`;
        item = index < lines.length ? items[ordered].exec(lines[index]) : null;
        if (item) index++;
      }
      html += `</${tag}>\n`;
      continue;
    }

    let paragraph = trim(line);
    while (index < lines.length && !stopsParagraph(lines[index])) paragraph += '\n' + trim(lines[index++]);
    const rendered = renderSpan(paragraph, href);
    excerpt ??= rendered;
    html += `<p>${rendered}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}
