import { readSource } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { compileTemplate } from './template.js';
import { makeRenderer } from './compiled-template.js';
import { Slugs, formatDate, order, toSlug } from './text.js';

const reserved = ['posts', 'tags', 'page'];
const directory = path => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

function relative(dir, path) {
  const parts = dir ? dir.split('/') : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.length) parts.pop();
    else return null;
  }
  return parts.join('/');
}

function resolveLink(target, page, sources, staticURLs, broken) {
  if (target[0] === '/' || target[0] === '#' || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return target;
  const hash = target.indexOf('#');
  const path = relative(page.sourceDir, hash < 0 ? target : target.slice(0, hash));
  const url = sources.get(path)?.url ?? staticURLs.get(path);
  if (url !== undefined) return hash < 0 ? url : url + target.slice(hash);
  broken.add(`broken-link ${page.source} -> ${target}`);
  return target;
}

function buildTags(posts, pages, base, slugOf) {
  const groups = new Map();
  function tagList(page) {
    const seen = new Set();
    const labels = [];
    for (const name of page.data.tags ?? []) {
      const slug = slugOf(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const found = groups.get(slug);
      if (found) {
        if (page.isPost) found.posts.push(page);
        labels.push(found.label);
      } else if (page.isPost) {
        const label = { name, slug, url: `${base}/tags/${slug}/` };
        groups.set(slug, { label, posts: [page] });
        labels.push(label);
      } else labels.push({ name, slug, url: '' });
    }
    return labels;
  }

  for (const page of posts) page.tags = tagList(page);
  for (const page of pages) if (!page.isPost) page.tags = tagList(page);
  return [...groups.values()].sort((a, b) => b.posts.length - a.posts.length || order(a.label.slug, b.label.slug));
}

function refusal(path, isPost, data, layout, templates) {
  if (path.startsWith('tags/')) return "tags/ is the generator's own";
  if (path.startsWith('page/')) return "page/ is the generator's own";
  if (isPost && data.date === undefined) return 'a post needs a date';
  if (!templates.has(layout)) return `layout "${layout}" is no template that parses`;
  return '';
}

function readCard(page, content) {
  const { title, date = '', summary = '' } = page.data;
  // Count groups of up to 200 words without allocating one match per word.
  const minutes = page.body.length <= 399 ? 1 : page.body.match(/\S+(?:\s+\S+){0,199}/g)?.length ?? 1;
  return {
    title,
    url: page.url,
    date,
    date_long: formatDate(date),
    summary,
    excerpt: content.excerpt,
    reading_minutes: minutes,
    tags: page.tags,
  };
}

/** Render a complete site. All counts, caches, and scope live within this build. */
export function run(input) {
  const { site } = input;
  const base = site.base_url.replace(/\/+$/, '');
  const messages = [];
  const broken = new Set();
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort()) {
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      messages.push(error.message);
    }
  }

  const slugCache = new Map();
  function slugOf(value) {
    let slug = slugCache.get(value);
    if (slug === undefined) {
      slug = toSlug(value);
      slugCache.set(value, slug);
    }
    return slug;
  }

  const pages = [];
  const posts = [];
  const statics = [];
  const sources = new Map();
  const staticURLs = new Map();
  const directories = new Map([['', new Slugs(reserved)]]);
  for (const file of input.files.slice().sort((a, b) => order(a.path, b.path))) {
    const { path, content } = file;
    if (!path.endsWith('.md')) {
      statics.push(file);
      staticURLs.set(path, `${base}/${path}`);
      continue;
    }
    const parsed = readSource(content);
    if (typeof parsed === 'string') {
      messages.push(`refused ${path}: ${parsed}`);
      continue;
    }
    const { data, body } = parsed;
    const isPost = path.startsWith('posts/');
    const layout = data.layout ?? (isPost ? 'post' : 'page');
    const problem = refusal(path, isPost, data, layout, templates);
    if (problem) {
      messages.push(`refused ${path}: ${problem}`);
      continue;
    }
    if (data.draft) {
      messages.push(`draft ${path}`);
      continue;
    }

    const sourceDir = directory(path);
    const outDir = isPost ? 'posts' : sourceDir;
    let available = directories.get(outDir);
    if (!available) directories.set(outDir, available = new Slugs());
    const slug = available.take(data.slug ?? slugOf(data.title));
    const permalink = outDir ? `${outDir}/${slug}` : slug;
    const page = { source: path, sourceDir, isPost, layout, data, body, slug, permalink, url: `${base}/${permalink}/` };
    pages.push(page);
    if (isPost) posts.push(page);
    sources.set(path, page);
  }

  posts.sort((a, b) => order(b.data.date, a.data.date) || order(a.slug, b.slug));
  const groups = buildTags(posts, pages, base, slugOf);

  for (const page of pages) {
    const content = renderMarkdown(page.body, target => resolveLink(target, page, sources, staticURLs, broken), slugOf);
    const card = readCard(page, content);
    page.content = content;
    page.card = card;
    page.navigation = { title: card.title, url: card.url, date: card.date, date_long: card.date_long };
  }
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = posts[i - 1]?.navigation ?? null;
    posts[i].older = posts[i + 1]?.navigation ?? null;
  }

  const cards = posts.map(page => page.card);
  const roots = {
    site: { title: site.title, base_url: base },
    tags: groups.map(({ label, posts }) => ({ ...label, count: posts.length })),
    recent: cards.slice(0, site.recent),
  };
  const output = {};
  const draw = makeRenderer(templates, roots);
  const pageRoots = { ...roots, page: null };
  for (const item of pages) {
    pageRoots.page = {
      ...item.card,
      slug: item.slug,
      content: item.content.html,
      toc: item.content.toc,
      newer: item.newer ?? null,
      older: item.older ?? null,
      is_post: item.isPost,
    };
    output[`${item.permalink}/index.html`] = draw(item.layout, pageRoots);
  }

  if (templates.has('index')) {
    const pageSize = site.per_page;
    const total = Math.max(1, Math.ceil(cards.length / pageSize));
    const url = number => number === 1 ? `${base}/` : `${base}/page/${number}/`;
    for (let number = 1; number <= total; number++) {
      const pager = { number, total, url: url(number), newer_url: number === 1 ? '' : url(number - 1), older_url: number === total ? '' : url(number + 1) };
      const path = number === 1 ? 'index.html' : `page/${number}/index.html`;
      output[path] = draw('index', { ...roots, pager, posts: cards.slice((number - 1) * pageSize, number * pageSize) });
    }
  }

  if (templates.has('tag')) {
    for (const group of groups) {
      const tag = { ...group.label, count: group.posts.length, posts: group.posts.map(page => page.card) };
      output[`tags/${tag.slug}/index.html`] = draw('tag', { ...roots, tag });
    }
  }
  if (templates.has('tags')) output['tags/index.html'] = draw('tags', roots);

  for (const { path, content } of statics) {
    if (Object.hasOwn(output, path)) messages.push(`shadowed ${path}: a built page has its path`);
    else output[path] = content;
  }
  for (const message of broken) messages.push(message);
  messages.sort();
  messages.push(`built ${pages.length - posts.length} pages, ${posts.length} posts, ${groups.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = messages.join('\n') + '\n';
  return output;
}
