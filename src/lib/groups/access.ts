import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { getMemberGroup } from "@/lib/groups/queries";

/**
 * Membership check for group routes, deduped per request (the `[id]` layout
 * runs it before anything streams, so a non-member gets a real 404 status;
 * the page repeats it because layouts don't re-run on client navigation).
 */
export const memberGroup = cache((groupId: string, userId: string) => getMemberGroup(db, groupId, userId));
