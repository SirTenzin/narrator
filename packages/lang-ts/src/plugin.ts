import type { Doc, Vocabulary } from "@usenarrator/core";
import type { Engine, N } from "./engine";

type RuleResult = Doc | string | null | undefined;

/** Narrates a call as a noun phrase (or, when `stmt`, as an action). Return null to let the next rule try. */
export type CallRule<P = any> = (ctx: { node: N; args: N[]; obj: N | null; e: Engine; stmt: boolean; say: P }) => RuleResult;
/** Narrates a call used as a yes/no condition; `neg` asks for the negated form. */
export type CondRule<P = any> = (ctx: { node: N; args: N[]; obj: N | null; e: Engine; neg: boolean; say: P }) => RuleResult;
/** Takes over a whole statement; return true once you've emitted lines for it. */
export type StmtRule<P = any> = (ctx: { node: N; e: Engine; d: number; say: P }) => boolean;

/** Optional display text a phrasebook can carry; the engine merges it over the plugin's own fields. */
export type DisplayText = {
	constants?: Record<string, string>;
	errorLabels?: Record<string, string>;
	/** Abbreviation -> display words in this locale, e.g. `{ cus: "cliente" }`. */
	glossary?: Record<string, string>;
};

/** Narrates a property read like `c.env.DB`. Keys: `Obj.prop`, `*.owner.prop`, `*.prop`. */
export type MemberRule<P = any> = (ctx: { node: N; obj: N; prop: string; e: Engine; say: P }) => RuleResult;

/** Narrates a JSX element or fragment wherever the engine meets one (arguments, lambdas, returns). */
export type JsxRule<P = any> = (ctx: { node: N; e: Engine; say: P }) => RuleResult;

/** Where an imported local name came from: `import { a as b } from "x"` -> b: { from: "x", name: "a" }. */
export type ImportInfo = { from: string; name: string };

/** Phrasebooks keyed by locale id. English is required: it's the fallback and the reference for translators. */
export type Phrasebooks<P> = { en: P } & { [locale: string]: P };

/** A TS/JS plugin: rules for one library or codebase. `P` is the shape of its phrasebook. */
export type TsPlugin<P = any> = {
	/** Unique name; locales can override this plugin's phrases under `locale.plugins[name]`. */
	name: string;
	phrases?: Phrasebooks<P>;
	/** The library this plugin reads and the semver range of its versions it was written against, e.g. `{ name: "better-auth", versions: ">=1.6 <2" }`. */
	library?: { name: string; versions: string };
	vocabulary?: Vocabulary;
	/** Identifiers that are plumbing: dropped from argument lists and member chains (e.g. `ctx`). */
	ambient?: string[];
	/** Constructor names whose instances are errors; `message` is pulled out for `throw`. */
	errors?: string[] | RegExp;
	/** How to name an error class when thrown, e.g. `{ RecaseError: "an error" }`. */
	errorLabels?: Record<string, string>;
	/** Exact source text -> phrase, e.g. `{ "Number.MAX_SAFE_INTEGER": "no limit" }`. */
	constants?: Record<string, string>;
	/** Keyed by callee: `foo`, `Obj.method`, `*.method` (any receiver), `new Foo`, `Effect.fn()` (curried: `Effect.fn(a)(b)`), `sql``` / `*.sql``` / `sql.typeAlias()``` (tagged templates). Later plugins win. */
	calls?: Record<string, CallRule<P>>;
	conditions?: Record<string, CondRule<P>>;
	members?: Record<string, MemberRule<P>>;
	jsx?: JsxRule<P>;
	statements?: StmtRule<P>[];
	/** Describes a schema-builder expression (e.g. `z.object({...})`) as a type, or null if it isn't one. */
	describeSchema?: (e: Engine, n: N, say: P) => string | null;
};

/** Identity helper: infers `P` from `phrases.en` so every rule's `say` is typed. */
export const definePlugin = <P = any>(p: TsPlugin<P>): TsPlugin<P> => p;
