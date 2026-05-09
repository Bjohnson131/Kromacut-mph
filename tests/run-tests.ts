import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsRoot = fileURLToPath(new URL('.', import.meta.url));

function findTestFiles(directory: string): string[] {
    const files: string[] = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...findTestFiles(path));
        } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            files.push(path);
        }
    }

    return files;
}

const testFiles = findTestFiles(testsRoot).sort((a, b) =>
    relative(testsRoot, a).localeCompare(relative(testsRoot, b))
);

for (const file of testFiles) {
    await import(pathToFileURL(file).href);
}
