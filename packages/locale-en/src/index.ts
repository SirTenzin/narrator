import type { Locale } from "@usenarrator/core";
import { grammar } from "./grammar";
import { phrases } from "./phrasebook";

export const en: Locale = { id: "en", grammar, phrases };
export { grammar, phrases };
