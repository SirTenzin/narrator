import { D, type Doc } from "@usenarrator/core";
import { type CallRule, type N, unwrap } from "@usenarrator/lang-ts";
import type { BetterAuthPhrases, DoEndpoint, GetEndpoint } from "./phrases";
import { type Ctx, callback, findProp, flag, group, literal, objectArg, optionDocs, plainOption, type Spec, type Specs, value } from "./render";

type P = BetterAuthPhrases;
type Entry = [GetEndpoint, "get", string | null, string | null] | [DoEndpoint | "signInSocial" | "linkSocial", "do", string | null, string | null];

/** [phrase key, kind, `auth.api.<name>`, client path (`signIn.email`, `organization.create`, `signOut`)]. */
const ENDPOINTS: Entry[] = [
	["session", "get", "getSession", "getSession"],
	["liveSession", "get", null, "useSession"],
	["sessions", "get", "listSessions", "listSessions"],
	["accounts", "get", "listUserAccounts", "listAccounts"],
	["accessToken", "get", "getAccessToken", "getAccessToken"],
	["accountInfo", "get", "accountInfo", "accountInfo"],
	["signInEmail", "do", "signInEmail", "signIn.email"],
	["signUpEmail", "do", "signUpEmail", "signUp.email"],
	["signInSocial", "do", "signInSocial", "signIn.social"],
	["linkSocial", "do", "linkSocialAccount", "linkSocial"],
	["signOut", "do", "signOut", "signOut"],
	["revokeSession", "do", "revokeSession", "revokeSession"],
	["revokeSessions", "do", "revokeSessions", "revokeSessions"],
	["revokeOtherSessions", "do", "revokeOtherSessions", "revokeOtherSessions"],
	["updateUser", "do", "updateUser", "updateUser"],
	["updateSession", "do", "updateSession", "updateSession"],
	["changePassword", "do", "changePassword", "changePassword"],
	["changeEmail", "do", "changeEmail", "changeEmail"],
	["deleteUser", "do", "deleteUser", "deleteUser"],
	["requestPasswordReset", "do", "requestPasswordReset", "requestPasswordReset"],
	["requestPasswordReset", "do", "forgetPassword", "forgetPassword"],
	["resetPassword", "do", "resetPassword", "resetPassword"],
	["sendVerificationEmail", "do", "sendVerificationEmail", "sendVerificationEmail"],
	["verifyEmail", "do", "verifyEmail", "verifyEmail"],
	["unlinkAccount", "do", "unlinkAccount", "unlinkAccount"],
	["refreshToken", "do", "refreshToken", "refreshToken"],
	["organizations", "get", "listOrganizations", "organization.list"],
	["liveOrganizations", "get", null, "useListOrganizations"],
	["activeOrganization", "get", null, "useActiveOrganization"],
	["fullOrganization", "get", "getFullOrganization", "organization.getFullOrganization"],
	["slugAvailable", "get", "checkOrganizationSlug", "organization.checkSlug"],
	["invitation", "get", "getInvitation", "organization.getInvitation"],
	["invitations", "get", "listInvitations", "organization.listInvitations"],
	["userInvitations", "get", "listUserInvitations", "organization.listUserInvitations"],
	["members", "get", "listMembers", "organization.listMembers"],
	["activeMember", "get", "getActiveMember", "organization.getActiveMember"],
	["activeMemberRole", "get", "getActiveMemberRole", "organization.getActiveMemberRole"],
	["orgPermission", "get", "hasPermission", "organization.hasPermission"],
	["rolePermission", "get", null, "organization.checkRolePermission"],
	["teams", "get", "listOrganizationTeams", "organization.listTeams"],
	["userTeams", "get", "listUserTeams", "organization.listUserTeams"],
	["teamMembers", "get", "listTeamMembers", "organization.listTeamMembers"],
	["createOrganization", "do", "createOrganization", "organization.create"],
	["updateOrganization", "do", "updateOrganization", "organization.update"],
	["deleteOrganization", "do", "deleteOrganization", "organization.delete"],
	["setActiveOrganization", "do", "setActiveOrganization", "organization.setActive"],
	["inviteMember", "do", "createInvitation", "organization.inviteMember"],
	["acceptInvitation", "do", "acceptInvitation", "organization.acceptInvitation"],
	["cancelInvitation", "do", "cancelInvitation", "organization.cancelInvitation"],
	["rejectInvitation", "do", "rejectInvitation", "organization.rejectInvitation"],
	["addMember", "do", "addMember", null],
	["removeMember", "do", "removeMember", "organization.removeMember"],
	["updateMemberRole", "do", "updateMemberRole", "organization.updateMemberRole"],
	["leaveOrganization", "do", "leaveOrganization", "organization.leave"],
	["createTeam", "do", "createTeam", "organization.createTeam"],
	["updateTeam", "do", "updateTeam", "organization.updateTeam"],
	["removeTeam", "do", "removeTeam", "organization.removeTeam"],
	["setActiveTeam", "do", "setActiveTeam", "organization.setActiveTeam"],
	["addTeamMember", "do", "addTeamMember", "organization.addTeamMember"],
	["removeTeamMember", "do", "removeTeamMember", "organization.removeTeamMember"],
	["createRole", "do", null, "organization.createRole"],
	["updateRole", "do", null, "organization.updateRole"],
	["deleteRole", "do", null, "organization.deleteRole"],
	["totpUri", "get", "getTOTPURI", "twoFactor.getTotpUri"],
	["backupCodes", "get", "viewBackupCodes", null],
	["enableTwoFactor", "do", "enableTwoFactor", "twoFactor.enable"],
	["disableTwoFactor", "do", "disableTwoFactor", "twoFactor.disable"],
	["verifyTotp", "do", "verifyTOTP", "twoFactor.verifyTotp"],
	["sendOtp", "do", "sendTwoFactorOTP", "twoFactor.sendOtp"],
	["verifyOtp", "do", "verifyTwoFactorOTP", "twoFactor.verifyOtp"],
	["generateBackupCodes", "do", "generateBackupCodes", "twoFactor.generateBackupCodes"],
	["verifyBackupCode", "do", "verifyBackupCode", "twoFactor.verifyBackupCode"],
	["users", "get", "listUsers", "admin.listUsers"],
	["user", "get", "getUser", "admin.getUser"],
	["userSessions", "get", "listUserSessions", "admin.listUserSessions"],
	["userPermission", "get", "userHasPermission", "admin.hasPermission"],
	["rolePermission", "get", null, "admin.checkRolePermission"],
	["createUser", "do", "createUser", "admin.createUser"],
	["setRole", "do", "setRole", "admin.setRole"],
	["setUserPassword", "do", "setUserPassword", "admin.setUserPassword"],
	["adminUpdateUser", "do", "adminUpdateUser", "admin.updateUser"],
	["banUser", "do", "banUser", "admin.banUser"],
	["unbanUser", "do", "unbanUser", "admin.unbanUser"],
	["revokeUserSession", "do", "revokeUserSession", "admin.revokeUserSession"],
	["revokeUserSessions", "do", "revokeUserSessions", "admin.revokeUserSessions"],
	["impersonateUser", "do", "impersonateUser", "admin.impersonateUser"],
	["stopImpersonating", "do", "stopImpersonating", "admin.stopImpersonating"],
	["removeUser", "do", "removeUser", "admin.removeUser"],
	["passkeys", "get", "listPasskeys", "passkey.listUserPasskeys"],
	["addPasskey", "do", null, "passkey.addPasskey"],
	["signInPasskey", "do", null, "signIn.passkey"],
	["deletePasskey", "do", "deletePasskey", "passkey.deletePasskey"],
	["updatePasskey", "do", "updatePasskey", "passkey.updatePasskey"],
	["signInMagicLink", "do", "signInMagicLink", "signIn.magicLink"],
	["verifyMagicLink", "do", "magicLinkVerify", "magicLink.verify"],
	["signInUsername", "do", "signInUsername", "signIn.username"],
	["signInAnonymous", "do", "signInAnonymous", "signIn.anonymous"],
	["signInEmailOtp", "do", "signInEmailOTP", "signIn.emailOtp"],
	["sendVerificationOtp", "do", "sendVerificationOTP", "emailOtp.sendVerificationOtp"],
];

/** Client calls that still read as Better Auth when the client was destructured (`signIn.email()`, `useSession()`). */
const BARE_CLIENT = new Set(["signIn", "signUp", "useSession", "signOut"]);

const rootName = (n: N): string | null => {
	let u = unwrap(n);
	while (u?.type === "MemberExpression") u = unwrap(u.object);
	return u?.type === "Identifier" ? u.name : null;
};

/** Receivers that look like a Better Auth instance or client (`auth`, `authClient`, `client`). */
const looksLikeAuth = (n: N) => {
	const name = rootName(n);
	return !!name && (/auth/i.test(name) || name === "client");
};

const nested =
	(specs: () => Specs, key: string): Spec =>
	({ e, say, node }) =>
		objectArg(node) ? optionDocs({ e, say, node, specs: specs() }) : plainOption({ e, say, name: e.prop(key), node });

/** Request fields shared by every endpoint: `headers`, `callbackURL`, fetch callbacks, nested `body`/`query`. */
export const fieldSpecs: Specs = {
	headers: value((s) => s.api.fields.headers),
	callbackURL: value((s) => s.api.fields.callbackURL),
	newUserCallbackURL: value((s) => s.api.fields.newUserCallbackURL),
	errorCallbackURL: value((s) => s.api.fields.errorCallbackURL),
	rememberMe: flag((s) => s.api.fields.rememberMe),
	asResponse: flag((s) => s.api.fields.asResponse),
	returnHeaders: flag((s) => s.api.fields.returnHeaders),
	disableRedirect: flag((s) => s.api.fields.disableRedirect),
	onSuccess: callback((s) => s.api.fields.onSuccess, { withGiven: false }),
	onError: callback((s) => s.api.fields.onError, { withGiven: false }),
	onRequest: callback((s) => s.api.fields.onRequest, { withGiven: false }),
	onResponse: callback((s) => s.api.fields.onResponse, { withGiven: false }),
	body: nested(() => fieldSpecs, "body"),
	query: nested(() => fieldSpecs, "query"),
	fetchOptions: nested(() => fieldSpecs, "fetchOptions"),
};

const providerSpecs: Specs = { ...fieldSpecs, provider: () => [], body: nested(() => providerSpecs, "body") };

/** `{ provider: "github" }` (or `{ body: { provider } }`) -> "GitHub". */
function providerName({ e, say, args }: Ctx & { args: N[] }): string {
	const first = objectArg(args[0]);
	const prop = findProp(first, "provider") ?? findProp(objectArg(findProp(first, "body")?.value), "provider");
	if (!prop) return say.api.someProvider;
	const lit = literal(prop.value);
	return (typeof lit === "string" && say.providers[lit]) || e.text(prop.value);
}

type Key = Entry[0];
type Kind = Entry[1];

function headline({ e, say, key, kind, args }: Ctx & { key: Key; kind: Kind; args: N[] }): string {
	if (key === "signInSocial" || key === "linkSocial") return say.api[key]({ provider: providerName({ e, say, args }) });
	return kind === "get" ? say.api.get[key as GetEndpoint] : say.api.do[key as DoEndpoint];
}

function endpointDoc({ e, say, key, kind, args, stmt }: Ctx & { key: Key; kind: Kind; args: N[]; stmt: boolean }): Doc {
	const specs = key === "signInSocial" || key === "linkSocial" ? providerSpecs : fieldSpecs;
	const details = args.flatMap((a) => (objectArg(a) ? optionDocs({ e, say, node: a, specs }) : [e.noun(a)]));
	const g = group({ e, say, title: headline({ e, say, key, kind, args }), items: details });
	if (kind === "get") return stmt ? D(say.api.lookUp({ thing: g.t }), g.kids) : g;
	return stmt ? g : D(say.api.resultOf({ action: g.t }), g.kids);
}

const endpointRule =
	(key: Key, kind: Kind, accepts: (obj: N | null) => boolean): CallRule<P> =>
	({ e, say, args, obj, stmt }) =>
		accepts(obj) ? endpointDoc({ e, say, key, kind, args, stmt }) : null;

const always = () => true;
const onClientRoot = (obj: N | null) => unwrap(obj)?.type === "Identifier" && looksLikeAuth(obj);

/** Call rules for every known endpoint: `auth.api.signInEmail`, `authClient.signIn.email`, `authClient.organization.create`, … */
export function endpointCalls(): Record<string, CallRule<P>> {
	const calls: Record<string, CallRule<P>> = {};
	for (const [key, kind, server, client] of ENDPOINTS) {
		if (server) calls[`*.api.${server}`] = endpointRule(key, kind, looksLikeAuth);
		if (!client) continue;
		const [ns, method] = client.includes(".") ? client.split(".") : [null, client];
		if (ns) calls[`*.${ns}.${method}`] = endpointRule(key, kind, looksLikeAuth);
		else calls[`*.${method}`] = endpointRule(key, kind, onClientRoot);
		if (BARE_CLIENT.has(ns ?? method!)) calls[ns ? `${ns}.${method}` : method!] = endpointRule(key, kind, always);
	}
	return calls;
}
