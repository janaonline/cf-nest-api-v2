// PostToolUse hook: run Prettier on any file Claude just edited/wrote.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXT = new Set(['.ts', '.js', '.json', '.html', '.scss', '.css', '.md']);
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const file = JSON.parse(raw)?.tool_input?.file_path;
    if (!file || !EXT.has(path.extname(file)) || !fs.existsSync(file)) return;
    if (file.includes(`${path.sep}node_modules${path.sep}`)) return;
    const root = path.resolve(__dirname, '..', '..');
    const bin = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
    if (!fs.existsSync(bin)) return;
    spawnSync(process.execPath, [bin, '--write', file], { cwd: root, timeout: 30000 });
  } catch (e) {
    console.error(`format hook skipped: ${e.message}`);
  }
});
