import { auth } from "@/auth";
import { NextResponse } from "next/server";

const SALESFORCE_API_VERSION = "v60.0";

type Opportunity = {
  Id: string;
  Name: string;
  Amount: number | null;
  StageName: string;
  CloseDate: string;
  NextStep: string | null;
  LastActivityDate: string | null;
  IsClosed: boolean;
  Health_Score__c: number | null;
  Risk_Summary__c: string | null;
  Last_Scanned__c: string | null;
};

type SalesforceQueryResponse = {
  totalSize: number;
  done: boolean;
  records: Opportunity[];
};

type SalesforceError = {
  message?: string;
  errorCode?: string;
};

function getSalesforceErrorMessage(payload: unknown): string {
  if (Array.isArray(payload)) {
    const firstError = payload[0] as SalesforceError | undefined;

    return firstError?.message ?? "Salesforce returned an error";
  }

  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as SalesforceError).message;

    if (typeof message === "string") {
      return message;
    }
  }

  return "Salesforce returned an error";
}

export async function GET() {
  const session = await auth();

  if (
    !session ||
    session.error ||
    !session.accessToken ||
    !session.instanceUrl
  ) {
    return NextResponse.json(
      {
        error: session?.error ?? "Not authenticated",
      },
      { status: 401 },
    );
  }

  const soql = `
    SELECT
      Id,
      Name,
      Amount,
      StageName,
      CloseDate,
      NextStep,
      LastActivityDate,
      IsClosed,
      Health_Score__c,
      Risk_Summary__c,
      Last_Scanned__c
    FROM Opportunity
    WHERE IsClosed = false
    ORDER BY CloseDate ASC
    LIMIT 100
  `
    .replace(/\s+/g, " ")
    .trim();

  try {
    const apiUrl = new URL(
      `/services/data/${SALESFORCE_API_VERSION}/query`,
      session.instanceUrl,
    );

    apiUrl.searchParams.set("q", soql);

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const salesforceMessage =
        getSalesforceErrorMessage(payload);

      console.error("Salesforce opportunities request failed", {
        status: response.status,
        message: salesforceMessage,
      });

      if (response.status === 401) {
        return NextResponse.json(
          { error: "Salesforce session expired" },
          { status: 401 },
        );
      }

      return NextResponse.json(
        {
          error: "Unable to fetch Salesforce opportunities",
          details:
            process.env.NODE_ENV === "development"
              ? salesforceMessage
              : undefined,
        },
        { status: 502 },
      );
    }

    const data = payload as SalesforceQueryResponse;

    if (!Array.isArray(data.records)) {
      return NextResponse.json(
        { error: "Salesforce returned an unexpected response" },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        opportunities: data.records,
        totalSize: data.totalSize,
        done: data.done,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Opportunities API error", error);

    return NextResponse.json(
      { error: "Failed to fetch Salesforce opportunities" },
      { status: 500 },
    );
  }
}