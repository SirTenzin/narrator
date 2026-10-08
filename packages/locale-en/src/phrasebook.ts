import type { CorePhrases } from "@narrate/core";
import { calls } from "./phrases/calls";
import { conditions } from "./phrases/conditions";
import { declarations } from "./phrases/declarations";
import { expressions } from "./phrases/expressions";
import { statements } from "./phrases/statements";
import { types } from "./phrases/types";

export const phrases: CorePhrases = { expressions, calls, conditions, statements, declarations, types };
