import { NextRequest, NextResponse } from "next/server";
import { resolveCreatorChangeRequest } from "@/app/actions/ads";

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const response = await resolveCreatorChangeRequest(payload);
  return NextResponse.json(response, { status: response.ok ? 200 : 400 });
}
