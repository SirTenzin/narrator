/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;
type Unit = (p: { count: string; n: number }) => string;

/** App Router and Pages Router special files the plugin titles. */
export type FileKind =
	| "page"
	| "layout"
	| "rootLayout"
	| "template"
	| "loading"
	| "error"
	| "globalError"
	| "notFound"
	| "default"
	| "forbidden"
	| "unauthorized"
	| "socialImage"
	| "icon"
	| "sitemap"
	| "robots"
	| "manifest"
	| "app"
	| "document";

/** `export const dynamic = …` values. */
export type DynamicMode = "auto" | "force-dynamic" | "error" | "force-static";
export type ScriptStrategy = "beforeInteractive" | "afterInteractive" | "lazyOnload" | "worker";
/** Conditions in a middleware `matcher` entry (`has` / `missing`). */
export type MatchType = "header" | "cookie" | "query" | "host";

export type NextPhrases = {
	files: Record<FileKind, Phrase<"route">>;
	/** Component headings for special files: "The page at /users/:id, given params". */
	head: (p: { file: string; props: string | null; trait: string | null }) => string;
	inline: (p: { file: string; props: string | null; trait: string | null; ui: string }) => string;
	/** A special file whose default export is not a component (sitemaps, images). */
	plainHead: Phrase<"file">;
	routes: {
		answer: (p: { methods: string; route: string | null }) => string;
		answerWith: (p: { methods: string; route: string | null; handler: string }) => string;
		pagesApi: (p: { route: string | null }) => string;
	};
	middleware: {
		head: (p: { kind: "proxy" | "middleware" }) => string;
		matcher: (p: { kind: "proxy" | "middleware"; paths: string }) => string;
		matcherList: (p: { kind: "proxy" | "middleware" }) => string;
		has: (p: { type: string; key: string }) => string;
		missing: (p: { type: string; key: string }) => string;
		withConditions: (p: { path: string; conditions: string }) => string;
		types: Record<MatchType, string>;
	};
	config: {
		dynamic: Record<DynamicMode, string>;
		revalidate: { never: string; always: string; every: Phrase<"duration"> };
		runtime: Phrase<"runtime">;
		runtimes: Record<"nodejs" | "edge" | "experimental-edge", string>;
		dynamicParams: { true: string; false: string };
		maxDuration: Phrase<"duration">;
		preferredRegion: Phrase<"regions">;
		fetchCache: Phrase<"value">;
		ppr: string;
		other: (p: { name: string; value: string }) => string;
		metadata: Phrase<"items">;
		viewport: Phrase<"items">;
		metadataList: string;
		viewportList: string;
		labeled: (p: { name: string; value: string }) => string;
		/** Metadata fields with a reading of their own. */
		fields: Record<string, string>;
	};
	generators: {
		generateMetadata: string;
		generateViewport: string;
		generateStaticParams: string;
		generateSitemaps: string;
		generateImageMetadata: string;
		getServerSideProps: string;
		getStaticProps: string;
		getStaticPaths: string;
		given: (p: { head: string; params: string | null }) => string;
	};
	directives: { client: string; server: string; serverFunction: string; cacheFile: string; cache: string; cacheKind: Phrase<"kind"> };
	server: {
		redirect: Phrase<"path">;
		permanentRedirect: Phrase<"path">;
		notFound: string;
		forbidden: string;
		unauthorized: string;
		revalidatePath: (p: { path: string; layout: boolean }) => string;
		revalidateTag: Phrase<"tag">;
		revalidateTagWith: (p: { tag: string; profile: string | null }) => string;
		updateTag: Phrase<"tag">;
		refresh: string;
		cacheTag: Phrase<"tags">;
		cacheLife: Phrase<"profile">;
		cacheLifeCustom: Phrase<"details">;
		cacheLifeFields: Record<"stale" | "revalidate" | "expire", Phrase<"duration">>;
		unstableCache: (p: { fn: string; details: string | null }) => string;
		cacheDetails: { tags: Phrase<"tags">; every: Phrase<"duration"> };
		cookies: string;
		headers: string;
		draftMode: string;
		connection: string;
		after: string;
		cookie: Phrase<"name">;
		cookieValue: Phrase<"cookie">;
		allCookies: string;
		setCookie: (p: { name: string; value: string; details: string | null }) => string;
		deleteCookie: Phrase<"name">;
		hasCookie: (p: { name: string; neg: boolean }) => string;
		header: Phrase<"name">;
		hasHeader: (p: { name: string; neg: boolean }) => string;
		params: string;
		searchParams: string;
	};
	responses: {
		json: (p: { body: string; details: string | null }) => string;
		redirect: (p: { url: string; details: string | null }) => string;
		rewrite: Phrase<"url">;
		next: string;
		continue: string;
		response: (p: { body: string | null; details: string | null }) => string;
		reply: Phrase<"response">;
		status: (p: { code: string; name: string | null }) => string;
		statusNames: Record<string, string>;
		headers: Phrase<"items">;
		requestPath: string;
		requestUrl: string;
		queryParams: string;
		queryParam: Phrase<"name">;
		urlCopy: string;
	};
	navigation: {
		router: string;
		push: Phrase<"href">;
		replace: Phrase<"href">;
		back: string;
		forward: string;
		refresh: string;
		prefetch: Phrase<"href">;
		pathname: string;
		searchParams: string;
		params: string;
		segment: string;
		segments: string;
		query: string;
		asPath: string;
		isReady: string;
	};
	elements: {
		link: Phrase<"href">;
		image: (p: { alt: string | null }) => string;
		script: (p: { src: string | null; strategy: string | null }) => string;
		strategies: Record<ScriptStrategy, string>;
		form: Phrase<"action">;
		head: string;
	};
	dynamicImport: (p: { path: string; browserOnly: boolean }) => string;
	units: { seconds: Unit; minutes: Unit; hours: Unit; days: Unit };
};
