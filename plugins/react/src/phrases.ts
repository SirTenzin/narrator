/** Arguments are already-rendered markup strings unless typed otherwise. */
type P<K extends string> = { [key in K]: string };
type Phrase<K extends string> = (p: P<K>) => string;

/** HTML tags the UI reading names; any other lower-case tag is shown as code. */
export type Tag =
	| "a"
	| "article"
	| "aside"
	| "audio"
	| "b"
	| "blockquote"
	| "br"
	| "button"
	| "canvas"
	| "code"
	| "details"
	| "dialog"
	| "em"
	| "figure"
	| "figcaption"
	| "fieldset"
	| "footer"
	| "form"
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "h5"
	| "h6"
	| "header"
	| "hr"
	| "i"
	| "iframe"
	| "img"
	| "input"
	| "label"
	| "legend"
	| "li"
	| "main"
	| "nav"
	| "ol"
	| "option"
	| "p"
	| "pre"
	| "section"
	| "select"
	| "small"
	| "strong"
	| "summary"
	| "svg"
	| "table"
	| "tbody"
	| "td"
	| "textarea"
	| "th"
	| "thead"
	| "tr"
	| "ul"
	| "video";

/** DOM events with a reading of their own ("when clicked"); other `on…` props read as "on …". */
export type DomEvent =
	| "onClick"
	| "onDoubleClick"
	| "onChange"
	| "onSubmit"
	| "onInput"
	| "onKeyDown"
	| "onKeyUp"
	| "onFocus"
	| "onBlur"
	| "onMouseEnter"
	| "onMouseLeave"
	| "onScroll"
	| "onLoad"
	| "onError"
	| "onPointerDown"
	| "onDrop"
	| "onDragStart";

/** `<input type="…">` values with their own noun. */
export type InputType =
	| "text"
	| "email"
	| "password"
	| "number"
	| "checkbox"
	| "radio"
	| "file"
	| "search"
	| "date"
	| "range"
	| "hidden"
	| "tel"
	| "url"
	| "submit";

/** DOM element methods the plugin reads when called on a ref's element. */
export type DomMethod =
	| "focus"
	| "blur"
	| "click"
	| "select"
	| "scrollIntoView"
	| "showModal"
	| "close"
	| "play"
	| "pause"
	| "reset"
	| "submit"
	| "requestSubmit";

export type ReactPhrases = {
	component: {
		/** Heading of a component whose body has steps: "UserList: a component that takes user ID". */
		head: (p: { name: string; props: string | null; trait: string | null }) => string;
		/** A component that is just one short piece of UI. */
		inline: (p: { name: string; props: string | null; trait: string | null; ui: string }) => string;
		/** A custom hook's heading. */
		hook: (p: { name: string; params: string | null }) => string;
		memo: string;
		forwardRef: Phrase<"ref">;
		/** `memo(Card)` as a value. */
		memoOf: Phrase<"component">;
		/** `forwardRef(fn)` as a value. */
		forwardRefOf: Phrase<"component">;
		/** `lazy(() => import("./X"))`. */
		lazy: Phrase<"path">;
		props: string;
	};
	hooks: {
		state: (p: { name: string; initial: string | null }) => string;
		reducer: (p: { name: string; initial: string; reducer: string; dispatch: string | null }) => string;
		refElement: (p: { name: string; element: string | null }) => string;
		refValue: (p: { name: string; initial: string | null }) => string;
		memo: (p: { name: string; value: string; when: string }) => string;
		memoBlock: (p: { name: string; when: string }) => string;
		callback: (p: { name: string; when: string; params: string | null }) => string;
		effectEvent: (p: { name: string; params: string | null }) => string;
		/** When a memo or callback is redone, from its dependency list. */
		recomputed: { always: string; once: string; when: Phrase<"deps"> };
		/** When a callback is recreated, from its dependency list. */
		kept: { always: string; once: string; when: Phrase<"deps"> };
		/** Effect headings by dependency list. */
		effect: { always: string; once: string; when: Phrase<"deps"> };
		/** The same, for layout and insertion effects. */
		layoutEffect: { always: string; once: string; when: Phrase<"deps"> };
		cleanup: { once: string; when: string };
		cleanupWith: (p: { when: string; action: string }) => string;
		context: Phrase<"context">;
		usePromise: Phrase<"promise">;
		transition: (p: { pending: string | null; start: string }) => string;
		startTransition: string;
		deferred: Phrase<"value">;
		id: string;
		/** An inline callback with several steps, listed below it. */
		steps: string;
		actionState: (p: { name: string; initial: string; action: string; run: string; pending: string | null }) => string;
		optimistic: (p: { name: string; state: string; add: string | null }) => string;
		formStatus: string;
		externalStore: (p: { snapshot: string; subscribe: string }) => string;
		imperativeHandle: (p: { ref: string; methods: string }) => string;
		debugValue: Phrase<"value">;
		/** A custom hook's result: `useOrg()` -> "useOrg". */
		custom: (p: { hook: string; args: string | null }) => string;
		customGet: (p: { names: string; hook: string }) => string;
		customRun: (p: { hook: string }) => string;
	};
	updates: {
		set: (p: { name: string; value: string }) => string;
		toggle: Phrase<"name">;
		add: (p: { name: string; value: string }) => string;
		update: Phrase<"name">;
		dispatch: Phrase<"action">;
		action: (p: { type: string; fields: string | null }) => string;
		setState: Phrase<"changes">;
	};
	ui: {
		show: Phrase<"ui">;
		showNothing: string;
		giveBack: Phrase<"ui">;
		/** `const x = <… />`. */
		let: (p: { name: string; ui: string }) => string;
		ifShow: Phrase<"condition">;
		otherwise: string;
		tags: Record<Tag, string>;
		heading: string;
		container: string;
		input: Record<InputType, string>;
		/** An element and its parenthesised details: `a button (disabled)`. */
		element: (p: { element: string; details: string[] }) => string;
		/** An element whose only child is text: `a heading "Users"`. */
		withText: (p: { element: string; text: string }) => string;
		showing: (p: { element: string; child: string }) => string;
		containing: Phrase<"element">;
		/** Several sibling elements with no wrapper. */
		group: string;
		onlyIf: (p: { condition: string; ui: string | null }) => string;
		either: (p: { condition: string; yes: string; no: string }) => string;
		each: (p: { item: string; collection: string; ui: string | null }) => string;
		/** A function that renders UI from what it is given (render props, children as a function). */
		renderProp: (p: { params: string | null; ui: string | null }) => string;
		eachOf: (p: { item: string; collection: string; ui: string }) => string;
		events: Record<DomEvent, string>;
		customEvent: Phrase<"name">;
		handler: (p: { when: string; action: string | null }) => string;
		/** `disabled={busy}`. */
		flagWhen: (p: { flag: string; condition: string }) => string;
		labeled: (p: { name: string; value: string }) => string;
		everythingIn: Phrase<"value">;
		linkTo: Phrase<"href">;
		imageOf: (p: { alt: string | null }) => string;
		formAction: Phrase<"action">;
		suspense: (p: { fallback: string; ui: string }) => string;
		provide: (p: { value: string; context: string; ui: string }) => string;
		portal: (p: { ui: string; container: string }) => string;
		children: string;
	};
	dom: {
		createRoot: Phrase<"container">;
		render: (p: { ui: string; root: string }) => string;
		hydrate: (p: { ui: string; container: string }) => string;
		createContext: (p: { initial: string | null }) => string;
		elementRef: Phrase<"ref">;
		refValue: Phrase<"ref">;
		elements: Record<string, string>;
		anElement: string;
		/** Element methods called through a ref: `inputRef.current.focus()`. */
		methods: Record<DomMethod, Phrase<"element">>;
	};
};
