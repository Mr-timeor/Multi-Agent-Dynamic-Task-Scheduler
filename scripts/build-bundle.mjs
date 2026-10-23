import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapterSource } from "./adapter-source.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "harness", "bundle", "dist");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(root, "dist"), target, { recursive: true });
await cp(join(root, "harness/index.mjs"), join(root, "harness/bundle/index.mjs"));
await writeFile(join(root, "harness/bundle/adapter.mjs"), await adapterSource(root));
console.log(`bundle dist: ${target}`);
