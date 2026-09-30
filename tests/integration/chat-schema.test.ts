import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, sql } from "@/db";
import { championAwards, groups, messages, reactions, users } from "@/db/schema";

async function seed() {
  const [group] = await db.insert(groups).values({ name: "Crew" }).returning();
  const [a, b] = await db
    .insert(users)
    .values([{ email: "a@example.com" }, { email: "b@example.com" }])
    .returning();
  return { group, a, b };
}

describe("chat / champions schema", () => {
  it("has the expected tables", async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'`;
    const names = rows.map((r) => r.tablename);
    for (const t of ["messages", "reactions", "champion_awards", "worker_heartbeats"]) {
      expect(names).toContain(t);
    }
  });

  it("keeps a message when its author is deleted (user_id set null)", async () => {
    const { group, a } = await seed();
    const [m] = await db
      .insert(messages)
      .values({ groupId: group.id, userId: a.id, kind: "text", body: "hi" })
      .returning();
    await db.delete(users).where(eq(users.id, a.id));
    const [after] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(after.userId).toBeNull();
    expect(after.body).toBe("hi");
  });

  it("allows system messages without a user and restricts kind", async () => {
    const { group } = await seed();
    await db.insert(messages).values({ groupId: group.id, kind: "champions", payload: { week: 1 } });
    await expect(
      db.insert(messages).values({ groupId: group.id, kind: "shout" as never }),
    ).rejects.toThrow();
  });

  it("deletes messages with their group, and their reactions with them", async () => {
    const { group, a } = await seed();
    const [m] = await db.insert(messages).values({ groupId: group.id, userId: a.id, kind: "text" }).returning();
    await db.insert(reactions).values({ messageId: m.id, userId: a.id, emoji: "🔥" });
    await db.delete(groups).where(eq(groups.id, group.id));
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(reactions)).toHaveLength(0);
  });

  it("reactions: primary key is (message, user, emoji) and emoji length is 1-16", async () => {
    const { group, a, b } = await seed();
    const [m] = await db.insert(messages).values({ groupId: group.id, userId: a.id, kind: "text" }).returning();
    await db.insert(reactions).values({ messageId: m.id, userId: a.id, emoji: "👍" });
    await expect(db.insert(reactions).values({ messageId: m.id, userId: a.id, emoji: "👍" })).rejects.toThrow();
    // Another emoji, or another user with the same emoji, is fine.
    await db.insert(reactions).values([
      { messageId: m.id, userId: a.id, emoji: "❤️" },
      { messageId: m.id, userId: b.id, emoji: "👍" },
    ]);
    await expect(db.insert(reactions).values({ messageId: m.id, userId: b.id, emoji: "" })).rejects.toThrow();
    await expect(
      db.insert(reactions).values({ messageId: m.id, userId: b.id, emoji: "x".repeat(17) }),
    ).rejects.toThrow();
    // Removing a user removes their reactions.
    await db.delete(users).where(eq(users.id, b.id));
    expect(await db.select().from(reactions)).toHaveLength(2);
  });

  it("champion_awards: one winner per group, week and category; message deletion nulls the link", async () => {
    const { group, a, b } = await seed();
    const [m] = await db.insert(messages).values({ groupId: group.id, kind: "champions" }).returning();
    const award = { groupId: group.id, weekStart: "2026-09-21", category: "sleep" as const };
    await db.insert(championAwards).values({ ...award, userId: a.id, value: 88.5, messageId: m.id });
    await expect(db.insert(championAwards).values({ ...award, userId: b.id })).rejects.toThrow();
    await db.insert(championAwards).values({ ...award, category: "steps", userId: b.id });
    await expect(
      db.insert(championAwards).values({ ...award, weekStart: "2026-09-28", category: "bogus" as never, userId: a.id }),
    ).rejects.toThrow();

    await db.delete(messages).where(eq(messages.id, m.id));
    const [row] = await db.select().from(championAwards).where(eq(championAwards.category, "sleep"));
    expect(row.messageId).toBeNull();

    // Deleting the winner removes the award.
    await db.delete(users).where(eq(users.id, a.id));
    expect(await db.select().from(championAwards)).toHaveLength(1);
  });

  it("has the (user_id, week_start) and (group_id, id desc) indexes", async () => {
    const rows = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'
        and tablename in ('messages', 'champion_awards')`;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("messages_group_id_id_idx");
    expect(names).toContain("champion_awards_user_week_idx");
    expect(names).toContain("champion_awards_group_week_category_idx");
  });
});
