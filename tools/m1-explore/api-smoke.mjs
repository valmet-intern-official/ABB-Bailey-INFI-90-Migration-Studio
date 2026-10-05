import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("Guiding Material/Test 1 Data - Graphics");
const fd = new FormData();
for (const f of fs.readdirSync(path.join(dir, "M10")).filter((f) => /\.m1$/i.test(f)))
  fd.append("files", new Blob([fs.readFileSync(path.join(dir, "M10", f))]), f);
if (process.argv[2] !== "--no-ref")
  fd.set("reference", new Blob([fs.readFileSync(path.join(dir, "Expected Output - Graphics.pdf"))]), "Expected Output - Graphics.pdf");

const t = Date.now();
const res = await fetch("http://localhost:3000/api/m1/upload", { method: "POST", body: fd });
const body = await res.json();
console.log(res.status, Date.now() - t, "ms", JSON.stringify(body));
if (!body.id) process.exit(1);
const base = `http://localhost:3000/api/m1/${body.id}`;
const file = encodeURIComponent(body.files[4].name);
for (const u of [base, `${base}/inspect/${file}/overview`, `${base}/inspect/${file}/records?limit=3`, `${base}/inspect/${file}/record?id=2`, `${base}/inspect/${file}/hex?start=0&length=64`, `${base}/inspect/${file}/groups`, `${base}/inspect/${file}/tags`, `${base}/inspect/${file}/scene`, `${base}/asset/${file}/graphics/original.svg`, `${base}/asset/..%2F..%2Fsession.json`, `${base}/download`]) {
  const r = await fetch(u);
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(r.status, buf.length, u.replace(base, ""), buf.subarray(0, 140).toString().replace(/\s+/g, " "));
}
