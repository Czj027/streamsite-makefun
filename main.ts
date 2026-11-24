import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// These short, fresh-process runs benefit from retaining baseline JIT without tiering up.
setFlagsFromString('--no-incremental-marking --no-turbofan --no-maglev');
const { run } = await import('./solve.js');

const source = resolve(process.env.MAKEFUN_INPUT_DIR ?? '/input', 'cases.json');
const destination = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'answers.json');
const cases = JSON.parse(readFileSync(source, 'utf8'));
const output = openSync(destination, 'w');
try {
  for (let index = 0; index < cases.length; index++) {
    const prefix = index === 0 ? '[' : ',';
    writeFileSync(output, prefix + JSON.stringify(run(cases[index].input)));
  }
  writeFileSync(output, cases.length === 0 ? '[]' : ']');
} finally {
  closeSync(output);
}
