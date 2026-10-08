const sha = process.argv[2];
const j: any = await (await fetch(`http://localhost:4477/api/diff?commit=${sha}`)).json();
if (j.error) { console.log(j.error); process.exit(); }
const strip = (h: string) => (h ?? "").replace(/<mark class="chg">/g, "⟦").replace(/<\/mark>/g, "⟧").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
console.log(j.short, j.subject);
for (const f of j.files) {
	console.log(`\n=== ${f.oldPath && f.oldPath !== f.path ? f.oldPath + " -> " : ""}${f.path} ${f.status} +${f.adds} -${f.dels}`);
	for (const u of f.units) {
		console.log(`  ## ${u.title} [${u.status}${u.other ? ` ${u.other.path.split("/").pop()}:${u.other.title}` : ""}]`);
		for (const r of u.rows) {
			if (r.kind === "fold") { console.log(`     … ${r.count} unchanged`); continue; }
			const L = r.left ? "  ".repeat(r.left.d) + strip(r.left.html) : "";
			const R = r.right ? "  ".repeat(r.right.d) + strip(r.right.html) : "";
			const m = { same: " ", del: "-", add: "+", mod: "~" }[r.kind as string];
			if (r.kind === "add") console.log(`   + ${R.slice(0, 150)}`);
			else if (r.kind === "mod") console.log(`   ~ ${L.slice(0, 150)}\n   → ${R.slice(0, 150)}`);
			else console.log(`   ${m} ${L.slice(0, 150)}`);
		}
	}
}
