import { register } from '../../../extensions/moe-principal-assistant/index.mjs';
const tools = [];
const api = {
  pluginConfig: { principalName: 'Probe Principal', schoolName: 'Probe Primary', educationDistrict: 'Port of Spain and Environs', schoolType: 'Government Primary' },
  registerTool: (t) => { tools.push({ type: 'function', function: { name: t.name, description: String(t.description || '').slice(0, 1024), parameters: t.parameters ?? t.inputSchema ?? { type: 'object', properties: {} } } }); },
  log: { info(){}, warn(){}, error(){}, debug(){} },
  host: {},
};
try { await register(api); } catch (e) { console.error('register threw:', e?.message); }
const strip = (node) => {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'additionalProperties' || k === 'default' || k === 'format' || k === 'minimum' || k === 'maximum' || k === 'minLength' || k === 'maxLength' || k === 'minItems' || k === 'maxItems') continue;
      if (k === 'anyOf' || k === 'oneOf') { const first = strip(v[0]); Object.assign(out, first); continue; }
      out[k] = strip(v);
    }
    return out;
  }
  return node;
};
const kw = {};
JSON.stringify(tools, (k, v) => { if (['additionalProperties','anyOf','oneOf','allOf','$ref','format','default','const','minimum','maximum','minLength','maxLength','minItems','maxItems','enum','pattern'].includes(k)) kw[k]=(kw[k]||0)+1; return v; });
console.log(JSON.stringify({ toolCount: tools.length, names: tools.map(t=>t.function.name), keywordCounts: kw, bytes: JSON.stringify(tools).length }, null, 1));
import { writeFileSync } from 'node:fs';
writeFileSync('./tools-original.json', JSON.stringify(tools));
writeFileSync('./tools-stripped.json', JSON.stringify(strip(tools)));
