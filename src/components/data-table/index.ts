/**
 * Barrel for the shared table primitive, so call sites can import from
 * "@/components/data-table" without knowing the file layout inside.
 */
export {
  DataTable,
  cmpNum,
  cmpText,
  DEFAULT_MAX_BODY_HEIGHT,
  type Align,
  type Column,
  type Density,
  type PageSize,
} from "./DataTable";
