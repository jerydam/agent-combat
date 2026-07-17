const solc = require("solc");
const fs = require("fs");
const path = require("path");
const sources = {};
for (const f of fs.readdirSync("contracts").filter((x) => x.endsWith(".sol")))
  sources[`contracts/${f}`] = { content: fs.readFileSync(path.join("contracts", f), "utf8") };
const findImports = (p) => {
  const full = path.join("node_modules", p);
  return fs.existsSync(full) ? { contents: fs.readFileSync(full, "utf8") } : { error: "not found: " + p };
};
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity", sources,
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
}), { import: findImports }));
let failed = false;
for (const e of out.errors || []) { if (e.severity === "error") failed = true; console.log(`[${e.severity}] ${e.formattedMessage}`); }
if (!failed)
  for (const file of Object.keys(out.contracts))
    if (file.startsWith("contracts/"))
      for (const name of Object.keys(out.contracts[file])) {
        const size = out.contracts[file][name].evm.bytecode.object.length / 2;
        if (size > 100) console.log(`OK  ${name}  (${size} bytes)`);
      }
process.exit(failed ? 1 : 0);
