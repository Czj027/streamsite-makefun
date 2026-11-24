import { escape } from './text.js';

const pathPattern = /^[a-zA-Z_][a-zA-Z_0-9]*(?:\.[a-zA-Z_][a-zA-Z_0-9]*)*$/;
const indentation = /^[ \t]*$/;
const forTag = /^for ([a-zA-Z_][a-zA-Z_0-9]*) in (\S+)$/;
const ifTag = /^if (not )?(\S+)$/;
const includeTag = /^include "([a-z0-9-]+)"$/;

function tokenize(source, path, fail) {
  const tokens = [];
  const openers = /\{[{%]/g;
  let cursor = 0;
  for (let opener; (opener = openers.exec(source)) !== null;) {
    const start = opener.index;
    const control = opener[0] === '{%';
    const raw = !control && source[start + 2] === '{';
    const close = control ? '%}' : raw ? '}}}' : '}}';
    const valueStart = start + close.length;
    const valueEnd = source.indexOf(close, valueStart);
    if (valueEnd === -1) fail(`a ${source.slice(start, valueStart)} is not closed`);
    const value = source.slice(valueStart, valueEnd).trim();
    let chunkEnd = start;
    let next = valueEnd + close.length;

    if (control) {
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      const newline = source.indexOf('\n', next);
      if (indentation.test(source.slice(lineStart, start)) && indentation.test(source.slice(next, newline < 0 ? source.length : newline))) {
        chunkEnd = lineStart;
        next = newline < 0 ? source.length : newline + 1;
      }
    }
    if (chunkEnd > cursor) tokens.push(source.slice(cursor, chunkEnd));
    tokens.push(control ? { control: value } : { kind: raw ? 'raw' : 'value', path: path(value) });
    cursor = next;
    openers.lastIndex = next;
  }
  if (cursor < source.length) tokens.push(source.slice(cursor));
  return tokens;
}

export function compileTemplate(name, source) {
  const fail = issue => { throw new SyntaxError(`template "${name}": ${issue}`); };
  const path = value => {
    if (!pathPattern.test(value)) fail(`${JSON.stringify(value)} is not a path`);
    return value.split('.');
  };

  const program = [];
  const stack = [];
  let body = program;
  for (const token of tokenize(source, path, fail)) {
    if (typeof token === 'string' || token.control === undefined) {
      body.push(token);
      continue;
    }
    const label = token.control;
    const open = stack.at(-1);
    const loop = forTag.exec(label);
    const condition = loop ? null : ifTag.exec(label);
    if (loop || condition) {
      const contents = [];
      const operation = loop
        ? { kind: 'for', name: loop[1], path: path(loop[2]), body: contents }
        : { kind: 'if', negate: !!condition[1], path: path(condition[2]), body: contents, otherwise: null };
      body.push(operation);
      stack.push({ operation, parent: body });
      body = contents;
    } else if (label === 'else') {
      if (open?.operation.kind !== 'if' || open.operation.otherwise !== null) fail('an else outside an if');
      body = open.operation.otherwise = [];
    } else if (label === 'endif' || label === 'endfor') {
      const kind = label.slice(3);
      if (open?.operation.kind !== kind) fail(`an ${label} with no open ${kind}`);
      body = stack.pop().parent;
    } else {
      const include = includeTag.exec(label);
      if (!include) fail(`{% ${label} %} is not a tag`);
      body.push({ kind: 'include', name: include[1] });
    }
  }
  if (stack.length) fail(`a ${stack.at(-1).operation.kind} is not closed`);
  return program;
}

function getValue(roots, frame, path) {
  const first = path[0];
  let item;
  if (frame !== null && first === 'loop') item = frame.position;
  else {
    while (frame !== null && frame.name !== first) frame = frame.parent;
    item = frame === null ? (Object.hasOwn(roots, first) ? roots[first] : undefined) : frame.value;
  }
  for (let i = 1; i < path.length; i++) {
    if (item === null || typeof item !== 'object' || !Object.hasOwn(item, path[i])) return undefined;
    item = item[path[i]];
  }
  return item;
}

function writeValue(value) {
  switch (typeof value) {
    case 'string': return value;
    case 'number':
    case 'boolean': return String(value);
    default: return Array.isArray(value) ? value.map(writeValue).join(', ') : '';
  }
}

export function render(program, roots, templates, frame = null, inclusions = 0) {
  let html = '';
  for (const op of program) {
    if (typeof op === 'string') {
      html += op;
      continue;
    }
    if (op.kind === 'include') {
      const included = templates.get(op.name);
      if (included && inclusions < 8) html += render(included, roots, templates, frame, inclusions + 1);
      continue;
    }
    const value = getValue(roots, frame, op.path);
    switch (op.kind) {
      case 'raw':
        html += writeValue(value);
        break;
      case 'value':
        html += escape(writeValue(value));
        break;
      case 'if': {
        const truth = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== false && value !== '' && value !== 0;
        const branch = truth !== op.negate ? op.body : op.otherwise;
        if (branch) html += render(branch, roots, templates, frame, inclusions);
        break;
      }
      case 'for': {
        if (!Array.isArray(value) || value.length === 0) break;
        const length = value.length;
        const position = { index: 0, length, first: false, last: false };
        const local = { name: op.name, value: undefined, position, parent: frame };
        for (let i = 0; i < length; i++) {
          local.value = value[i];
          position.index = i + 1;
          position.first = i === 0;
          position.last = i + 1 === length;
          html += render(op.body, roots, templates, local, inclusions);
        }
        break;
      }
    }
  }
  return html;
}
