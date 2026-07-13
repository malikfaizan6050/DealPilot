import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await auth();

  if (!session || session.error || !session.accessToken || !session.instanceUrl) {
    return NextResponse.json({ error: session?.error || "Not Authenticated" }, { status: 401 });
  }

  try {
    const query = encodeURIComponent(`SELECT Id, Name, Company, Email, Status FROM Lead WHERE Id = '${id}'`);
    const apiURL = `${session.instanceUrl}/services/data/v60.0/query?q=${query}`;

    const response = await fetch(apiURL, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });

    if (response.status === 401) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}