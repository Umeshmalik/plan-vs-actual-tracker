/**
 * Categories — the canonical handler shape (auth -> parse -> repo -> respond).
 * Uniqueness is a DB index, enforced in ScopedRepo.createCategory, not here.
 */
import { NextResponse } from "next/server";
import { zCategoryCreate } from "@/domain/schemas";
import { withRoute } from "@/lib/route";

export const dynamic = "force-dynamic"; // per-user data, never cached

export const GET = withRoute(async (req, repo) => {
  const categories = await repo.listCategories();
  return NextResponse.json({ categories });
});

export const POST = withRoute(async (req, repo) => {
  const body = zCategoryCreate.parse(await req.json());
  const category = await repo.createCategory(body.name);
  return NextResponse.json({ category });
});
