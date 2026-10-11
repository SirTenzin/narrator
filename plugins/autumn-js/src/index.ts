import { D, type Doc } from "@usenarrator/core";
import { type CallRule, type CondRule, definePlugin, type Engine, type MemberRule, type N, type StmtRule, type TsPlugin, unwrap } from "@usenarrator/lang-ts";
import * as billing from "./billing";
import { clientDoc } from "./client";
import { en } from "./en";
import { clientPath, factsReader, HOOKS, hookAction, hookOf, importedAs } from "./facts";
import { handler, serveText } from "./handlers";
import type { AutumnPhrases as __PluginPhrases, AutumnPhrases } from "./phrases";
import { ACTIONS, hookCall } from "./react";
import { catalog, customers, entities, generic, licenses, referrals } from "./resources";
import { ALLOWED, type Answers, answerOf, answerText, asDoc, balanceText, FAILED, HAS_URL, opName, rewriteConditions, urlKind } from "./results";
import type { Ctx, Said } from "./shared";
import * as usage from "./usage";

export { en } from "./en";
export type { AutumnPhrases } from "./phrases";

type P = AutumnPhrases;
type Op = (c: Ctx, args: N[]) => Said;

/** Client calls by path. 0.x names come first where 1.x renamed them; both read the same. */
const CLIENT: Record<string, Op> = {
	check: (c, a) => usage.check(c, a),
	track: usage.track,
	trackTokens: usage.trackTokens,
	"balances.trackTokens": usage.trackTokens,
	batchTrack: usage.batchTrack,
	usage: usage.setBalance,
	setUsage: usage.setBalance,
	query: (c, a) => usage.usageQuery(c, a, "aggregate"),
	"events.aggregate": (c, a) => usage.usageQuery(c, a, "aggregate"),
	"events.list": (c, a) => usage.usageQuery(c, a, "list"),
	attach: billing.attach,
	checkout: billing.checkout,
	cancel: billing.cancel,
	setupPayment: billing.setupPayment,
	updateSubscription: billing.update,
	"billing.attach": billing.attach,
	"billing.multiAttach": billing.multiAttach,
	"billing.previewAttach": billing.previewAttach,
	"billing.previewMultiAttach": billing.previewMultiAttach,
	"billing.update": billing.update,
	"billing.previewUpdate": billing.previewUpdate,
	"billing.multiUpdate": billing.multiUpdate,
	"billing.openCustomerPortal": billing.portal,
	"billing.setupPayment": billing.setupPayment,
	"billing.createSchedule": billing.schedule,
	"billing.verify": billing.verify,
	"billing.import": billing.importCustomer,
	"customers.getOrCreate": customers.getOrCreate,
	"customers.create": customers.getOrCreate,
	"customers.get": customers.get,
	"customers.list": customers.list,
	"customers.update": customers.update,
	"customers.delete": customers.delete,
	"customers.billingPortal": billing.portal,
	"customers.updateBalances": usage.updateBalances,
	"customers.listSubscriptions": customers.listSubscriptions,
	"customers.listPurchases": customers.listPurchases,
	"customers.advanceTestClock": customers.advanceTestClock,
	"entities.create": entities.create,
	"entities.get": entities.get,
	"entities.update": entities.update,
	"entities.delete": entities.delete,
	"entities.list": entities.list,
	"entities.transfer": entities.transfer,
	"plans.get": catalog.getPlan,
	"plans.list": catalog.listPlans,
	"plans.create": catalog.createPlan,
	"plans.update": catalog.updatePlan,
	"plans.delete": catalog.deletePlan,
	"products.get": catalog.getPlan,
	"products.list": catalog.listPlans,
	"products.create": catalog.createPlan,
	"products.delete": catalog.deletePlan,
	"features.get": catalog.getFeature,
	"features.list": catalog.listFeatures,
	"features.create": catalog.createFeature,
	"features.update": catalog.updateFeature,
	"features.delete": catalog.deleteFeature,
	"balances.create": usage.grantBalance,
	"balances.update": usage.setBalance,
	"balances.delete": usage.deleteBalance,
	"balances.list": usage.listBalances,
	"balances.finalize": usage.finalize,
	"referrals.createCode": referrals.createCode,
	"referrals.redeemCode": referrals.redeemCode,
	"rewards.redeemCode": referrals.redeemReward,
	"licenses.attach": licenses.attach,
	"licenses.release": licenses.release,
};

/** Methods of the resources read generically (`webhooks.sync`, `invoices.void`, `referrals.createProgram`). */
const GENERIC_METHODS: Record<string, string[]> = {
	invoices: ["create", "finalize", "insert", "list", "listTemplates", "pay", "issueCreditNote", "reissue", "void"],
	rewards: ["create", "list", "get", "update", "delete"],
	webhooks: ["create", "get", "list", "update", "delete", "previewSync", "sync"],
	keys: ["mint", "refresh", "revoke"],
	sandboxes: ["create", "list", "delete", "reset"],
	logs: ["search"],
	platform: ["getStripeConnection", "disconnectStripe", "linkRevenueCat", "syncRevenueCat", "getRevenueCatKeys"],
};
const PROGRAM_METHODS: Record<string, string> = {
	createProgram: "create",
	listPrograms: "list",
	getProgram: "get",
	updateProgram: "update",
	deleteProgram: "delete",
};

/** 0.x calls that take an ID first: `customers.get(id, params)`, `entities.get(customerId, entityId)`. */
const POSITIONAL = new Set([
	"customers.get",
	"customers.update",
	"customers.delete",
	"customers.billingPortal",
	"customers.updateBalances",
	"entities.create",
	"entities.get",
	"entities.delete",
	"entities.transfer",
	"products.get",
	"products.delete",
	"features.get",
	"batchTrack",
]);

const isObject = (n: N) => unwrap(n)?.type === "ObjectExpression";

const HANDLERS = ["autumnHandler", "expressAutumnHandler", "fetchAutumnHandler", "honoAutumnHandler", "nextAutumnHandler"];

/** What an Autumn call says, or null when the call isn't Autumn's. */
function said(c: Ctx, node: N): Said | null {
	const call = unwrap(node);
	const args: N[] = call.arguments;
	const hook = hookOf(c.facts, call);
	if (hook) return hookCall(c, hook, args);
	const callee = unwrap(call.callee);
	if (callee?.type === "Identifier" && HANDLERS.includes(importedAs(c.facts, callee.name) ?? "")) return handler(c, args);
	const path = clientPath(c.facts, call)?.replace(/^v2\./, "");
	if (!path) {
		const action = hookAction(c.facts, call.callee);
		if (!action || !ACTIONS[action.method]) return null;
		if (args[0] && !isObject(args[0]) && !(action.method === "createEntity" && unwrap(args[0])?.type === "ArrayExpression")) return null;
		// Every hook has a `refetch`; only the customer's reloads the customer.
		if (action.method === "refetch" && action.hook !== "useCustomer") return null;
		return ACTIONS[action.method]!(c, args);
	}
	if (args[0] && !isObject(args[0]) && !POSITIONAL.has(path)) return null;
	if (CLIENT[path]) return CLIENT[path](c, args);
	const [resource, method] = path.split(".");
	if (!resource || !method) return null;
	if (resource === "referrals" && PROGRAM_METHODS[method]) return generic(c, "referralPrograms", PROGRAM_METHODS[method]!, args);
	return GENERIC_METHODS[resource]?.includes(method) ? generic(c, resource, method, args) : null;
}

/** `const res = await autumn.check(…)` and `const { allowed } = …`: the step first, then the names it gives. */
function declaration(c: Ctx, node: N, d: number): boolean {
	const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
	if (decl?.type !== "VariableDeclaration" || decl.declarations.length !== 1) return false;
	const [v] = decl.declarations;
	const init = unwrap(v.init);
	if (init?.type !== "CallExpression") return false;
	const s = said(c, init);
	if (!s) return false;
	const { e } = c;
	const dc = e.say.declarations;
	// The routes `autumnHandler({ identify })` returns read as a value; the low-level handler's forwarding is a step.
	const routes = s.do === c.say.handler.routes;
	const isCheck = opName(c.facts, init) === "check";
	if (v.id.type === "Identifier") {
		if (routes) return false;
		const kept = v.id.name === "result";
		const name = e.ref(v.id.name);
		const text = isCheck
			? kept
				? c.say.check.keepAnswer({ call: s.do })
				: c.say.check.callAnswer({ call: s.do, name })
			: kept
				? c.say.results.keep({ call: s.do })
				: dc.callAs({ call: s.do, name });
		e.emitDoc(d, D(text, s.kids), node);
		return true;
	}
	if (v.id.type !== "ObjectPattern") return false;
	const names = e.patternNames(v.id);
	if (!names.length) return false;
	const list = e.g.list(names);
	const props = v.id.properties;
	const onlyAnswer = isCheck && props.length === 1 && props[0].type === "Property" && props[0].key?.name === "allowed";
	const text = routes ? serveText(c, list) : onlyAnswer ? c.say.check.callAnswer({ call: s.do, name: list }) : dc.callTake({ call: s.do, names: list });
	e.emitDoc(d, D(text, s.kids), node);
	return true;
}

/** Autumn's JavaScript SDK (`autumn-js` on npm): check and track, plans, checkout and billing, customers and entities,
 * backend handlers and React hooks, across the 0.x and 1.x APIs. */
export const autumnJs = (): TsPlugin<P> => {
	const read = factsReader();
	const answers: Answers = new WeakMap();
	const ctx = (e: Engine, say: P): Ctx => ({ e, say, facts: read(e) });
	const rule: CallRule<P> = ({ e, say, node, stmt }) => {
		const c = ctx(e, say);
		if (!c.facts.active) return null;
		const s = said(c, node);
		return s ? (D(stmt ? s.do : s.done, s.kids) as Doc) : null;
	};
	const methods = new Set<string>();
	for (const k of Object.keys(CLIENT)) methods.add(k.split(".").at(-1)!);
	for (const list of Object.values(GENERIC_METHODS)) for (const m of list) methods.add(m);
	for (const m of Object.keys(PROGRAM_METHODS)) methods.add(m);
	for (const m of Object.keys(ACTIONS)) methods.add(m);
	const calls: Record<string, CallRule<P>> = {};
	for (const m of methods) calls[`*.${m}`] = rule;
	for (const m of Object.keys(ACTIONS)) calls[m] = rule;
	for (const h of [...HOOKS, ...HANDLERS]) calls[h] = rule;
	calls["new Autumn"] = ({ e, say, node, args }) => clientDoc(ctx(e, say), node, args);
	calls[ALLOWED] = ({ e, say, node }) => {
		const a = answers.get(node);
		return a && "check" in a ? answerText(ctx(e, say), a.check) : null;
	};
	const conditions: Record<string, CondRule<P>> = {
		[ALLOWED]: ({ e, say, node, neg }) => {
			const a = answers.get(node);
			return a && "check" in a ? usage.checkCondition(ctx(e, say), a.check, neg) : null;
		},
		[HAS_URL]: ({ say, node, neg }) => {
			const a = answers.get(node);
			return a && "url" in a ? say.billing.hasUrl({ what: say.billing.urls[a.url], neg }) : null;
		},
		[FAILED]: ({ say, neg }) => say.results.failed({ neg }),
	};
	const members: Record<string, MemberRule<P>> = {
		"*.allowed": ({ e, say, node }) => {
			const c = ctx(e, say);
			const call = answerOf(c.facts, node);
			return call ? answerText(c, call) : null;
		},
		"*.balance": ({ e, say, obj }) => asDoc(balanceText(ctx(e, say), obj)),
	};
	for (const prop of ["paymentUrl", "payment_url", "checkout_url", "url"])
		members[`*.${prop}`] = ({ e, say, obj }) => {
			const kind = urlKind(read(e), obj, prop);
			return kind ? say.billing.url({ what: say.billing.urls[kind] }) : null;
		};
	const statements: StmtRule<P>[] = [
		({ e, say, node }) => {
			rewriteConditions(ctx(e, say), node, answers);
			return false;
		},
		({ e, say, node, d }) => {
			const c = ctx(e, say);
			return c.facts.active && declaration(c, node, d);
		},
	];
	return definePlugin<P>({
		name: "autumn-js",
		library: { name: "autumn-js", versions: ">=0.1 <2" },
		phrases: { en },
		calls,
		conditions,
		members,
		statements,
	});
};

declare module "@usenarrator/core" {
	interface PluginPhrases {
		"autumn-js": __PluginPhrases;
	}
}
