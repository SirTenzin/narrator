import { createNarrator, renderText } from "@usenarrator/core";
import { typescript } from "@usenarrator/lang-ts";
import { oxcParser } from "@usenarrator/lang-ts/oxc";
import { en } from "@usenarrator/locale-en";

const narrator = createNarrator({ languages: [typescript({ parser: oxcParser })], locale: en });

const source = `
const MAX_RETRIES = 3;

export class Queue {
  jobs: Job[] = [];
  push(job: Job) {
    this.jobs.push(job);
  }
  next() {
    return this.jobs.shift();
  }
}
`;

for (const unit of narrator.fileNarrator("queue.ts").units(source, "queue.ts")) {
	console.log(`[${unit.key}] ${unit.title}`);
	console.log(renderText(unit.lines.map((l) => ({ ...l, d: l.d + 1 }))));
}
