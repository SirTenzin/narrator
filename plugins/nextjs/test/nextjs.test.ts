import { describe, expect, test } from "bun:test";
import { createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en as english } from "@usenarrator/locale-en";
import { narrate, phrasebookGaps } from "@usenarrator/testkit";
import { en, fileInfo, nextjs, trackPaths } from "../src";

const paths = trackPaths();
const narrator = createNarrator({
	languages: [
		typescript({
			parser: oxcParser,
			plugins: [nextjs({ pathOf: paths.pathOf })],
			setup: paths.setup,
			dependencies: () => ({ next: "^16.0.0", react: "^19.2.0" }),
		}),
	],
	locale: english,
});

/** Narrates a file at `path` with the Next.js plugin and asserts nothing fell back to raw code. */
const read = (code: string, path = "app/page.tsx") => {
	const { lines, stats } = narrator.narrate(code, path) as ReturnType<typeof narrator.narrate> & { stats: { fallbacks: number } };
	expect(stats.fallbacks).toBe(0);
	return renderText(lines);
};

describe("file paths", () => {
	test("App Router paths become routes in Next.js matcher notation", () => {
		expect(fileInfo("app/page.tsx")).toEqual({ router: "app", kind: "page", route: "/" });
		expect(fileInfo("src/app/(marketing)/blog/[slug]/page.tsx")).toEqual({ router: "app", kind: "page", route: "/blog/:slug" });
		expect(fileInfo("app/docs/[...slug]/page.tsx")?.route).toBe("/docs/:slug+");
		expect(fileInfo("app/shop/[[...slug]]/page.tsx")?.route).toBe("/shop/:slug*");
		expect(fileInfo("app/@modal/(.)photo/[id]/page.tsx")?.route).toBe("/photo/:id");
		expect(fileInfo("apps/web/app/api/users/[id]/route.ts")).toEqual({ router: "app", kind: "route", route: "/api/users/:id" });
		expect(fileInfo("app/layout.tsx")?.kind).toBe("rootLayout");
		expect(fileInfo("app/dashboard/layout.tsx")?.kind).toBe("layout");
		expect(fileInfo("app/components/Button.tsx")?.kind).toBe(null);
	});

	test("Pages Router paths, middleware and proxy", () => {
		expect(fileInfo("pages/index.tsx")).toEqual({ router: "pages", kind: "page", route: "/" });
		expect(fileInfo("src/pages/posts/[id].tsx")?.route).toBe("/posts/:id");
		expect(fileInfo("pages/api/hello.ts")).toEqual({ router: "pages", kind: "api", route: "/api/hello" });
		expect(fileInfo("pages/_app.tsx")?.kind).toBe("app");
		expect(fileInfo("middleware.ts")?.kind).toBe("middleware");
		expect(fileInfo("src/proxy.ts")?.kind).toBe("proxy");
		expect(fileInfo("lib/utils.ts")).toBe(null);
	});
});

describe("pages and layouts", () => {
	test("a dynamic page from the docs: params, data, notFound and JSX", () => {
		expect(
			read(
				`import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  return (
    <article>
      <h1>{post.title}</h1>
      <Image src={post.cover} alt={post.title} width={800} height={400} />
      <Link href="/blog">Back to blog</Link>
    </article>
  );
}`,
				"app/blog/[slug]/page.tsx",
			),
		).toBe(
			[
				"The page at /blog/:slug, given params:",
				"  From the route parameters, take slug.",
				"  Get post (slug) → post.",
				"  If post is missing, show the not-found page.",
				"  Show an article containing:",
				"    • a heading showing post's title",
				"    • an image of post's title",
				`    • a link to /blog "Back to blog"`,
			].join("\n"),
		);
	});

	test("the root layout, metadata and a short page", () => {
		expect(
			read(
				`import type { Metadata } from "next";
export const metadata: Metadata = { title: "Acme", description: "The Acme storefront" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
				"app/layout.tsx",
			),
		).toBe(
			[`Set the page metadata: title "Acme" and description "The Acme storefront".`, "The root layout around every page, given children, shows children."].join(
				"\n",
			),
		);
		expect(read(`export default function Loading() {\n  return <p>Loading...</p>;\n}`, "app/dashboard/loading.tsx")).toBe(
			`The loading screen for /dashboard shows a paragraph "Loading...".`,
		);
	});

	test("generateStaticParams, generateMetadata and segment config", () => {
		expect(
			read(
				`export const revalidate = 3600;
export const dynamicParams = false;
export const runtime = "edge";
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}
export async function generateMetadata({ params }) {
  const { slug } = await params;
  return { title: slug };
}`,
				"app/blog/[slug]/page.tsx",
			),
		).toBe(
			[
				"Refresh this route's cached data at most every 1 hour.",
				"Show the not-found page for route parameters that weren't pre-rendered.",
				"Run this route on the edge runtime.",
				"",
				"List the route parameters to pre-render at build time:",
				"  Get posts → posts.",
				"  Give back posts, with each post turned into an object with slug: each post's slug.",
				"",
				"Work out the page metadata, given params:",
				"  From the route parameters, take slug.",
				"  Give back an object with title: slug.",
			].join("\n"),
		);
	});

	test("a page without a known path still reads as a component", () => {
		expect(read(`import Link from "next/link";\nexport default function Home() {\n  return <Link href="/about">About</Link>;\n}`, "src/views/home.tsx")).toBe(
			`Home, a component that shows a link to /about "About".`,
		);
	});
});

describe("route handlers", () => {
	test("GET and POST with request APIs, from the route handler docs", () => {
		expect(
			read(
				`import { NextResponse, type NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }) {
  const { id } = await params;
  const query = request.nextUrl.searchParams.get("q");
  const token = (await cookies()).get("token")?.value;
  const auth = (await headers()).get("authorization");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getUser(id));
}

export async function POST(request: Request) {
  const body = await request.json();
  const cookieStore = await cookies();
  cookieStore.set("theme", body.theme, { httpOnly: true });
  revalidateTag("users", "max");
  return new Response(null, { status: 204 });
}`,
				"app/api/users/[id]/route.ts",
			),
		).toBe(
			[
				"Render this route fresh on every request.",
				"",
				"Answer GET /api/users/:id:",
				"  From the route parameters, take ID.",
				"  Let query be the q query parameter.",
				"  Let token be the value of the token cookie.",
				"  Let auth be the authorization request header.",
				`  If token is missing, reply with an object with error: "Unauthorized" as JSON (status 401 Unauthorized).`,
				"  Reply with get user (ID) as JSON.",
				"",
				"Answer POST /api/users/:id:",
				"  Let body be request's JSON.",
				"  Let cookie store be the request's cookies.",
				"  Set the theme cookie to body's theme (HTTP only).",
				"  Mark data tagged users as stale, serving it while fresh data loads in the background.",
				"  Reply with an empty response (status 204 No Content).",
			].join("\n"),
		);
	});

	test("one handler exported under several methods", () => {
		expect(
			read(
				`import NextAuth from "next-auth";\nconst handler = NextAuth(authOptions);\nexport { handler as GET, handler as POST };`,
				"app/api/auth/[...nextauth]/route.ts",
			),
		).toBe(["Let handler be the result of next auth (auth options).", "Answer GET and POST /api/auth/:nextauth+ with handler."].join("\n"));
	});

	test("a Pages Router API route", () => {
		expect(read(`export default function handler(req, res) {\n  res.status(200).json({ message: "Hello" });\n}`, "pages/api/hello.ts")).toContain(
			"Answer requests to /api/hello:",
		);
	});
});

describe("middleware and proxy", () => {
	test("Next.js 16 proxy with a matcher", () => {
		expect(
			read(
				`import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (request.nextUrl.pathname.startsWith("/old")) {
    return NextResponse.rewrite(new URL("/new", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", { source: "/api/:path*", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};`,
				"proxy.ts",
			),
		).toBe(
			[
				"Before each matching request reaches the app (the proxy):",
				"  If the session cookie is not set, redirect to /login.",
				`  If the requested path starts with "/old", reply with the content of /new, keeping the original address.`,
				"  Let the request continue.",
				"",
				"Run the proxy only for /dashboard/:path* and /api/:path* (unless the next-router-prefetch header is present).",
			].join("\n"),
		);
	});

	test("Next.js 15 middleware.ts reads the same way", () => {
		expect(
			read(
				`import { NextResponse } from "next/server";\nexport function middleware(request) {\n  return NextResponse.redirect(new URL("/home", request.url));\n}`,
				"middleware.ts",
			),
		).toBe(["Before each matching request reaches the app (middleware):", "  Redirect to /home."].join("\n"));
	});
});

describe("server actions and caching", () => {
	test("a server action file", () => {
		expect(
			read(
				`"use server";
import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";

export async function createPost(formData: FormData) {
  const title = formData.get("title");
  await db.post.create({ data: { title } });
  updateTag("posts");
  revalidatePath("/posts", "layout");
  redirect("/posts");
}`,
				"app/actions.ts",
			),
		).toBe(
			[
				"Everything this file exports is a server action the browser can call.",
				"",
				"To create post (async), given form data (FormData):",
				`  Let title be form data's entry for "title".`,
				"  Create DB's post (data: an object with title).",
				"  Expire data tagged posts and fetch it fresh for this request.",
				"  Refresh the cached data for /posts and every page under it.",
				"  Redirect to /posts.",
			].join("\n"),
		);
	});

	test('"use cache" with cacheTag and cacheLife (Next.js 16)', () => {
		expect(
			read(
				`import { cacheLife, cacheTag } from "next/cache";
export async function getProducts() {
  "use cache";
  cacheTag("products");
  cacheLife("hours");
  return db.query("SELECT * FROM products");
}`,
				"lib/data.ts",
			),
		).toBe(
			[
				"To get products (async):",
				"  Cache this result, keyed by its inputs.",
				"  Tag this cached result as products.",
				"  Keep this cached result for the hours profile.",
				`  Query DB ("SELECT * FROM products"), and give back the result.`,
			].join("\n"),
		);
	});

	test("revalidateTag: single argument (Next.js 15) vs a cache profile (Next.js 16)", () => {
		const code = (args: string) => `import { revalidateTag } from "next/cache";\nrevalidateTag(${args});`;
		expect(read(code(`"posts"`), "lib/a.ts")).toBe("Expire data tagged posts so it is fetched fresh next time.");
		expect(read(code(`"posts", "max"`), "lib/a.ts")).toBe("Mark data tagged posts as stale, serving it while fresh data loads in the background.");
		expect(read(code(`"posts", { expire: 3600 }`), "lib/a.ts")).toBe(
			"Mark data tagged posts as stale, serving it while fresh data loads in the background (dropped after 1 hour without visits).",
		);
	});
});

describe("client navigation", () => {
	test("next/navigation hooks and the router", () => {
		expect(
			read(
				`"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function Search() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get("q");
  return (
    <form onSubmit={(e) => { e.preventDefault(); router.push("/search"); }}>
      {pathname !== "/" && <button type="button" onClick={() => router.back()}>Back</button>}
    </form>
  );
}`,
				"components/search.tsx",
			),
		).toBe(
			[
				"This file runs in the browser (its components are client components).",
				"",
				"Search, a component:",
				"  Let router be the router.",
				"  Let pathname be the current path.",
				"  Let search params be the URL's query parameters.",
				"  Let q be the q query parameter.",
				"  Show a form containing:",
				"    • when submitted:",
				"      Prevent e default.",
				"      Go to /search.",
				`    • if pathname is not "/", a button "Back" (type: "button"; when clicked, go back)`,
			].join("\n"),
		);
	});

	test("next/dynamic and next/script", () => {
		expect(
			read(
				`import dynamic from "next/dynamic";
import Script from "next/script";
const Chart = dynamic(() => import("../components/chart"), { ssr: false });
export default function Page() {
  return <Script src="https://example.com/analytics.js" strategy="lazyOnload" />;
}`,
				"app/stats/page.tsx",
			),
		).toBe(
			[
				`Let chart be the component from "../components/chart", loaded when first shown and only in the browser.`,
				"The page at /stats shows the script https://example.com/analytics.js, loaded when the browser is idle.",
			].join("\n"),
		);
	});
});

describe("guards", () => {
	test("without Next.js in the file or package, nothing changes", () => {
		const code = `export async function GET(request) {\n  return Response.json({ ok: true });\n}\nconst x = redirect("/a");\nrouter.push("/b");\ncookies().get("a");`;
		expect(narrate(code, { plugins: [nextjs()] })).toBe(narrate(code));
	});

	test("Hono's own redirect and a non-route GET are left alone", () => {
		const code = `import { Hono } from "hono";\nconst app = new Hono();\nfunction redirect(p) {}\nredirect("/x");\nexport function GET() { return 1; }`;
		expect(narrate(code, { plugins: [nextjs()] })).toBe(narrate(code));
	});
});

describe("plugin", () => {
	test("the English phrasebook is complete", () => {
		expect(phrasebookGaps(en, { ...en })).toEqual({ missing: [], extra: [] });
	});

	test("declares the Next.js versions it reads and bundles React", () => {
		const [core, reactPlugin] = nextjs();
		expect(core?.library).toEqual({ name: "next", versions: ">=13.4 <17" });
		expect(reactPlugin?.name).toBe("react");
	});
});
