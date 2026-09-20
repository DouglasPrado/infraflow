import type { Category } from "@infraflow/schema";
import type { CatalogItem } from "./types.ts";
export declare const CATALOG: CatalogItem[];
/** PRD §10 — ordem e rótulo das seções da Component Library. */
export declare const LIBRARY_SECTIONS: {
    category: Category;
    label: string;
}[];
export declare function getCatalogItem(type: string): CatalogItem | undefined;
/** Tipo especial do Load Generator (PRD §15). Não vive no catálogo de recursos. */
export declare const LOAD_GENERATOR_TYPE = "testing.load-generator";
//# sourceMappingURL=catalog.d.ts.map