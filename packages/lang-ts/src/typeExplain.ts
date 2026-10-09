import { type Line, mk } from "@usenarrator/core";
import { type Engine, type N, unwrap } from "./engine";

type Comment = { type: string; value: string; start: number; end: number };

const cleanComment = (v: string) =>
	v
		.split("\n")
		.map((l) => l.replace(/^\s*\*+\s?/, "").trim())
		.filter((l) => l && !l.startsWith("@"))
		.join(" ")
		.trim();

/** Explains a named type (interface, type alias, zod schema, enum) as English lines with per-field meaning. */
export class TypeExplainer {
	program: N;
	comments: Comment[];
	lines: Line[] = [];

	constructor(
		public e: Engine,
		public src: string,
		filename: string,
	) {
		const r = e.parse(filename.replace(/\.(m|c)?js$/, ".ts"), src);
		this.program = r.program;
		this.comments = r.comments ?? [];
		e.src = src;
		e.comments = this.comments;
	}

	code = (n: N) => this.src.slice(n.start, n.end);

	emit(d: number, text: string, n: N | null, kind: Line["kind"] = "stmt") {
		this.lines.push({ d, text, start: n?.start ?? -1, end: n?.end ?? -1, kind });
	}

	/** Comments directly above `n` (after `floor`), plus a trailing same-line comment. */
	docFor(n: N, floor: number): string | null {
		const above: string[] = [];
		let cursor = n.start;
		for (let i = this.comments.length - 1; i >= 0; i--) {
			const c = this.comments[i]!;
			if (c.end > cursor || c.start < floor) continue;
			if (floor > 0 && !/\n/.test(this.src.slice(floor, c.start))) break;
			if (!/^\s*$/.test(this.src.slice(c.end, cursor))) break;
			above.unshift(cleanComment(c.value));
			cursor = c.start;
		}
		const trailing = this.comments.find((c) => c.start >= n.end && !/\n/.test(this.src.slice(n.end, c.start)));
		const parts = [...above, trailing ? cleanComment(trailing.value) : ""].filter(Boolean);
		return parts.length ? parts.join(" ") : null;
	}

	findDecl(name: string): { node: N; stmt: N } | null {
		for (const st of this.program.body) {
			const s = (st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration") && st.declaration ? st.declaration : st;
			if (
				(s.type === "TSInterfaceDeclaration" || s.type === "TSTypeAliasDeclaration" || s.type === "TSEnumDeclaration" || s.type === "ClassDeclaration") &&
				s.id?.name === name
			)
				return { node: s, stmt: st };
			if (s.type === "VariableDeclaration") for (const v of s.declarations) if (v.id?.name === name) return { node: v, stmt: st };
		}
		return null;
	}

	explain(name: string): Line[] | null {
		const hit = this.findDecl(name);
		if (!hit) return null;
		const { node, stmt } = hit;
		const doc = this.docFor(stmt, 0);
		const title = mk("t", name, name);
		const x = this.e.say.types.explain;
		if (doc) this.emit(0, this.e.say.statements.comment({ text: doc }), stmt, "note");
		switch (node.type) {
			case "TSInterfaceDeclaration": {
				const ext = (node.extends ?? []).map((x: N) => this.typeLink(x.expression ?? x));
				this.emit(0, `${x.object({ name: title, bases: ext.length ? this.e.g.list(ext) : null })}:`, node, "head");
				this.members(node.body.body, node.body.start, 1);
				break;
			}
			case "TSTypeAliasDeclaration":
				this.alias(name, node.typeAnnotation, node);
				break;
			case "TSEnumDeclaration": {
				const members = node.body?.members ?? node.members ?? [];
				this.emit(0, `${x.oneOf({ name: title })}:`, node, "head");
				for (const m of members) {
					const doc = this.docFor(m, node.start);
					const value = m.initializer ? this.code(m.initializer) : null;
					this.emit(1, `• ${x.enumMember({ name: mk("l", m.id.name ?? `"${m.id.value}"`), value, doc })}`, m, "bullet");
				}
				break;
			}
			case "VariableDeclarator":
				this.schema(title, node.init, node, 0);
				break;
			case "ClassDeclaration": {
				this.emit(0, `${x.class({ name: title })}:`, node, "head");
				for (const m of node.body.body) {
					if (!m.key?.name || m.kind === "constructor") continue;
					const doc = this.docFor(m, node.body.start);
					const type = m.typeAnnotation ? this.e.typeText(m.typeAnnotation.typeAnnotation) : m.type === "MethodDefinition" ? x.method : x.field;
					this.emit(1, `• ${x.member({ name: mk("v", this.e.lex.humanize(m.key.name), m.key.name), type, optional: false, doc })}`, m, "bullet");
				}
				break;
			}
		}
		return this.lines;
	}

	typeLink(n: N): string {
		const name = this.code(n);
		return mk("t", name, name);
	}

	members(members: N[], floor: number, d: number) {
		let prevEnd = floor;
		for (const m of members) {
			const doc = this.docFor(m, prevEnd);
			prevEnd = m.end;
			const key = m.key?.name ?? (m.key?.value !== undefined ? String(m.key.value) : null);
			if (!key) continue;
			const type = m.type === "TSMethodSignature" ? this.e.say.types.function : this.e.typeText(m.typeAnnotation?.typeAnnotation, false);
			const line = this.e.say.types.explain.member({ name: mk("v", this.e.lex.humanize(key), key), type, optional: !!m.optional, doc });
			this.emit(d, `• ${line}`, m, "bullet");
		}
	}

	alias(name: string, t: N, node: N) {
		const x = this.e.say.types.explain;
		const title = mk("t", name, name);
		const u = t.type === "TSParenthesizedType" ? t.typeAnnotation : t;
		if (u.type === "TSTypeLiteral") {
			this.emit(0, `${x.object({ name: title, bases: null })}:`, node, "head");
			return this.members(u.members, u.start, 1);
		}
		if (u.type === "TSTypeReference") {
			const ref = this.code(u.typeName);
			const arg = (u.typeArguments?.params ?? u.typeParameters?.params ?? [])[0];
			if (/^(z\.)?(infer|input|output|Infer)$/.test(ref) && arg?.type === "TSTypeQuery") {
				const schemaName = this.code(arg.exprName);
				const local = this.findDecl(schemaName);
				if (local?.node.type === "VariableDeclarator") return this.schema(title, local.node.init, node, 0, schemaName);
				return this.emit(0, `${x.schemaShape({ name: title, schema: mk("t", schemaName, schemaName) })}.`, node, "head");
			}
		}
		if (u.type === "TSIntersectionType") {
			const refs = u.types.filter((x: N) => x.type !== "TSTypeLiteral").map((x: N) => this.typeLink(x));
			this.emit(0, `${x.intersection({ name: title, bases: refs.length ? this.e.g.list(refs) : null })}:`, node, "head");
			for (const lit of u.types.filter((x: N) => x.type === "TSTypeLiteral")) this.members(lit.members, lit.start, 1);
			return;
		}
		if (u.type === "TSUnionType" && u.types.every((x: N) => x.type === "TSLiteralType")) {
			this.emit(0, `${x.oneOf({ name: title })}:`, node, "head");
			let prevEnd = u.start;
			for (const opt of u.types) {
				const doc = this.docFor(opt, prevEnd);
				prevEnd = opt.end;
				this.emit(1, `• ${x.option({ value: mk("l", this.code(opt)), doc })}`, opt, "bullet");
			}
			return;
		}
		this.emit(0, `${x.is({ name: title, type: this.e.typeText(u, true) })}.`, node, "head");
	}

	/** zod: `z.object({...})`, `Base.extend({...})`, `z.enum([...])`, ... */
	schema(title: string, init: N, node: N, d: number, schemaName?: string) {
		const steps: { m: string; args: N[] }[] = [];
		let cur = unwrap(init);
		while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression") {
			const c = unwrap(cur.callee);
			steps.unshift({ m: c.property.name, args: cur.arguments });
			cur = unwrap(c.object);
		}
		const x = this.e.say.types.explain;
		const name = schemaName ? x.fromSchema({ name: title, schema: mk("t", schemaName, schemaName) }) : title;
		const isZ = cur?.type === "Identifier" && cur.name === "z";
		const objStep = steps.find(
			(s) => ["object", "strictObject", "looseObject", "extend", "merge"].includes(s.m) && unwrap(s.args[0])?.type === "ObjectExpression",
		);
		const description = this.metaDescription(steps);
		if (description) this.emit(d, this.e.say.statements.comment({ text: description }), node, "note");
		if (objStep) {
			const bases = !isZ && cur ? [this.typeLink(cur)] : [];
			for (const s of steps) if ((s.m === "merge" || s.m === "extend") && unwrap(s.args[0])?.type !== "ObjectExpression") bases.push(this.typeLink(s.args[0]));
			this.emit(d, `${x.object({ name, bases: bases.length ? this.e.g.list(bases) : null })}:`, node, "head");
			for (const s of steps) {
				const o = unwrap(s.args[0]);
				if (o?.type !== "ObjectExpression") continue;
				let prevEnd = o.start;
				for (const p of o.properties) {
					if (p.type === "SpreadElement") {
						this.emit(d + 1, `• ${this.e.say.expressions.everythingIn({ value: this.typeLink(unwrap(p.argument).object ?? p.argument) })}`, p, "bullet");
						continue;
					}
					const key = p.key?.name ?? String(p.key?.value);
					const doc = this.docFor(p, prevEnd);
					prevEnd = p.end;
					const f = this.field(p.value);
					const line = x.member({ name: mk("v", this.e.lex.humanize(key), key), type: f.type, optional: f.optional, doc: f.description ?? doc });
					this.emit(d + 1, `• ${line}`, p, "bullet");
				}
			}
			return;
		}
		const t = this.e.schemaText(init);
		this.emit(d, `${x.is({ name, type: t ?? this.e.noun(init).t })}.`, node, "head");
	}

	metaDescription(steps: { m: string; args: N[] }[]): string | null {
		for (const s of steps) {
			const a = unwrap(s.args[0]);
			if (s.m === "describe" && a?.type === "Literal") return String(a.value);
			if ((s.m === "meta" || s.m === "openapi") && a?.type === "ObjectExpression") {
				const p = a.properties.find((x: N) => x.key?.name === "description");
				const v = p && unwrap(p.value);
				if (v?.type === "Literal") return String(v.value);
				if (v?.type === "TemplateLiteral") return v.quasis.map((q: N) => q.value.cooked).join("…");
			}
		}
		return null;
	}

	field(value: N): { type: string; optional: boolean; description: string | null } {
		const steps: { m: string; args: N[] }[] = [];
		let cur = unwrap(value);
		while (cur?.type === "CallExpression" && unwrap(cur.callee).type === "MemberExpression") {
			const c = unwrap(cur.callee);
			steps.unshift({ m: c.property.name, args: cur.arguments });
			cur = unwrap(c.object);
		}
		const optional = steps.some((s) => s.m === "optional" || s.m === "nullish");
		const description = this.metaDescription(steps);
		const x = this.e.say.types.explain;
		const z = this.e.schemaText(value);
		if (z) return { type: x.schemaField({ described: z }), optional, description };
		const base = cur?.type === "Identifier" ? this.typeLink(cur) : cur ? this.e.noun(cur).t : this.e.say.types.unknown;
		const modifiers = steps.flatMap((s) =>
			s.m === "nullable" ? [x.nullable] : s.m === "default" ? [x.defaultsTo({ value: this.e.text(s.args[0]) })] : s.m === "array" ? [x.list] : [],
		);
		return { type: x.modified({ base, modifiers }), optional, description };
	}
}
