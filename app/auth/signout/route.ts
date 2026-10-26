import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicOrigin } from "@/lib/request-origin";

async function handleSignOut(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore sign-out errors and still redirect cleanly to /login
  }
  const origin = getPublicOrigin(request);
  return NextResponse.redirect(new URL("/login", origin), { status: 303 });
}

export async function POST(request: NextRequest) {
  return handleSignOut(request);
}

export async function GET(request: NextRequest) {
  return handleSignOut(request);
}
