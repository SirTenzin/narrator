import { describe, expect, test } from "bun:test";
import { createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en as english } from "@usenarrator/locale-en";
import { narrate, phrasebookGaps } from "@usenarrator/testkit";
import { type BetterAuthPhrases, betterAuth, en } from "../src";

const plugins = [betterAuth()];

/** Narrates `code` as a file of a package with these dependencies (snippets below live in a Better Auth app). */
const narrateIn = (code: string, dependencies: Record<string, string> = { "better-auth": "^1.6.0" }) => {
	const narrator = createNarrator({ languages: [typescript({ parser: oxcParser, plugins, dependencies: () => dependencies })], locale: english });
	const { lines, stats } = narrator.narrate(code, "snippet.ts");
	return { text: renderText(lines), fallbacks: stats.fallbacks };
};
const read = (code: string) => narrateIn(code).text;

/** Narrates and asserts nothing fell back to raw code. */
const readClean = (code: string) => {
	const { text, fallbacks } = narrateIn(code);
	expect(fallbacks).toBe(0);
	return text;
};

describe("server config", () => {
	test("a full config reads as a bulleted setup", () => {
		const text = readClean(`
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor, organization, admin, magicLink } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

export const auth = betterAuth({
	appName: "Acme",
	database: drizzleAdapter(db, { provider: "pg" }),
	emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 10 },
	socialProviders: {
		github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },
	},
	session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
	plugins: [twoFactor(), organization(), admin(), passkey(), magicLink({ sendMagicLink: async ({ email, url }) => { await sendEmail({ to: email, url }); } })],
	trustedOrigins: ["http://localhost:3000", "https://app.acme.com"],
});`);
		expect(text).toBe(`Set up authentication as auth, with:
  • the app is called "Acme"
  • stores its data in DB through Drizzle (PostgreSQL)
  • email and password sign-in:
    • users must verify their email before signing in
    • passwords need at least 10 characters
  • sign-in with GitHub:
    • client ID: the GITHUB_CLIENT_ID environment variable
    • client secret: the GITHUB_CLIENT_SECRET environment variable
  • sessions:
    • sessions expire after 7 days
    • a session in use is extended once it's 1 day old
  • plugins:
    • two-factor authentication
    • organizations
    • admin tools
    • passkey sign-in
    • magic-link sign-in:
      • to send a magic link (given email and URL):
        Send email (to: email and URL).
  • accepts requests from "http://localhost:3000" and "https://app.acme.com"`);
	});

	test("session durations in seconds read as human durations", () => {
		const text = readClean(
			`const auth = betterAuth({ session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 3600, freshAge: 300, cookieCache: { enabled: true, maxAge: 90 } } });`,
		);
		expect(text).toContain("sessions expire after 30 days");
		expect(text).toContain("a session in use is extended once it's 1 hour old");
		expect(text).toContain("sensitive actions need a session from the last 5 minutes");
		expect(text).toContain("session data cached in a signed cookie (for 90 seconds)");
	});

	test("a duration held in a constant still says its unit", () => {
		expect(readClean(`const auth = betterAuth({ session: { expiresIn: SESSION_TTL } });`)).toContain("sessions expire after session TTL seconds");
	});

	test("enabled: false reads as turned off and conditional enabling says when", () => {
		const text = readClean(`const auth = betterAuth({ emailAndPassword: { enabled: false }, rateLimit: { enabled: isProd, window: 60, max: 100 } });`);
		expect(text).toContain("• email and password sign-in turned off");
		expect(text).toContain("rate limiting, but only if it is prod (counted over 1 minute; at most 100 requests per window)");
	});

	test("boolean options read both ways", () => {
		const text = readClean(
			`const auth = betterAuth({ emailAndPassword: { enabled: true, autoSignIn: false, disableSignUp: true }, advanced: { useSecureCookies: true, disableCSRFCheck: true } });`,
		);
		expect(text).toContain("users must sign in themselves after signing up");
		expect(text).toContain("new users can't sign up this way");
		expect(text).toContain("cookies are always marked secure");
		expect(text).toContain("CSRF protection is turned off (risky)");
	});

	test("social providers get brand names and prompt meanings", () => {
		const text = readClean(
			`const auth = betterAuth({ socialProviders: { google: { clientId: id, clientSecret: secret, prompt: "select_account", scope: ["email", "profile"] }, myIdp: { clientId: x } } });`,
		);
		expect(text).toContain("• sign-in with Google:");
		expect(text).toContain("always asks which account to use");
		expect(text).toContain(`also asks for "email" and "profile"`);
		expect(text).toContain("• sign-in with my idp (client ID: x)");
	});

	test("callbacks show what they do and what they're given", () => {
		const text = readClean(`const auth = betterAuth({
	emailAndPassword: { enabled: true, sendResetPassword: async ({ user, url }) => { await sendEmail({ to: user.email, subject: "Reset", text: url }); } },
	emailVerification: { sendVerificationEmail: sendVerification, sendOnSignUp: true, expiresIn: 3600 },
});`);
		expect(text).toContain("to send a password-reset email (given user and URL):");
		expect(text).toContain("to send a verification email, call send verification");
		expect(text).toContain("a verification email goes out on sign-up");
		expect(text).toContain("verification links expire after 1 hour");
	});

	test("request hooks narrate their body", () => {
		const text = readClean(`const auth = betterAuth({
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (!ctx.body?.email.endsWith("@example.com")) {
				throw new APIError("BAD_REQUEST", { message: "Email must end with @example.com" });
			}
		}),
		after: createAuthMiddleware(async (ctx) => { await track(ctx.path); }),
	},
});`);
		expect(text).toContain("• request hooks:");
		expect(text).toContain("• before each auth request:");
		expect(text).toContain(`fail with a bad-request error: "Email must end with @example.com"`);
		expect(text).toContain("• after each auth request:");
	});

	test("database hooks name the model and the moment", () => {
		const text = readClean(`const auth = betterAuth({
	databaseHooks: {
		user: { create: { before: async (user) => ({ data: { ...user, plan: "free" } }), after: async (user) => { await createStripeCustomer(user); } } },
		session: { delete: { before: async (session) => session.userId !== adminId } },
	},
});`);
		expect(text).toContain("• database hooks:");
		expect(text).toContain("• before a user is created (given user):");
		expect(text).toContain("• after a user is created (given user):");
		expect(text).toContain("Create stripe customer (user).");
		expect(text).toContain("• before a session is deleted (given session):");
		expect(text).toContain("Give back whether session's user ID is not admin ID.");
	});

	test("advanced settings explain ID generation and cookie sharing", () => {
		const text = readClean(
			`const auth = betterAuth({ advanced: { cookiePrefix: "acme", crossSubDomainCookies: { enabled: true, domain: ".acme.com" }, database: { generateId: "uuid" } } });`,
		);
		expect(text).toContain(`cookie names start with "acme"`);
		expect(text).toContain(`cookies shared across subdomains (of ".acme.com")`);
		expect(text).toContain("database settings (IDs are random UUIDs)");
	});

	test("plugin options read in plain words", () => {
		const text = readClean(`const auth = betterAuth({ plugins: [
	twoFactor({ issuer: "Acme" }),
	organization({ allowUserToCreateOrganization: async (user) => user.plan === "pro", membershipLimit: 50, invitationExpiresIn: 60 * 60 * 48 }),
	admin({ defaultRole: "user", adminRoles: ["admin", "owner"], impersonationSessionDuration: 60 * 60 }),
	nextCookies(),
] });`);
		expect(text).toContain(`two-factor authentication (authenticator apps show it as "Acme")`);
		expect(text).toContain("to decide who can create an organization (given user):");
		expect(text).toContain(`Give back whether user's plan is "pro".`);
		expect(text).toContain("at most 50 members per organization");
		expect(text).toContain("invitations expire after 2 days");
		expect(text).toContain(`admin roles: "admin" and "owner"`);
		expect(text).toContain("impersonating someone lasts 1 hour");
		expect(text).toContain("auth cookies from Next.js server actions");
	});

	test("no options means the defaults", () => {
		expect(readClean(`export const auth = betterAuth({});`)).toBe("Set up authentication as auth, with the default settings.");
	});

	test("unknown options still read generically", () => {
		expect(readClean(`const auth = betterAuth({ experimental: { joins: true } });`)).toContain("experimental: an object with joins: true");
	});
});

describe("auth.api on the server", () => {
	test("getSession reads as the current session from the headers", () => {
		const text = readClean(`
export async function getUser(req: Request) {
	const session = await auth.api.getSession({ headers: req.headers });
	if (!session) return null;
	return session.user;
}`);
		expect(text).toContain("Let session be the current session (from request's headers).");
	});

	test("Next.js headers() reads as the incoming request's headers", () => {
		expect(readClean(`const session = await auth.api.getSession({ headers: await headers() });`)).toBe(
			"Let session be the current session (from the incoming request's headers).",
		);
	});

	test("actions read as verbs and their body fields are listed", () => {
		const text = readClean(`
await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
await auth.api.signOut({ headers: await headers() });
await auth.api.banUser({ body: { userId: user.id, banReason: "spam" } });`);
		expect(text).toBe(`Sign in with email and password (email; password; from the incoming request's headers).
Sign the user out (from the incoming request's headers).
Ban a user (user ID: user's ID; ban reason: "spam").`);
	});

	test("a stored result reads as what Better Auth gave back", () => {
		const text = readClean(
			`const { headers, response } = await auth.api.signUpEmail({ returnHeaders: true, body: { email: "a@b.com", password: "pw", name: "A" } });`,
		);
		expect(text).toContain("From the result of asking Better Auth to sign up with email and password, take headers and response:");
		expect(text).toContain("also giving back the response headers");
		expect(text).toContain(`• email: "a@b.com"`);
	});

	test("lookups at statement level say look up", () => {
		expect(readClean(`await auth.api.listSessions({ headers });`)).toBe("Look up the user's active sessions (from headers).");
	});

	test("organization and admin endpoints", () => {
		const text = readClean(`
await auth.api.createOrganization({ body: { name: "Acme", slug: "acme" }, headers });
const members = await auth.api.listMembers({ query: { organizationId } });
await auth.api.setRole({ body: { userId, role: "admin" } });`);
		expect(text).toContain(`Create an organization (name: "Acme"; slug: "acme"; from headers).`);
		expect(text).toContain("Let members be the organization's members (organization ID).");
		expect(text).toContain(`Change a user's role (user ID; role: "admin").`);
	});

	test("isAPIError and APIError read in plain words", () => {
		const text = readClean(`
try {
	await auth.api.signInEmail({ body: { email, password } });
} catch (err) {
	if (isAPIError(err)) throw new APIError("UNAUTHORIZED", { message: "Wrong password" });
	if (!isAPIError(err)) throw new APIError("I_AM_A_TEAPOT");
}`);
		expect(text).toContain(`If error is a Better Auth API error, fail with an unauthorized error: "Wrong password".`);
		expect(text).toContain(`If error is not a Better Auth API error, fail with an error with status "I_AM_A_TEAPOT".`);
	});

	test("other api objects are left alone", () => {
		expect(read(`await stripe.api.signOut();`)).not.toContain("Sign the user out");
	});
});

describe("mounting", () => {
	test("Next.js route handlers", () => {
		expect(readClean(`export const { GET, POST } = toNextJsHandler(auth);`)).toBe("Answer GET and POST requests on this route with auth.");
		expect(readClean(`const handlers = toNextJsHandler(auth.handler);`)).toBe("Let handlers be Next.js route handlers for auth's handler.");
	});

	test("Express and Node", () => {
		expect(readClean(`app.all("/api/auth/*", toNodeHandler(auth));`)).toBe(`Send every request under "/api/auth/*" to auth.`);
		expect(readClean(`app.use(toNodeHandler(auth));`)).toBe("Send every request to auth.");
		expect(read(`app.use(express.json());`)).not.toContain("Send every request");
	});

	test("fromNodeHeaders is transparent", () => {
		expect(readClean(`const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });`)).toBe(
			"Let session be the current session (from request's headers).",
		);
	});

	test("auth.handler and framework helpers", () => {
		expect(readClean(`export const handler = (req: Request) => auth.handler(req);`)).toContain("Give back the response from auth to request.");
		expect(readClean(`export const { GET, POST } = toSolidStartHandler(auth);`)).toBe("Answer GET and POST requests on this route with auth.");
		expect(readClean(`const response = svelteKitHandler({ event, resolve, auth });`)).toBe(
			"Let response be the SvelteKit hook that lets auth answer its own routes.",
		);
	});
});

describe("the client", () => {
	test("createAuthClient reads as a client setup", () => {
		const text = readClean(`
export const authClient = createAuthClient({
	baseURL: "http://localhost:3000",
	plugins: [organizationClient(), twoFactorClient({ onTwoFactorRedirect() { window.location.href = "/2fa"; } }), inferAdditionalFields<typeof auth>()],
});`);
		expect(text).toBe(`Set up the auth client as auth client, with:
  • talks to the auth server at "http://localhost:3000"
  • client plugins:
    • organizations
    • two-factor authentication:
      • when sign-in needs a second factor:
        Set window's location's href to "/2fa".
    • the server's extra user fields`);
		expect(readClean(`export const { signIn, signUp, useSession } = createAuthClient();`)).toBe(
			"From an auth client with the default settings, take sign in, sign up, and use session.",
		);
	});

	test("sign-in calls with fetch callbacks", () => {
		const text = readClean(`
const { data, error } = await authClient.signIn.email({ email, password, callbackURL: "/dashboard", rememberMe: false }, {
	onSuccess: () => router.push("/dashboard"),
	onError: (ctx) => { toast.error(ctx.error.message); },
});`);
		expect(text).toContain("From the result of asking Better Auth to sign in with email and password, take data and error:");
		expect(text).toContain(`• then go to "/dashboard"`);
		expect(text).toContain("• forgotten when the browser closes");
		expect(text).toContain("• when it succeeds:");
		expect(text).toContain("• if it fails:");
	});

	test("social sign-in names the provider", () => {
		expect(readClean(`await authClient.signIn.social({ provider: "github", callbackURL: "/dashboard" });`)).toBe(
			`Sign in with GitHub (then go to "/dashboard").`,
		);
		expect(readClean(`await authClient.signIn.social({ provider });`)).toBe("Sign in with provider.");
		expect(readClean(`await authClient.linkSocial({ provider: "google" });`)).toBe("Link a Google account.");
	});

	test("session helpers", () => {
		expect(readClean(`const { data: session, isPending } = authClient.useSession();`)).toBe(
			"From the current session (kept up to date), take data (as session) and is pending.",
		);
		expect(readClean(`const { data } = await authClient.getSession();`)).toBe("From the current session, take data.");
		expect(readClean(`await authClient.signOut();`)).toBe("Sign the user out.");
		expect(readClean(`await signIn.email({ email, password });`)).toBe("Sign in with email and password (email; password).");
	});

	test("organization, two-factor, passkey and magic-link calls", () => {
		const text = readClean(`
await authClient.organization.create({ name: "Acme", slug: "acme" });
await authClient.organization.inviteMember({ email: "a@b.com", role: "member" });
await authClient.organization.setActive({ organizationId: org.id });
const { data: orgs } = authClient.useListOrganizations();
await authClient.twoFactor.enable({ password });
await authClient.twoFactor.verifyTotp({ code });
await authClient.passkey.addPasskey();
await authClient.signIn.magicLink({ email, callbackURL: "/welcome" });`);
		expect(text).toBe(`Create an organization (name: "Acme"; slug: "acme").
Invite someone to the organization (email: "a@b.com"; role: "member").
Switch the active organization (organization ID: org's ID).
From the user's organizations (kept up to date), take data (as orgs).
Turn on two-factor authentication (password).
Check an authenticator-app code (code).
Register a new passkey.
Email the user a sign-in link (email; then go to "/welcome").`);
	});

	test("ORM calls with the same method names are left alone", () => {
		expect(read(`await prisma.organization.create({ data: { name } });`)).not.toContain("Create an organization");
	});
});

describe("plugin helpers", () => {
	test("createAuthEndpoint and createAuthMiddleware", () => {
		const text = readClean(`
export const myPlugin = () => ({
	id: "my-plugin",
	endpoints: {
		hello: createAuthEndpoint("/my-plugin/hello", { method: "GET", use: [sessionMiddleware] }, async (ctx) => {
			return ctx.json({ message: "hi" });
		}),
	},
});
const logPaths = createAuthMiddleware(async (ctx) => { await log(ctx.path); });`);
		expect(text).toContain(`an auth endpoint for GET "/my-plugin/hello" (signed-in users only) that:`);
		expect(text).toContain("Let log paths be an auth middleware that:");
	});

	test("customSession and session cookies", () => {
		const text = readClean(`
const auth = betterAuth({ plugins: [customSession(async ({ user, session }) => ({ user, session, roles: await getRoles(user.id) }))] });
const cookie = getSessionCookie(request);
const session = await getSessionFromCtx(ctx);`);
		expect(text).toContain("a custom session response, built like this (given user and session):");
		expect(text).toContain("Let cookie be the session cookie on request.");
		expect(text).toContain("Let session be the signed-in session for this request.");
	});
});

describe("phrasebook", () => {
	test("rules take every word from the phrasebook", () => {
		const shouted: BetterAuthPhrases = {
			...en,
			setup: { ...en.setup, serverAs: ({ name }) => `CONFIGURAR LA AUTENTICACIÓN COMO ${name}, CON` },
			api: { ...en.api, do: { ...en.api.do, signOut: "CERRAR SESIÓN" } },
		};
		const text = narrate(`import { betterAuth } from "better-auth";\nexport const auth = betterAuth({ appName: "Acme" });\nawait auth.api.signOut();`, {
			plugins,
			locale: { ...english, plugins: { "better-auth": shouted } },
		});
		expect(text).toContain("CONFIGURAR LA AUTENTICACIÓN COMO auth, CON:");
		expect(text).toContain("CERRAR SESIÓN.");
	});

	test("a complete translation has no gaps", () => {
		expect(phrasebookGaps(en, { ...en })).toEqual({ missing: [], extra: [] });
	});
});

describe("activation", () => {
	test("bare plugin and setup names are Better Auth's only when imported from it or the package depends on it", () => {
		const code = 'const plugins = [organization(), admin()];\nconst auth = betterAuth({ appName: "Acme" });';
		expect(narrateIn(code, {}).text).toBe(narrate(code));
		expect(narrateIn(code).text).not.toBe(narrate(code));
		const imported = 'import { organization } from "better-auth/plugins";\nconst plugins = [organization()];';
		expect(narrateIn(imported, {}).text).toBe(narrateIn(imported).text);
	});

	test("a same-named function from another library is left alone", () => {
		const code = 'import { jwt } from "@elysiajs/jwt";\nimport { stripe } from "./billing";\nconst a = jwt({ secret });\nconst b = stripe(key);';
		expect(narrateIn(code).text).toBe(narrate(code));
	});
});
