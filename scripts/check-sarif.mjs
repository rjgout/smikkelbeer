import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(process.argv[2] || 'sarif-results');
const files = readdirSync(directory).filter((name) => name.endsWith('.sarif'));
if (!files.length) throw new Error('No SARIF files; refusing to pass an unexecuted security scan');
let count = 0;
for (const name of files) {
  const document = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
  for (const run of document.runs || []) {
    const rules = new Map((run.tool?.driver?.rules || []).map((rule) => [rule.id, rule]));
    for (const result of run.results || []) {
      const rule = rules.get(result.ruleId) || {};
      const score = Number(rule.properties?.['security-severity'] || 0);
      const security = (rule.properties?.tags || []).includes('security');
      if (
        score >= 4 ||
        result.level === 'error' ||
        (security && !score && result.level !== 'note')
      ) {
        count++;
        console.error('Blocking security finding: ' + result.ruleId);
      }
    }
  }
}
if (count) {
  console.error('Security gate failed: ' + count + ' blocking findings');
  process.exitCode = 1;
} else
  console.log(
    'Security gate passed: no moderate/high/critical CodeQL findings in ' +
      files.length +
      ' SARIF file(s).',
  );
