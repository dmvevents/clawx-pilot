// CLWX-136: Gateway Node-mode entry shim.
//
// The Gateway runs as an Electron utilityProcess, where process.execPath is
// the Electron GUI binary (e.g. "Ministry of Education.exe"). OpenClaw spawns
// helper children — dist/infra/sqlite-readonly-location.worker.js,
// dist/infra/sqlite-integrity.worker.js, package lifecycle scripts — via
// process.execPath with the inherited environment. Without
// ELECTRON_RUN_AS_NODE those children boot the full GUI app, print
// non-protocol text on stdout and break the worker JSON contract
// ("SQLite read-only worker returned invalid JSON", Gateway exit 1).
//
// Setting the flag HERE — inside the utility process, before OpenClaw loads —
// guarantees every future execPath child runs as Node regardless of how
// utilityProcess.fork treats its env option. The flag must NOT be placed in
// the fork env itself: if Electron passed it through unfiltered, the freshly
// exec'ed utility process would itself boot as plain Node with Chromium argv
// and never become a utility process.
import { pathToFileURL } from 'node:url';

const realEntry = process.env.CLAWX_GATEWAY_REAL_ENTRY;
if (!realEntry) {
  process.stderr.write(
    '[clawx-gateway-entry] CLAWX_GATEWAY_REAL_ENTRY is not set; refusing to guess the Gateway entry script.\n',
  );
  process.exit(1);
}

process.env.ELECTRON_RUN_AS_NODE = '1';
// Restore the argv contract the real entry would see if forked directly.
process.argv[1] = realEntry;
await import(pathToFileURL(realEntry).href);
