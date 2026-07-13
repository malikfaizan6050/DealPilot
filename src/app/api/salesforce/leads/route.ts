import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await auth();
  console.log("SESSION:", session);

  if (!session || session.error || !session.accessToken || !session.instanceUrl) {
    return NextResponse.json({ error: session?.error || "Not Authenticated" }, { status: 401 });
  }

  try {
    // Sari leads lane wali query
    const query = encodeURIComponent("SELECT Id, Name, Company, Email, Status FROM Lead LIMIT 10");
    const apiURL = `${session.instanceUrl}/services/data/v60.0/query?q=${query}`;

    console.log("Salesforce leads request", {
      instanceUrl: session.instanceUrl,
      hasAccessToken: Boolean(session.accessToken),
      apiURL,
    });
    const identityResponse = await fetch(
      `${session.instanceUrl}/services/oauth2/userinfo`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      }
    );

    console.log("Identity Test:", {
      status: identityResponse.status,
      body: await identityResponse.text(),
    });
    const response = await fetch(apiURL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    console.log("Salesforce leads response", {
      status: response.status,
      ok: response.ok,
      totalSize: data?.totalSize,
      recordsLength: Array.isArray(data?.records) ? data.records.length : null,
      debug: data,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.message || "Salesforce returned an error", debug: data },
        { status: response.status }
      );
    }

    return NextResponse.json({ leads: data.records || [], debug: process.env.NODE_ENV !== "production" ? data : undefined });
  } catch (error) {
    console.error("Leads API error:", error);
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
  }
}