import { render } from './template.js';

const stableRoots = new Set(['site', 'tags', 'recent']);

function freeVariables(templates) {
  const summaries = new Map();

  function collect(name, depth) {
    const key = `${depth}:${name}`;
    const stored = summaries.get(key);
    if (stored) return stored;
    const dependencies = new Set();
    summaries.set(key, dependencies);
    const program = templates.get(name);
    if (!program) return dependencies;

    function visit(nodes, bound) {
      for (const op of nodes) {
        if (typeof op === 'string') continue;
        if (op.kind === 'include') {
          if (depth < 8) {
            for (const dependency of collect(op.name, depth + 1)) {
              if (!bound.has(dependency)) dependencies.add(dependency);
            }
          }
          continue;
        }
        const first = op.path[0];
        if (!bound.has(first)) dependencies.add(first);
        if (op.kind === 'for') {
          const locals = new Set(bound);
          locals.add(op.name);
          locals.add('loop');
          visit(op.body, locals);
        } else if (op.kind === 'if') {
          visit(op.body, bound);
          if (op.otherwise) visit(op.otherwise, bound);
        }
      }
    }

    visit(program, new Set());
    return dependencies;
  }

  return collect;
}

/** Include results are reusable only within the current site and matching lexical scope. */
export function templateFragments(templates, roots) {
  const dependencies = freeVariables(templates);
  const table = [];
  const slots = new Map();

  function expression(name, depth, locals, loop) {
    let localName;
    for (const first of dependencies(name, depth)) {
      if (first === 'loop' && loop) return null;
      const local = locals.get(first);
      if (local) {
        if (localName !== undefined || typeof local.shape !== 'object') return null;
        localName = first;
      } else if (!stableRoots.has(first)) {
        return null;
      }
    }

    const key = `${depth}:${name}:${localName ?? ''}`;
    let slot = slots.get(key);
    if (slot === undefined) {
      const program = templates.get(name);
      slot = table.length;
      slots.set(key, slot);
      if (localName === undefined) {
        table.push(render(program, roots, templates, null, depth));
      } else {
        const memo = new WeakMap();
        const draw = value => render(program, roots, templates, { name: localName, value, position: null, parent: null }, depth);
        table.push(value => {
          if (!value || typeof value !== 'object') return draw(value);
          let output = memo.get(value);
          if (output === undefined) {
            output = draw(value);
            memo.set(value, output);
          }
          return output;
        });
      }
    }
    return localName === undefined ? `fragments[${slot}]` : `fragments[${slot}](${locals.get(localName).source})`;
  }

  return { table, expression };
}
