#!/usr/bin/env node
// Local file export only. Never starts a process on the NAS or either VPS.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output-dir' || !args[1]) {
    throw new Error('用法：pnpm export:home-network --output-dir /absolute/private/new-directory');
  }
  const { readHomeDraft, generateHomeNetwork } = require('../lib/home-network.ts');
  const { readConnections } = require('../lib/connections.ts');
  const { readPolicyStore } = require('../lib/policies.ts');
  const draft = await readHomeDraft();
  const connections = await readConnections();
  const bundle = generateHomeNetwork(draft, connections?.vpsNodes || [], await readPolicyStore());
  const output = path.resolve(args[1]);
  fs.mkdirSync(output, { mode: 0o700 }); // Existing directories are intentionally refused.
  for (const [filename, content] of Object.entries(bundle.files)) {
    fs.writeFileSync(path.join(output, filename), content, { mode: 0o600, flag: 'wx' });
  }
  console.log(`已导出 ${Object.keys(bundle.files).length} 个草稿文件：${output}\n未安装或运行任何网络配置。`);
}
main().catch(error => {
  if (error.code === 'EEXIST') console.error('输出目录已存在，请指定一个新的私有目录；不会覆盖原文件。');
  else if (error instanceof SyntaxError) console.error('本地配置 JSON 损坏，请检查 DATA_DIR；为保护秘密不显示原始内容。');
  else console.error(error.message || '导出失败');
  process.exitCode = 1;
});
