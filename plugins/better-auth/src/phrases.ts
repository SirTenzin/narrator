/** Rendered markup in, phrase out. Every argument is already-rendered text unless typed otherwise. */
type Value = (p: { value: string }) => string;
type Items = (p: { items: string }) => string;
type Flag = (p: { neg: boolean }) => string;
/** `n` is the plain number when the count is a constant, for plural agreement. */
type Count = (p: { count: string; n: number | null }) => string;
type Duration = (p: { duration: string }) => string;
type Unit = (p: { count: string; n: number }) => string;

export type GetEndpoint =
	| "accessToken"
	| "accountInfo"
	| "accounts"
	| "activeMember"
	| "activeMemberRole"
	| "activeOrganization"
	| "backupCodes"
	| "fullOrganization"
	| "invitation"
	| "invitations"
	| "liveOrganizations"
	| "liveSession"
	| "members"
	| "orgPermission"
	| "organizations"
	| "passkeys"
	| "rolePermission"
	| "session"
	| "sessions"
	| "slugAvailable"
	| "teamMembers"
	| "teams"
	| "totpUri"
	| "user"
	| "userInvitations"
	| "userPermission"
	| "userSessions"
	| "userTeams"
	| "users";
export type DoEndpoint =
	| "acceptInvitation"
	| "addMember"
	| "addPasskey"
	| "addTeamMember"
	| "adminUpdateUser"
	| "banUser"
	| "cancelInvitation"
	| "changeEmail"
	| "changePassword"
	| "createOrganization"
	| "createRole"
	| "createTeam"
	| "createUser"
	| "deleteOrganization"
	| "deletePasskey"
	| "deleteRole"
	| "deleteUser"
	| "disableTwoFactor"
	| "enableTwoFactor"
	| "generateBackupCodes"
	| "impersonateUser"
	| "inviteMember"
	| "leaveOrganization"
	| "refreshToken"
	| "rejectInvitation"
	| "removeMember"
	| "removeTeam"
	| "removeTeamMember"
	| "removeUser"
	| "requestPasswordReset"
	| "resetPassword"
	| "revokeOtherSessions"
	| "revokeSession"
	| "revokeSessions"
	| "revokeUserSession"
	| "revokeUserSessions"
	| "sendOtp"
	| "sendVerificationEmail"
	| "sendVerificationOtp"
	| "setActiveOrganization"
	| "setActiveTeam"
	| "setRole"
	| "setUserPassword"
	| "signInAnonymous"
	| "signInEmail"
	| "signInEmailOtp"
	| "signInMagicLink"
	| "signInPasskey"
	| "signInUsername"
	| "signOut"
	| "signUpEmail"
	| "stopImpersonating"
	| "unbanUser"
	| "unlinkAccount"
	| "updateMemberRole"
	| "updateOrganization"
	| "updatePasskey"
	| "updateRole"
	| "updateSession"
	| "updateTeam"
	| "updateUser"
	| "verifyBackupCode"
	| "verifyEmail"
	| "verifyMagicLink"
	| "verifyOtp"
	| "verifyTotp";

/** Callback phrases are intros ("to send a password-reset email") that the function body hangs off. */
export type BetterAuthPhrases = {
	setup: {
		server: string;
		serverAs: (p: { name: string }) => string;
		serverDefault: string;
		serverDefaultAs: (p: { name: string }) => string;
		client: string;
		clientAs: (p: { name: string }) => string;
		clientDefault: string;
		clientDefaultAs: (p: { name: string }) => string;
	};
	frame: {
		option: (p: { name: string; value: string }) => string;
		withDetails: (p: { thing: string; details: string }) => string;
		details: (p: { items: string[] }) => string;
		onlyIf: (p: { thing: string; cond: string }) => string;
		turnedOff: (p: { thing: string }) => string;
		given: (p: { intro: string; given: string }) => string;
		callBy: (p: { intro: string; fn: string }) => string;
		everythingIn: Value;
		tableName: Value;
		extraFields: Items;
		columnNames: Value;
	};
	units: { second: Unit; minute: Unit; hour: Unit; day: Unit };
	durationInSeconds: Value;
	providers: Record<string, string>;
	databases: Record<string, string>;
	adapter: (p: { orm: string; db: string; provider: string }) => string;
	adapterNoProvider: (p: { orm: string; db: string }) => string;
	orms: { drizzle: string; prisma: string; mongodb: string; kysely: string };
	config: {
		appName: Value;
		baseURL: Value;
		basePath: Value;
		secret: Value;
		database: Value;
		secondaryStorage: Value;
		trustedOrigins: Items;
		trustedOriginsFn: string;
		disabledPaths: Items;
		plugins: string;
		emailAndPassword: {
			title: string;
			requireEmailVerification: Flag;
			minPasswordLength: Count;
			maxPasswordLength: Count;
			autoSignIn: Flag;
			disableSignUp: Flag;
			sendResetPassword: string;
			onPasswordReset: string;
			resetPasswordTokenExpiresIn: Duration;
			revokeSessionsOnPasswordReset: Flag;
			password: string;
			hash: string;
			verify: string;
		};
		emailVerification: {
			title: string;
			sendVerificationEmail: string;
			sendOnSignUp: Flag;
			sendOnSignIn: Flag;
			autoSignInAfterVerification: Flag;
			expiresIn: Duration;
			afterEmailVerification: string;
		};
		socialProvider: (p: { provider: string }) => string;
		social: {
			clientId: Value;
			clientSecret: Value;
			redirectURI: Value;
			scope: Items;
			prompt: Record<string, string>;
			disableSignUp: Flag;
			disableImplicitSignUp: Flag;
			overrideUserInfoOnSignIn: Flag;
			mapProfileToUser: string;
			getUserInfo: string;
			tenantId: Value;
		};
		session: {
			title: string;
			expiresIn: Duration;
			updateAge: Duration;
			freshAge: Duration;
			disableSessionRefresh: Flag;
			storeSessionInDatabase: Flag;
			cookieCache: string;
			maxAge: Duration;
			strategy: Value;
		};
		account: {
			title: string;
			accountLinking: string;
			trustedProviders: Items;
			allowDifferentEmails: Flag;
			disableImplicitLinking: Flag;
			encryptOAuthTokens: Flag;
			updateAccountOnSignIn: Flag;
		};
		user: {
			title: string;
			changeEmail: string;
			sendChangeEmailVerification: string;
			sendChangeEmailConfirmation: string;
			updateEmailWithoutVerification: Flag;
			deleteUser: string;
			sendDeleteAccountVerification: string;
			beforeDelete: string;
			afterDelete: string;
		};
		rateLimit: { title: string; window: Duration; max: Count; storage: Value; customRules: string };
		advanced: {
			title: string;
			cookiePrefix: Value;
			useSecureCookies: Flag;
			disableCSRFCheck: Flag;
			disableOriginCheck: Flag;
			crossSubDomainCookies: string;
			domain: Value;
			ipAddress: string;
			ipAddressHeaders: Items;
			disableIpTracking: Flag;
			database: string;
			generateId: Record<"uuid" | "serial" | "off", string>;
			generateIdFn: string;
			defaultFindManyLimit: Count;
			backgroundTasks: string;
			backgroundHandler: Value;
		};
		hooks: { title: string; before: string; after: string };
		databaseHooks: string;
		verification: string;
		dbHook: Record<"before" | "after", Record<"create" | "update" | "delete", (p: { model: string }) => string>>;
		models: Record<string, string>;
		onAPIError: { title: string; throw: Flag; onError: string; errorURL: Value };
		telemetry: string;
	};
	plugins: {
		features: Record<string, string>;
		twoFactor: {
			issuer: Value;
			skipVerificationOnEnable: Flag;
			otpOptions: string;
			sendOTP: string;
			period: Duration;
			backupCodeOptions: string;
			amount: Count;
		};
		organization: {
			allowUserToCreateOrganization: Flag;
			allowUserToCreateOrganizationFn: string;
			organizationLimit: Count;
			membershipLimit: Count;
			creatorRole: Value;
			invitationExpiresIn: Duration;
			sendInvitationEmail: string;
			teams: string;
			maximumTeams: Count;
			organizationHooks: string;
		};
		admin: {
			defaultRole: Value;
			adminRoles: Items;
			adminUserIds: Items;
			impersonationSessionDuration: Duration;
			defaultBanReason: Value;
			defaultBanExpiresIn: Duration;
		};
		passkey: { rpID: Value; rpName: Value; origin: Value };
		magicLink: { sendMagicLink: string; expiresIn: Duration; disableSignUp: Flag };
		emailOTP: { sendVerificationOTP: string; otpLength: Count; expiresIn: Duration };
		username: { minUsernameLength: Count; maxUsernameLength: Count };
		twoFactorClient: { onTwoFactorRedirect: string };
		customSession: string;
	};
	client: { baseURL: Value; basePath: Value; plugins: string; fetchOptions: string };
	api: {
		lookUp: (p: { thing: string }) => string;
		resultOf: (p: { action: string }) => string;
		/** Read-only endpoints are noun phrases; actions are verb phrases. */
		get: Record<GetEndpoint, string>;
		do: Record<DoEndpoint, string>;
		someProvider: string;
		signInSocial: (p: { provider: string }) => string;
		linkSocial: (p: { provider: string }) => string;
		fields: {
			headers: Value;
			callbackURL: Value;
			newUserCallbackURL: Value;
			errorCallbackURL: Value;
			rememberMe: Flag;
			asResponse: Flag;
			returnHeaders: Flag;
			disableRedirect: Flag;
			onSuccess: string;
			onError: string;
			onRequest: string;
			onResponse: string;
		};
	};
	mount: {
		nextHandlers: (p: { auth: string }) => string;
		routeMethods: (p: { auth: string; methods: string }) => string;
		nodeHandler: (p: { auth: string }) => string;
		solidStartHandler: (p: { auth: string }) => string;
		svelteKitHandler: (p: { auth: string }) => string;
		route: (p: { path: string; auth: string }) => string;
		routeAll: (p: { auth: string }) => string;
		handle: (p: { auth: string; request: string }) => string;
		requestHeaders: string;
	};
	helpers: {
		middleware: string;
		endpoint: (p: { path: string; method: string; signedIn: boolean }) => string;
		sessionFromContext: string;
		sessionCookie: (p: { request: string }) => string;
		cookieCache: (p: { request: string }) => string;
	};
	errors: {
		statuses: Record<string, string>;
		apiError: (p: { error: string; message: string }) => string;
		unknownStatus: Value;
		isApiError: (p: { value: string; neg: boolean }) => string;
	};
};
