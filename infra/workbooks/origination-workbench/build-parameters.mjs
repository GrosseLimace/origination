// Builds azuredeploy.parameters.generated.json from origination-workbench.workbook.json.
//
// ARM needs the workbook body as a single string parameter (serializedData). Rather than hand-escape
// 35 KB of JSON into the template, the deploy workflow (and anyone running what-if locally) runs this
// first. It parses the workbook so a malformed file fails here, not inside Azure.
//
//     node infra/workbooks/origination-workbench/build-parameters.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workbookPath = join(here, 'origination-workbench.workbook.json');
const outputPath = join(here, 'azuredeploy.parameters.generated.json');

const body = readFileSync(workbookPath, 'utf8');
const parsed = JSON.parse(body);
if (parsed.version !== 'Notebook/1.0' || !Array.isArray(parsed.items)) {
  throw new Error(`${workbookPath} is not a Notebook/1.0 workbook document`);
}

const parameters = {
  $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
  contentVersion: '1.0.0.0',
  parameters: { serializedData: { value: body } },
};

writeFileSync(outputPath, JSON.stringify(parameters, null, 2) + '\n');
console.log(`wrote ${outputPath} (${parsed.items.length} workbook items embedded)`);
