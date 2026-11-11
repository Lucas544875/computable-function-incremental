import { BASE_CATALOG, type CatalogFn, TIERS } from "../core/catalog";
import { COURSE_CATALOG, COURSE_TIERS } from "../course/catalog";

export const ALL_CATALOG: CatalogFn[] = [...BASE_CATALOG, ...COURSE_CATALOG];
export const CATALOG = new Map(ALL_CATALOG.map((c) => [c.id, c]));
export const ALL_TIERS = [...TIERS, ...COURSE_TIERS];
