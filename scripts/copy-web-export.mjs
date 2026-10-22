import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportDirectory = resolve(root, "frontend", "out");
const webDirectory = resolve(root, "www");
const markerPath = resolve(webDirectory, ".xocrisk-static-export");

await readFile(resolve(exportDirectory, "index.html"));

let outputExists = true;
try {
  await stat(webDirectory);
} catch (error) {
  if (error.code === "ENOENT") outputExists = false;
  else throw error;
}

if (outputExists) {
  try {
    await readFile(resolve(webDirectory, ".xocrisk-static-export"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${webDirectory} exists without an XOCRISK export marker; refusing to overwrite it.`);
    }
    throw error;
  }
  await rm(webDirectory, { recursive: true, force: true });
}

await mkdir(webDirectory, { recursive: true });
await cp(exportDirectory, webDirectory, { recursive: true });
await writeFile(markerPath, "Generated from frontend/out. Do not edit manually.\n", "utf8");
console.log(`Copied the static Next.js export to ${webDirectory}`);
