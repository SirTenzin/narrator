import { D, type Doc } from "@usenarrator/core";
import { type N, unwrap } from "@usenarrator/lang-ts";
import type { BetterAuthPhrases } from "./phrases";
import {
	type Ctx,
	callback,
	callbackDoc,
	choice,
	count,
	duration,
	flag,
	generic,
	group,
	isFn,
	items,
	keyOf,
	literal,
	objectArg,
	optionDocs,
	plainOption,
	type Spec,
	type Specs,
	section,
	tableSpecs,
	value,
} from "./render";

type P = BetterAuthPhrases;

/** A boolean option that may also be a callback deciding it per call. */
const flagOrCallback =
	(flagSpec: Spec, cbPick: (s: P) => string): Spec =>
	(ctx) =>
		isFn(unwrap(ctx.node)) ? callback(cbPick)(ctx) : flagSpec(ctx);

const everythingIn = ({ e, say, node }: Ctx & { node: N }): Doc => {
	const v = e.noun(node);
	return D(say.frame.everythingIn({ value: v.t }), v.kids);
};

/** `plugins: [twoFactor(), organization()]` -> one bullet per plugin. */
const pluginList =
	(pick: (s: P) => string): Spec =>
	({ e, say, node }) => {
		const u = unwrap(node);
		if (u?.type !== "ArrayExpression") return plainOption({ e, say, name: pick(say), node });
		const parts = u.elements.filter(Boolean).map((x: N) => (x.type === "SpreadElement" ? everythingIn({ e, say, node: x.argument }) : e.noun(x)));
		return D(
			pick(say),
			parts.flatMap((p: Doc) => e.bullet(p)),
		);
	};

const socialSpecs: Specs = {
	clientId: value((s) => s.config.social.clientId),
	clientSecret: value((s) => s.config.social.clientSecret),
	redirectURI: value((s) => s.config.social.redirectURI),
	scope: items((s) => s.config.social.scope),
	prompt: choice((s) => s.config.social.prompt, generic("prompt")),
	disableSignUp: flag((s) => s.config.social.disableSignUp),
	disableImplicitSignUp: flag((s) => s.config.social.disableImplicitSignUp),
	overrideUserInfoOnSignIn: flag((s) => s.config.social.overrideUserInfoOnSignIn),
	mapProfileToUser: callback((s) => s.config.social.mapProfileToUser),
	getUserInfo: callback((s) => s.config.social.getUserInfo),
	tenantId: value((s) => s.config.social.tenantId),
};

/** `socialProviders: { github: {...} }` -> a "sign-in with GitHub" bullet per provider. */
const socialProviders: Spec = ({ e, say, node }) => {
	const o = objectArg(node);
	if (!o) return generic("socialProviders")({ e, say, node });
	return o.properties.map((p: N) => {
		if (p.type === "SpreadElement") return everythingIn({ e, say, node: p.argument });
		const key = keyOf(p) ?? e.code(p.key);
		const title = say.config.socialProvider({ provider: say.providers[key] ?? e.prop(key) });
		return section(() => title, socialSpecs)({ e, say, node: p.value }) as Doc;
	});
};

const DB_OPS = ["create", "update", "delete"] as const;
const isDbOp = (k: string | null): k is (typeof DB_OPS)[number] => DB_OPS.includes(k as never);

/** `databaseHooks: { user: { create: { before } } }` -> "before a user is created: …". */
const databaseHooks: Spec = ({ e, say, node }) => {
	const o = objectArg(node);
	if (!o) return generic("databaseHooks")({ e, say, node });
	const hooks = o.properties.flatMap((mp: N): Doc[] => {
		if (mp.type === "SpreadElement") return [everythingIn({ e, say, node: mp.argument })];
		const mkey = keyOf(mp) ?? e.code(mp.key);
		const model = say.config.models[mkey] ?? e.prop(mkey);
		const ops = objectArg(mp.value);
		if (!ops) return [plainOption({ e, say, name: e.prop(mkey), node: mp.value })];
		return ops.properties.flatMap((op: N): Doc[] => {
			const opKey = keyOf(op);
			const timings = objectArg(op.value);
			if (!isDbOp(opKey) || !timings) return [plainOption({ e, say, name: e.prop(opKey ?? e.code(op.key)), node: op.value })];
			return timings.properties.map((t: N) => {
				const when = keyOf(t);
				if (when !== "before" && when !== "after") return plainOption({ e, say, name: e.prop(when ?? e.code(t.key)), node: t.value });
				return callbackDoc({ e, say, node: t.value, intro: say.config.dbHook[when][opKey]({ model }) });
			});
		});
	});
	return group({ e, say, title: say.config.databaseHooks, items: hooks });
};

const generateId: Spec = (ctx) => {
	const { say, node } = ctx;
	if (literal(node) === false) return D(say.config.advanced.generateId.off);
	if (isFn(unwrap(node))) return callback((s) => s.config.advanced.generateIdFn)(ctx);
	return choice((s) => s.config.advanced.generateId, generic("generateId"))(ctx);
};

const trustedOrigins: Spec = (ctx) => (isFn(unwrap(ctx.node)) ? callback((s) => s.config.trustedOriginsFn)(ctx) : items((s) => s.config.trustedOrigins)(ctx));

/** Options of `betterAuth({...})`. */
export const serverSpecs: Specs = {
	appName: value((s) => s.config.appName),
	baseURL: value((s) => s.config.baseURL),
	basePath: value((s) => s.config.basePath),
	secret: value((s) => s.config.secret),
	database: value((s) => s.config.database),
	secondaryStorage: value((s) => s.config.secondaryStorage),
	trustedOrigins,
	disabledPaths: items((s) => s.config.disabledPaths),
	plugins: pluginList((s) => s.config.plugins),
	socialProviders,
	databaseHooks,
	emailAndPassword: section((s) => s.config.emailAndPassword.title, {
		requireEmailVerification: flag((s) => s.config.emailAndPassword.requireEmailVerification),
		minPasswordLength: count((s) => s.config.emailAndPassword.minPasswordLength),
		maxPasswordLength: count((s) => s.config.emailAndPassword.maxPasswordLength),
		autoSignIn: flag((s) => s.config.emailAndPassword.autoSignIn),
		disableSignUp: flag((s) => s.config.emailAndPassword.disableSignUp),
		sendResetPassword: callback((s) => s.config.emailAndPassword.sendResetPassword),
		onPasswordReset: callback((s) => s.config.emailAndPassword.onPasswordReset),
		resetPasswordTokenExpiresIn: duration((s) => s.config.emailAndPassword.resetPasswordTokenExpiresIn),
		revokeSessionsOnPasswordReset: flag((s) => s.config.emailAndPassword.revokeSessionsOnPasswordReset),
		password: section((s) => s.config.emailAndPassword.password, {
			hash: callback((s) => s.config.emailAndPassword.hash),
			verify: callback((s) => s.config.emailAndPassword.verify),
		}),
	}),
	emailVerification: section((s) => s.config.emailVerification.title, {
		sendVerificationEmail: callback((s) => s.config.emailVerification.sendVerificationEmail),
		sendOnSignUp: flag((s) => s.config.emailVerification.sendOnSignUp),
		sendOnSignIn: flag((s) => s.config.emailVerification.sendOnSignIn),
		autoSignInAfterVerification: flag((s) => s.config.emailVerification.autoSignInAfterVerification),
		expiresIn: duration((s) => s.config.emailVerification.expiresIn),
		afterEmailVerification: callback((s) => s.config.emailVerification.afterEmailVerification),
	}),
	session: section((s) => s.config.session.title, {
		...tableSpecs,
		expiresIn: duration((s) => s.config.session.expiresIn),
		updateAge: duration((s) => s.config.session.updateAge),
		freshAge: duration((s) => s.config.session.freshAge),
		disableSessionRefresh: flag((s) => s.config.session.disableSessionRefresh),
		storeSessionInDatabase: flag((s) => s.config.session.storeSessionInDatabase),
		cookieCache: section((s) => s.config.session.cookieCache, {
			maxAge: duration((s) => s.config.session.maxAge),
			strategy: value((s) => s.config.session.strategy),
		}),
	}),
	account: section((s) => s.config.account.title, {
		...tableSpecs,
		accountLinking: section((s) => s.config.account.accountLinking, {
			trustedProviders: items((s) => s.config.account.trustedProviders),
			allowDifferentEmails: flag((s) => s.config.account.allowDifferentEmails),
			disableImplicitLinking: flag((s) => s.config.account.disableImplicitLinking),
		}),
		encryptOAuthTokens: flag((s) => s.config.account.encryptOAuthTokens),
		updateAccountOnSignIn: flag((s) => s.config.account.updateAccountOnSignIn),
	}),
	user: section((s) => s.config.user.title, {
		...tableSpecs,
		changeEmail: section((s) => s.config.user.changeEmail, {
			sendChangeEmailVerification: callback((s) => s.config.user.sendChangeEmailVerification),
			sendChangeEmailConfirmation: callback((s) => s.config.user.sendChangeEmailConfirmation),
			updateEmailWithoutVerification: flag((s) => s.config.user.updateEmailWithoutVerification),
		}),
		deleteUser: section((s) => s.config.user.deleteUser, {
			sendDeleteAccountVerification: callback((s) => s.config.user.sendDeleteAccountVerification),
			beforeDelete: callback((s) => s.config.user.beforeDelete),
			afterDelete: callback((s) => s.config.user.afterDelete),
		}),
	}),
	verification: section((s) => s.config.verification, tableSpecs),
	rateLimit: section((s) => s.config.rateLimit.title, {
		window: duration((s) => s.config.rateLimit.window),
		max: count((s) => s.config.rateLimit.max),
		storage: value((s) => s.config.rateLimit.storage),
		modelName: tableSpecs.modelName!,
		customRules: section((s) => s.config.rateLimit.customRules),
	}),
	advanced: section((s) => s.config.advanced.title, {
		cookiePrefix: value((s) => s.config.advanced.cookiePrefix),
		useSecureCookies: flag((s) => s.config.advanced.useSecureCookies),
		disableCSRFCheck: flag((s) => s.config.advanced.disableCSRFCheck),
		disableOriginCheck: flag((s) => s.config.advanced.disableOriginCheck),
		crossSubDomainCookies: section((s) => s.config.advanced.crossSubDomainCookies, {
			domain: value((s) => s.config.advanced.domain),
		}),
		ipAddress: section((s) => s.config.advanced.ipAddress, {
			ipAddressHeaders: items((s) => s.config.advanced.ipAddressHeaders),
			disableIpTracking: flag((s) => s.config.advanced.disableIpTracking),
		}),
		generateId,
		database: section((s) => s.config.advanced.database, {
			generateId,
			defaultFindManyLimit: count((s) => s.config.advanced.defaultFindManyLimit),
		}),
		backgroundTasks: section((s) => s.config.advanced.backgroundTasks, {
			handler: value((s) => s.config.advanced.backgroundHandler),
		}),
	}),
	hooks: section((s) => s.config.hooks.title, {
		before: callback((s) => s.config.hooks.before, { withGiven: false }),
		after: callback((s) => s.config.hooks.after, { withGiven: false }),
	}),
	onAPIError: section((s) => s.config.onAPIError.title, {
		throw: flag((s) => s.config.onAPIError.throw),
		onError: callback((s) => s.config.onAPIError.onError),
		errorURL: value((s) => s.config.onAPIError.errorURL),
	}),
	telemetry: section((s) => s.config.telemetry),
};

/** Server plugins by factory name, with their option specs. Client plugins (`xClient`) share the feature phrase. */
export const pluginSpecs: Record<string, Specs> = {
	twoFactor: {
		issuer: value((s) => s.plugins.twoFactor.issuer),
		skipVerificationOnEnable: flag((s) => s.plugins.twoFactor.skipVerificationOnEnable),
		otpOptions: section((s) => s.plugins.twoFactor.otpOptions, {
			sendOTP: callback((s) => s.plugins.twoFactor.sendOTP),
			period: duration((s) => s.plugins.twoFactor.period),
		}),
		backupCodeOptions: section((s) => s.plugins.twoFactor.backupCodeOptions, {
			amount: count((s) => s.plugins.twoFactor.amount),
		}),
	},
	organization: {
		allowUserToCreateOrganization: flagOrCallback(
			flag((s) => s.plugins.organization.allowUserToCreateOrganization),
			(s) => s.plugins.organization.allowUserToCreateOrganizationFn,
		),
		organizationLimit: count((s) => s.plugins.organization.organizationLimit),
		membershipLimit: count((s) => s.plugins.organization.membershipLimit),
		creatorRole: value((s) => s.plugins.organization.creatorRole),
		invitationExpiresIn: duration((s) => s.plugins.organization.invitationExpiresIn),
		sendInvitationEmail: callback((s) => s.plugins.organization.sendInvitationEmail),
		teams: section((s) => s.plugins.organization.teams, {
			maximumTeams: count((s) => s.plugins.organization.maximumTeams),
		}),
		organizationHooks: section((s) => s.plugins.organization.organizationHooks),
	},
	admin: {
		defaultRole: value((s) => s.plugins.admin.defaultRole),
		adminRoles: items((s) => s.plugins.admin.adminRoles),
		adminUserIds: items((s) => s.plugins.admin.adminUserIds),
		impersonationSessionDuration: duration((s) => s.plugins.admin.impersonationSessionDuration),
		defaultBanReason: value((s) => s.plugins.admin.defaultBanReason),
		defaultBanExpiresIn: duration((s) => s.plugins.admin.defaultBanExpiresIn),
	},
	passkey: {
		rpID: value((s) => s.plugins.passkey.rpID),
		rpName: value((s) => s.plugins.passkey.rpName),
		origin: value((s) => s.plugins.passkey.origin),
	},
	magicLink: {
		sendMagicLink: callback((s) => s.plugins.magicLink.sendMagicLink),
		expiresIn: duration((s) => s.plugins.magicLink.expiresIn),
		disableSignUp: flag((s) => s.plugins.magicLink.disableSignUp),
	},
	emailOTP: {
		sendVerificationOTP: callback((s) => s.plugins.emailOTP.sendVerificationOTP),
		otpLength: count((s) => s.plugins.emailOTP.otpLength),
		expiresIn: duration((s) => s.plugins.emailOTP.expiresIn),
	},
	username: {
		minUsernameLength: count((s) => s.plugins.username.minUsernameLength),
		maxUsernameLength: count((s) => s.plugins.username.maxUsernameLength),
	},
	twoFactorClient: {
		onTwoFactorRedirect: callback((s) => s.plugins.twoFactorClient.onTwoFactorRedirect),
	},
};

/** Options of `createAuthClient({...})`. */
export const clientSpecs = (fetchSpecs: Specs): Specs => ({
	baseURL: value((s) => s.client.baseURL),
	basePath: value((s) => s.client.basePath),
	plugins: pluginList((s) => s.client.plugins),
	fetchOptions: section((s) => s.client.fetchOptions, fetchSpecs),
});

/** `twoFactor({ issuer })` -> "two-factor authentication (…)"; `organizationClient()` reads the same as `organization()`. */
export function pluginDoc({ e, say, name, args }: Ctx & { name: string; args: N[] }): Doc | null {
	const feature = say.plugins.features[name] ?? say.plugins.features[name.replace(/Client$/, "")];
	if (!feature) return null;
	const opts = args[0] && objectArg(args[0]) ? optionDocs({ e, say, node: args[0], specs: pluginSpecs[name] ?? {} }) : args.map((a) => e.noun(a));
	return group({ e, say, title: feature, items: opts });
}
