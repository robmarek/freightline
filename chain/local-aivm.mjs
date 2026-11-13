import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const [operation, checkout, ...extra] = process.argv.slice(2);
if (!['build', 'test'].includes(operation) || !checkout || extra.length) {
  console.error('Usage: node local-aivm.mjs build|test /path/to/synergy-checkouts');
  process.exit(2);
}
const aivm = resolve(checkout, 'synergy-aivm', 'runtime', 'aivm-core');
const compiler = resolve(checkout, 'synq-language', 'compiler');
for (const dependency of [aivm, compiler]) {
  if (!existsSync(join(dependency, 'Cargo.toml'))) {
    throw new Error(`Missing Synergy toolchain checkout at ${dependency}`);
  }
}

const local = join(root, '.local');
const manifest = join(local, 'Cargo.toml');
const lock = join(local, 'Cargo.lock');
mkdirSync(local, { recursive: true });
if (!existsSync(lock) && existsSync(join(aivm, 'Cargo.lock'))) {
  copyFileSync(join(aivm, 'Cargo.lock'), lock);
}
writeFileSync(manifest, `[package]
name = "freightline-aivm"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "freightline-aivm"
path = "../local-aivm.rs"

[dependencies]
aivm-core = { path = ${JSON.stringify(aivm)} }
compiler = { path = ${JSON.stringify(compiler)} }
serde_json = "1"
`);

const toolchain = process.env.FREIGHTLINE_RUST_TOOLCHAIN ?? '1.93.0';
const flags = process.env.FREIGHTLINE_OFFLINE === '1' ? ['--offline'] : [];
const args = operation === 'build' ? ['run', ...flags] : ['test', ...flags];
const result = spawnSync('cargo', [`+${toolchain}`, ...args, '--manifest-path', manifest], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
