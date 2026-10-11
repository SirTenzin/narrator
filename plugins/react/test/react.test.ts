import { describe, expect, test } from "bun:test";
import { narrate, narrateWithStats, phrasebookGaps } from "@usenarrator/testkit";
import { en, react } from "../src";

const plugins = [react()];

/** Narrates a TSX snippet with the React plugin and asserts nothing fell back to raw code. */
const read = (code: string) => {
	const { text, fallbacks } = narrateWithStats(code, { plugins, path: "snippet.tsx" });
	expect(fallbacks).toBe(0);
	return text;
};

describe("components", () => {
	test("a one-line component reads as what it shows", () => {
		expect(read(`function Greeting({ name }) {\n  return <h1>Hello, {name}</h1>;\n}`)).toBe(
			`Greeting, a component that takes name and shows a heading "Hello, {name}".`,
		);
	});

	test("an arrow component without props", () => {
		expect(read(`import { Logo } from "./logo";\nexport const Footer = () => <footer><Logo /><p>© 2026 Acme</p></footer>;`)).toBe(
			["Footer, a component:", "  Show a footer containing:", "    • Logo", `    • a paragraph "© 2026 Acme"`].join("\n"),
		);
	});

	test("the react.dev counter keeps state, the update and the click", () => {
		expect(
			read(`import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
  }

  return (
    <button onClick={handleClick}>
      Clicked {count} times
    </button>
  );
}`),
		).toBe(
			[
				"Counter, a component:",
				"  Keep track of count (starts as 0).",
				"  To handle click:",
				"    Set count to count plus 1.",
				`  Show a button "Clicked {count} times" (when clicked, handle click).`,
			].join("\n"),
		);
	});

	test("functional updates read in terms of the state they change", () => {
		const text = read(`import { useState } from "react";
function Panel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [n, setN] = useState(() => loadCount());
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}>Toggle</button>
      <button onClick={() => setItems((prev) => [...prev, newItem])}>Add</button>
      <button onClick={() => setN((x) => x * 2)}>Double</button>
    </div>
  );
}`);
		expect(text).toBe(
			[
				"Panel, a component:",
				"  Keep track of open (starts as false).",
				"  Keep track of items (starts as an empty list).",
				"  Keep track of n (starts as load count).",
				"  Show the following:",
				`    • a button "Toggle" (when clicked, flip open)`,
				`    • a button "Add" (when clicked, add new item to items)`,
				`    • a button "Double" (when clicked, set n to n times 2)`,
			].join("\n"),
		);
	});

	test("memo and forwardRef become traits of the component", () => {
		expect(
			read(`import { memo } from "react";\nexport const Avatar = memo(function Avatar({ user }) {\n  return <img src={user.url} alt={user.name} />;\n});`),
		).toBe("Avatar, a component that takes user and shows an image of user's name, re-rendering only when its props change.");
		expect(
			read(
				`import { forwardRef } from "react";\nconst MyInput = forwardRef(function MyInput({ label, ...props }, ref) {\n  return <label>{label}<input {...props} ref={ref} /></label>;\n});`,
			),
		).toBe(
			[
				"MyInput, a component that takes label and the rest as props, passing the ref it is given on as ref:",
				"  Show a label containing:",
				"    • label",
				"    • an input (everything in props)",
			].join("\n"),
		);
	});
});

describe("JSX as UI", () => {
	test("lists rendered with map, from the react.dev list example", () => {
		expect(
			read(`const people = ["Creola Katherine Johnson: mathematician", "Mario José Molina-Pasquel Henríquez: chemist"];
export default function List() {
  const listItems = people.map((person) => <li>{person}</li>);
  return <ul>{listItems}</ul>;
}`),
		).toBe(
			[
				"Let people be a list of:",
				`  • "Creola Katherine Johnson: mathematician"`,
				`  • "Mario José Molina-Pasquel Henríquez: chemist"`,
				"",
				"List, a component:",
				"  Let list items be an item showing person for each person in people.",
				"  Show a list showing list items.",
			].join("\n"),
		);
	});

	test("an inline map with a key and a handler", () => {
		expect(
			read(`export function Users({ users, onSelect }) {
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id} onClick={() => onSelect(u.id)}>{u.name}</li>
      ))}
    </ul>
  );
}`),
		).toBe(
			[
				"Users, a component that takes users and on select:",
				"  Show a list containing:",
				"    • for each u in users, an item (when clicked, trigger on select (u's ID)) showing u's name",
			].join("\n"),
		);
	});

	test("conditional rendering: early return, &&, ternary and null", () => {
		expect(
			read(`function Item({ name, isPacked, note }) {
  if (!name) return null;
  return (
    <li className="item">
      {isPacked ? <del>{name}</del> : name}
      {note && <small>{note}</small>}
    </li>
  );
}`),
		).toBe(
			[
				"Item, a component that takes name, is packed, and note:",
				"  If name is missing, show nothing.",
				"  Show an item containing:",
				"    • <del> showing name if is packed, otherwise name",
				"    • if note is set, small text showing note",
			].join("\n"),
		);
	});

	test("a ternary return with bigger branches splits into two blocks", () => {
		expect(
			read(`function Status({ user }) {
  return user ? (
    <section><h2>Welcome back</h2><p>{user.name}</p></section>
  ) : (
    <form action="/login"><button type="submit">Sign in</button></form>
  );
}`),
		).toBe(
			[
				"Status, a component that takes user:",
				"  If user is set:",
				"    Show a section containing:",
				`      • a heading "Welcome back"`,
				"      • a paragraph showing user's name",
				"  Otherwise:",
				`    Show a form (action: "/login") showing a submit button "Sign in".`,
			].join("\n"),
		);
	});

	test("form controls and links", () => {
		expect(
			read(`function Signup({ email, setEmail, busy }) {
  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="checkbox" checked={agreed} />
      <a href="/terms">Terms</a>
      <button disabled={busy}>Sign up</button>
    </form>
  );
}`),
		).toBe(
			[
				"Signup, a component that takes email, set email, and busy:",
				"  Show a form (when submitted, handle submit) containing:",
				"    • an email input (value: email; when changed, set email (e's target's value); required)",
				"    • a checkbox (checked when agreed is set)",
				`    • a link to /terms "Terms"`,
				`    • a button "Sign up" (disabled when busy is set)`,
			].join("\n"),
		);
	});

	test("a handler with several steps lists them under the element", () => {
		expect(
			read(`import { useState } from "react";
function Save() {
  const [saved, setSaved] = useState(false);
  return (
    <button onClick={async () => { await save(); setSaved(true); }}>Save</button>
  );
}`),
		).toBe(
			[
				"Save, a component:",
				"  Keep track of saved (starts as false).",
				`  Show a button "Save":`,
				"    • when clicked:",
				"      Save.",
				"      Set saved to true.",
			].join("\n"),
		);
	});

	test("JSX kept in a variable", () => {
		expect(
			read(
				`import { Spinner } from "./spinner";\nfunction A({ loading }) {\n  const body = loading ? <Spinner /> : <p>Done</p>;\n  return <main>{body}</main>;\n}`,
			),
		).toBe(
			[
				"A, a component that takes loading:",
				`  Let body be Spinner if loading is set, otherwise a paragraph "Done".`,
				"  Show the main content showing body.",
			].join("\n"),
		);
	});
});

describe("UI details", () => {
	test("render functions, framer-motion props, icons and setter-only callbacks", () => {
		expect(
			read(`import { useState } from "react";
import { motion } from "framer-motion";
export function Settings({ form }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <svg viewBox="0 0 16 16"><path d="M4 6L8 10" /></svg>
      <form.Field name="email">{(field) => <Input value={field.value} />}</form.Field>
      <Dialog open={open} onOpenChange={setOpen} onClose={close} />
    </motion.section>
  );
}`),
		).toBe(
			[
				"Settings, a component that takes form:",
				"  Keep track of open (starts as false).",
				"  To close:",
				"    Set open to false.",
				"  Show a section containing:",
				"    • an icon",
				`    • form.Field (name: "email") showing given field, Input (value: field's value)`,
				"    • Dialog (open; on open change, set open; on close, close)",
			].join("\n"),
		);
	});

	test("a form action with steps and Suspense without a fallback", () => {
		expect(
			read(`import { Suspense } from "react";
export function Checkout() {
  return (
    <Suspense>
      <form action={async () => { await pay(); redirectHome(); }}>
        <button type="submit">Pay</button>
      </form>
    </Suspense>
  );
}`),
		).toBe(
			[
				"Checkout, a component:",
				"  Show the following, showing nothing while it loads:",
				"    • a form containing:",
				"      • when submitted:",
				"        Pay.",
				"        Redirect home.",
				`      • a submit button "Pay"`,
			].join("\n"),
		);
	});

	test("an empty fragment shows nothing", () => {
		expect(read(`function Empty({ hidden }) {\n  if (hidden) return <></>;\n  return <p>Hi</p>;\n}`)).toBe(
			["Empty, a component that takes hidden:", "  If hidden is set, show nothing.", `  Show a paragraph "Hi".`].join("\n"),
		);
	});
});

describe("hooks", () => {
	test("an effect with dependencies and a cleanup, from the react.dev chat room", () => {
		expect(
			read(`import { useState, useEffect } from "react";
import { createConnection } from "./chat.js";

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState("https://localhost:1234");

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);

  return <h1>Welcome to the {roomId} room!</h1>;
}`),
		).toBe(
			[
				"ChatRoom, a component that takes room ID:",
				`  Keep track of server URL (starts as "https://localhost:1234").`,
				"  Whenever server URL or room ID changes:",
				"    Create connection (server URL and room ID) → connection.",
				"    Connect connection.",
				"    Before running again and when it goes away, disconnect connection.",
				`  Show a heading "Welcome to the {room ID} room!".`,
			].join("\n"),
		);
	});

	test("effects that run once, after every render, and before paint", () => {
		const text = read(`import { useEffect, useLayoutEffect } from "react";
function A() {
  useEffect(() => {
    document.title = "Inbox";
  }, []);
  useEffect(() => {
    log("rendered");
  });
  useLayoutEffect(() => {
    measure();
  }, [width]);
  return <p>Hi</p>;
}`);
		expect(text).toBe(
			[
				"A, a component:",
				"  Once, when it first appears:",
				`    Set document's title to "Inbox".`,
				"  After every render:",
				`    Log ("rendered").`,
				"  Whenever width changes, before the screen updates:",
				"    Measure.",
				`  Show a paragraph "Hi".`,
			].join("\n"),
		);
	});

	test("useMemo, useCallback and useRef", () => {
		expect(
			read(`import { useMemo, useCallback, useRef } from "react";
function TodoList({ todos, tab }) {
  const visibleTodos = useMemo(() => filterTodos(todos, tab), [todos, tab]);
  const inputRef = useRef(null);
  const timer = useRef(0);
  const handleSubmit = useCallback((orderDetails) => {
    post("/product/" + productId + "/buy", { referrer, orderDetails });
  }, [productId, referrer]);
  function handleClick() {
    inputRef.current.focus();
  }
  return <input ref={inputRef} />;
}`),
		).toBe(
			[
				"TodoList, a component that takes todos and tab:",
				"  Let visible todos be filter todos (todos and tab), recalculated only when todos or tab changes.",
				"  Keep input ref as a handle to an element on the page.",
				"  Keep timer as a value that survives re-renders (starts as 0).",
				"  Handle submit, a function kept the same until product ID or referrer changes, given order details:",
				"    Post:",
				`      • "/product/" followed by product ID plus "/buy"`,
				"      • referrer",
				"      • order details",
				"  To handle click:",
				"    Focus the input ref element.",
				"  Show an input.",
			].join("\n"),
		);
	});

	test("useReducer and dispatch, from the react.dev task app", () => {
		expect(
			read(`import { useReducer } from "react";
export default function TaskApp() {
  const [tasks, dispatch] = useReducer(tasksReducer, initialTasks);
  function handleAddTask(text) {
    dispatch({ type: "added", id: nextId, text: text });
  }
  function handleDeleteTask(taskId) {
    dispatch({ type: "deleted", id: taskId });
  }
  return <AddTask onAddTask={handleAddTask} />;
}`),
		).toBe(
			[
				"TaskApp, a component:",
				"  Keep track of tasks (starts as initial tasks), changed by tasks reducer when actions are sent through dispatch.",
				"  To handle add task, given text:",
				`    Send the "added" action with ID: next ID and text.`,
				"  To handle delete task, given task ID:",
				`    Send the "deleted" action with ID: task ID.`,
				"  Show AddTask (on add task, handle add task).",
			].join("\n"),
		);
	});

	test("context: createContext, useContext, use and both provider forms", () => {
		expect(
			read(`import { createContext, useContext, use } from "react";
const ThemeContext = createContext("light");
function Button() {
  const theme = useContext(ThemeContext);
  const user = use(UserContext);
  return <button className={theme}>{user.name}</button>;
}
export function App() {
  return (
    <ThemeContext value="dark">
      <AuthContext.Provider value={auth}><Button /></AuthContext.Provider>
    </ThemeContext>
  );
}`),
		).toBe(
			[
				`Let theme context be a new context (default: "light").`,
				"",
				"Button, a component:",
				"  Let theme be the current ThemeContext value.",
				"  Let user be the current UserContext value.",
				"  Show a button showing user's name.",
				"",
				`App, a component that shows Button, with AuthContext set to auth, with ThemeContext set to "dark".`,
			].join("\n"),
		);
	});

	test("custom hooks: definition and use", () => {
		expect(
			read(`import { useState, useEffect } from "react";
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);
  return isOnline;
}
function StatusBar() {
  const isOnline = useOnlineStatus();
  const { data, error } = useSWR("/api/user", fetcher);
  useHotkeys("ctrl+k", openSearch);
  return <h1>{isOnline ? "✅ Online" : "❌ Disconnected"}</h1>;
}`),
		).toBe(
			[
				"The useOnlineStatus hook:",
				"  Keep track of is online (starts as true).",
				"  Once, when it first appears:",
				"    To handle online:",
				"      Set is online to true.",
				`    Add window event listener ("online" and handle online).`,
				`    When it goes away, remove window event listener ("online" and handle online).`,
				"  Give back whether is online.",
				"",
				"StatusBar, a component:",
				"  Get is online from useOnlineStatus.",
				`  Get data and error from useSWR ("/api/user" and fetcher).`,
				`  Run useHotkeys ("ctrl+k" and open search).`,
				`  Show a heading showing "✅ Online" if is online, otherwise "❌ Disconnected".`,
			].join("\n"),
		);
	});

	test("useTransition, useDeferredValue and useId", () => {
		expect(
			read(`import { useTransition, useDeferredValue, useId } from "react";
function TabContainer({ query }) {
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const id = useId();
  function selectTab(nextTab) {
    startTransition(() => {
      setTab(nextTab);
    });
  }
  return <SearchResults query={deferredQuery} />;
}`),
		).toBe(
			[
				"TabContainer, a component that takes query:",
				"  Use start transition to run updates in the background, with is pending true while they run.",
				"  Let deferred query be query, allowed to lag behind while the screen is busy.",
				"  Let ID be a unique ID for this component.",
				"  To select tab, given next tab:",
				"    In the background, without blocking the screen:",
				"      Set tab (next tab).",
				"  Show SearchResults (query: deferred query).",
			].join("\n"),
		);
	});
});

describe("React 19", () => {
	test("useActionState, useOptimistic and useFormStatus, from the React 19 release post", () => {
		expect(
			read(`import { useActionState, useOptimistic } from "react";
import { useFormStatus } from "react-dom";

function ChangeName({ currentName, onUpdateName }) {
  const [optimisticName, setOptimisticName] = useOptimistic(currentName);
  const [error, submitAction, isPending] = useActionState(
    async (previousState, formData) => {
      const error = await updateName(formData.get("name"));
      if (error) {
        return error;
      }
      return null;
    },
    null,
  );
  return (
    <form action={submitAction}>
      <p>Your name is: {optimisticName}</p>
      <input type="text" name="name" disabled={currentName !== optimisticName} />
      {error && <p>{error}</p>}
    </form>
  );
}

function DesignButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} />;
}`),
		).toBe(
			[
				"ChangeName, a component that takes current name and on update name:",
				"  Let optimistic name show current name with pending changes applied right away; set optimistic name applies one.",
				"  Keep track of error (starts as nothing); submit action runs these steps and stores what it gives back, with is pending true while it runs:",
				`    Update name (form data's entry for "name"), and call the result error.`,
				"    If error is set, give back error.",
				"    Give back nothing.",
				"  Show a form that runs submit action when submitted containing:",
				`    • a paragraph "Your name is: {optimistic name}"`,
				`    • a text input (name: "name"; disabled when current name is not optimistic name)`,
				"    • if error is set, a paragraph showing error",
				"",
				"DesignButton, a component:",
				"  From the status of the form this is inside, take pending.",
				"  Show a submit button (disabled when pending is set).",
			].join("\n"),
		);
	});

	test("use() on a promise, Suspense and lazy", () => {
		expect(
			read(`import { use, Suspense, lazy } from "react";
const MarkdownPreview = lazy(() => import("./MarkdownPreview.js"));
function Message({ messagePromise }) {
  const content = use(messagePromise);
  return <p>Here is the message: {content}</p>;
}
export function Page() {
  return (
    <Suspense fallback={<p>⌛Downloading message...</p>}>
      <Message messagePromise={messagePromise} />
    </Suspense>
  );
}`),
		).toBe(
			[
				`Let markdown preview be the component from "./MarkdownPreview.js", loaded the first time it is shown.`,
				"",
				"Message, a component that takes message promise:",
				"  Let content be the result of message promise, waiting for it to load.",
				`  Show a paragraph "Here is the message: {content}".`,
				"",
				`Page, a component that shows Message (message promise), showing a paragraph "⌛Downloading message..." while it loads.`,
			].join("\n"),
		);
	});
});

describe("react-dom", () => {
	test("createRoot and render", () => {
		expect(read(`import { createRoot } from "react-dom/client";\nconst root = createRoot(document.getElementById("root"));\nroot.render(<App />);`)).toBe(
			[`Let root be a React root in get document element by ID ("root").`, "Show App in root."].join("\n"),
		);
	});

	test("createPortal", () => {
		expect(read(`import { createPortal } from "react-dom";\nfunction Modal() {\n  return createPortal(<p>Hi</p>, document.body);\n}`)).toBe(
			`To modal:\n  Give back a paragraph "Hi", shown inside document's body.`,
		);
	});

	test("class components update state through setState", () => {
		expect(
			read(
				`import { Component } from "react";\nclass Counter extends Component {\n  increment() {\n    this.setState({ count: this.state.count + 1 });\n  }\n}`,
			),
		).toContain("Update the state: set count to this's state's count plus 1.");
	});
});

describe("guards", () => {
	test("files on other JSX libraries are left alone", () => {
		const code = `import { createSignal } from "solid-js";\nfunction Counter() {\n  const [count, setCount] = createSignal(0);\n  return <button onClick={() => setCount(count() + 1)}>{count()}</button>;\n}`;
		expect(narrate(code, { plugins, path: "x.tsx" })).toBe(narrate(code, { path: "x.tsx" }));
	});

	test("same-named functions from other libraries are not React's", () => {
		const code = `import { memo, use } from "./lib";\nimport { useQuery } from "@tanstack/react-query";\nconst x = memo(fn);\nconst y = use(z);\nconst items = rows.map((r) => r.id);`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});

	test("a use-prefixed helper in a plain TS file is not a hook call", () => {
		const code = `function useCache(key) {\n  return cache.get(key);\n}\nconst v = useCache("a");`;
		expect(narrate(code, { plugins })).toBe(narrate(code));
	});
});

describe("plugin", () => {
	test("the English phrasebook is complete", () => {
		expect(phrasebookGaps(en, { ...en })).toEqual({ missing: [], extra: [] });
	});

	test("declares the React versions it reads", () => {
		expect(react().library).toEqual({ name: "react", versions: ">=18 <20" });
	});
});
