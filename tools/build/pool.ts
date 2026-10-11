import { availableParallelism } from "node:os";

/** Runs `fn` over `items` with at most `limit` in flight, keeping results in input order. */
export async function pool<T, R>({ items, fn, limit = availableParallelism() }: { items: T[]; fn: (item: T) => Promise<R>; limit?: number }): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i]!);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}
