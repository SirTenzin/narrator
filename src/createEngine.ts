import { Engine } from "./engine";
import { autumn } from "./dialects/autumn";
import { common } from "./dialects/common";

export const createEngine = () => new Engine([common, autumn]);
