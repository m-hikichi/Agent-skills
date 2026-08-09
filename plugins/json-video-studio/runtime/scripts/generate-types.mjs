import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileFromFile} from 'json-schema-to-typescript';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(scriptDirectory, '..', '..', 'schemas', 'video-project.schema.json');
const outputDirectory = path.resolve(scriptDirectory, '..', 'src', 'generated');
const outputPath = path.join(outputDirectory, 'video-project.ts');

const source = await compileFromFile(schemaPath, {
  bannerComment: [
    '/* eslint-disable */',
    '/**',
    ' * Generated from schemas/video-project.schema.json.',
    ' * Do not edit by hand; run `npm run generate:types`.',
    ' */',
  ].join('\n'),
  style: {
    bracketSpacing: false,
    singleQuote: true,
  },
  unknownAny: false,
  // Runtime cardinality limits stay in JSON Schema/Ajv. Authoring code needs
  // mutable arrays, not generated tuple unions.
  ignoreMinAndMaxItems: true,
});

await mkdir(outputDirectory, {recursive: true});
await writeFile(outputPath, source, 'utf8');
