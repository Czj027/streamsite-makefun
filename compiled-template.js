import { render } from './template.js';
import { escape } from './text.js';
import { templateFragments } from './template-fragments.js';

const text = 'text';
const scalar = 'scalar';
const unknown = 'unknown';
const label = { name: text, slug: text, url: text };
const tagSummary = { ...label, count: scalar };
const navigation = { title: text, url: text, date: text, date_long: text };
const card = { ...navigation, summary: text, excerpt: text, reading_minutes: scalar, tags: [label] };
const rootShape = {
  site: { title: unknown, base_url: text },
  page: { ...card, slug: text, content: text, toc: [{ level: scalar, id: text, html: text }], newer: navigation, older: navigation, is_post: scalar },
  tag: { ...tagSummary, posts: [card] },
  tags: [tagSummary],
  recent: [card],
  posts: [card],
  pager: { number: scalar, total: scalar, url: text, newer_url: text, older_url: text },
};

const absent = { source: 'undefined', shape: scalar };
const overBudget = Symbol('template expansion budget');

function member(value, key) {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
}

function asText(value) {
  switch (typeof value) {
    case 'string': return value;
    case 'boolean':
    case 'number': return String(value);
    default: return Array.isArray(value) ? value.map(asText).join(', ') : '';
  }
}

function isTrue(value) {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== false && value !== '' && value !== 0;
}

function descendant(parent, key) {
  const shape = parent.shape;
  if (shape === unknown) return { source: `read(${parent.source},${JSON.stringify(key)})`, shape: unknown };
  if (Array.isArray(shape)) return key === 'length' ? { source: `${parent.source}?.length`, shape: scalar } : absent;
  if (typeof shape !== 'object' || !Object.hasOwn(shape, key)) return absent;
  return { source: `${parent.source}?.${key}`, shape: shape[key] };
}

function lookup(path, locals, loop) {
  const first = path[0];
  let value;
  let next = 1;
  if (first === 'loop' && loop) {
    if (path.length === 1) {
      value = { source: `({index:${loop.index}+1,first:${loop.index}===0,last:${loop.index}+1===${loop.length},length:${loop.length}})`, shape: unknown };
    } else {
      const access = path[1];
      if (access === 'index') value = { source: `(${loop.index}+1)`, shape: scalar };
      else if (access === 'length') value = { source: loop.length, shape: scalar };
      else if (access === 'first') value = { source: `(${loop.index}===0)`, shape: scalar };
      else if (access === 'last') value = { source: `(${loop.index}+1===${loop.length})`, shape: scalar };
      else value = absent;
      next = 2;
    }
  } else {
    value = locals.get(first);
    if (value === undefined) value = descendant({ source: 'roots', shape: rootShape }, first);
  }
  for (; next < path.length; next++) value = descendant(value, path[next]);
  return value;
}

function compile(nodes, templates, fragments) {
  let nextVariable = 0;
  let remaining = 2400;
  const code = ['return (roots) => {let out = "";'];

  function emit(program, locals, loop, depth) {
    const pieces = [];
    function flush() {
      if (pieces.length) {
        code.push(`out += ${pieces.join('+')};`);
        pieces.length = 0;
      }
    }
    for (const operation of program) {
      if (--remaining < 0) throw overBudget;
      if (typeof operation === 'string') {
        if (operation) pieces.push(JSON.stringify(operation));
        continue;
      }
      if (operation.kind === 'include') {
        if (depth < 8 && templates.has(operation.name)) {
          const reusable = fragments.expression(operation.name, depth + 1, locals, loop);
          if (reusable === null) {
            flush();
            emit(templates.get(operation.name), locals, loop, depth + 1);
          } else pieces.push(reusable);
        }
        continue;
      }

      const { source, shape } = lookup(operation.path, locals, loop);
      if (operation.kind === 'raw' || operation.kind === 'value') {
        if (source === 'undefined') continue;
        const output = shape === text ? `(${source}??"")` : `write(${source})`;
        pieces.push(operation.kind === 'raw' ? output : `escape(${output})`);
      } else if (operation.kind === 'if') {
        flush();
        code.push(`if (${operation.negate ? '!' : ''}truth(${source})) {`);
        emit(operation.body, locals, loop, depth);
        if (operation.otherwise) {
          code.push('} else {');
          emit(operation.otherwise, locals, loop, depth);
        }
        code.push('}');
      } else if (operation.kind === 'for') {
        if (shape !== unknown && !Array.isArray(shape)) continue;
        flush();
        const variable = nextVariable++;
        const array = `array${variable}`;
        const index = `index${variable}`;
        const length = `length${variable}`;
        const item = `item${variable}`;
        code.push(`const ${array} = ${source};`);
        code.push(`if (${Array.isArray(shape) ? array : `Array.isArray(${array})`}) {`);
        code.push(`const ${length}=${array}.length;`);
        code.push(`for (let ${index}=0;${index}<${length};${index}++){const ${item}=${array}[${index}];`);
        const child = new Map(locals);
        child.set(operation.name, { source: item, shape: Array.isArray(shape) ? shape[0] : unknown });
        emit(operation.body, child, { index, length }, depth);
        code.push('}}');
      }
    }
    flush();
  }

  emit(nodes, new Map(), null, 0);
  code.push('return out;}');
  // Parsed operators select the generated instructions. Text is quoted as a JSON string.
  return new Function('read', 'write', 'escape', 'truth', 'fragments', code.join('\n'))(member, asText, escape, isTrue, fragments.table);
}

export function makeRenderer(templates, roots) {
  const compiled = new Map();
  const fragments = templateFragments(templates, roots);
  return (name, values) => {
    let draw = compiled.get(name);
    if (draw === undefined) {
      const nodes = templates.get(name);
      try {
        draw = compile(nodes, templates, fragments);
      } catch (error) {
        if (error !== overBudget) throw error;
        draw = values => render(nodes, values, templates);
      }
      compiled.set(name, draw);
    }
    return draw(values);
  };
}
