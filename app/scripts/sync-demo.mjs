import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const built = path.join(appDir, 'dist', 'index.html');
const demo = path.join(appDir, '..', 'index.html');

if (!fs.existsSync(built)) {
  console.error('Missing app/dist/index.html. Run "npm run build" first.');
  process.exit(1);
}

fs.copyFileSync(built, demo);
console.log(`synced ${path.relative(appDir, built)} -> ${path.relative(appDir, demo)}`);
