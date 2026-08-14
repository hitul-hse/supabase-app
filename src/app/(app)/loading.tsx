import { PageLoadingSkeleton } from "@/components/LoadingSkeleton";

/** Streaming skeleton shown while any page in the (app) group loads its data. */
export default function Loading() {
  return <PageLoadingSkeleton rows={8} />;
}
