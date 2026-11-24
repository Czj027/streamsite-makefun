const allowed = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);
const monthDays = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function readText(raw) {
  if (raw[0] === '[') return { problem: 'a bare string opens on [' };
  if (raw[0] !== '"') return { value: raw };
  if (raw.length === 1 || raw.at(-1) !== '"') return { problem: 'a quoted string is not closed' };
  const inner = raw.slice(1, -1);
  let value = '';
  let kept = 0;
  const marks = /["\\]/g;
  for (let match; (match = marks.exec(inner)) !== null;) {
    if (match[0] === '"') return { problem: 'a quoted string holds a stray quote' };
    const next = inner[marks.lastIndex++];
    if (next !== '"' && next !== '\\') return { problem: 'a quoted string holds an escape other than \\" or \\\\' };
    value += inner.slice(kept, match.index) + next;
    kept = marks.lastIndex;
  }
  return { value: value + inner.slice(kept) };
}

function readField(name, raw) {
  switch (name) {
    case 'title':
    case 'summary':
      return readText(raw);
    case 'date': {
      const year = +raw.slice(0, 4);
      const month = +raw.slice(5, 7);
      const day = +raw.slice(8);
      const last = monthDays[month] + Number(month === 2 && year % 4 === 0);
      if (/^\d{4}-\d\d-\d\d$/.test(raw) && year >= 1970 && year <= 2099 && day >= 1 && day <= last) return { value: raw };
      return { problem: 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw.at(-1) !== ']') return { problem: 'not a list [a, b]' };
      const trimmed = raw.slice(1, -1).trim();
      if (!trimmed) return { value: [] };
      const names = trimmed.split(',').map(item => item.trim());
      if (names.some(item => !item || /["[\]]/.test(item))) return { problem: 'an empty tag, or one holding " [ or ]' };
      return { value: names };
    }
    case 'draft':
      if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
      return { problem: 'true or false' };
    case 'layout':
      return /^[a-z0-9-]+$/.test(raw) ? { value: raw } : { problem: 'not a template name' };
    case 'slug':
      return raw.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) ? { value: raw } : { problem: 'not a slug' };
  }
}

export function readSource(content) {
  const source = content.includes('\r') ? content.replace(/\r\n?/g, '\n') : content;
  if (source !== '---' && !source.startsWith('---\n')) return 'no front matter';

  let end = source.indexOf('\n---', 3);
  while (end !== -1 && end + 4 < source.length && source[end + 4] !== '\n') end = source.indexOf('\n---', end + 1);
  if (end < 0) return 'the front matter is not closed';

  const data = {};
  const fields = source.slice(4, end).split('\n');
  for (let index = 0; index < fields.length; index++) {
    const line = fields[index];
    if (line[0] === '#' || /^[ \t]*$/.test(line)) continue;
    const field = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!field) return `line ${index + 2} is not "key: value"`;
    const [, name, value = ''] = field;
    if (!allowed.has(name)) return `unknown key "${name}"`;
    if (Object.hasOwn(data, name)) return `key "${name}" is given twice`;
    const raw = value.replace(/[ \t]+$/, '');
    if (!raw) return `key "${name}" has no value`;
    const parsed = readField(name, raw);
    if (parsed.problem) return `key "${name}": ${parsed.problem}`;
    data[name] = parsed.value;
  }
  return Object.hasOwn(data, 'title') ? { data, body: source.slice(end + 5) } : 'no title';
}
