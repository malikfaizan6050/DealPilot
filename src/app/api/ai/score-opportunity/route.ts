import { auth } from "@/auth";
import {
  scoreOpportunity,
  type OpportunityForScoring,
} from "@/lib/ai/score-opportunity";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SALESFORCE_API_VERSION = "v60.0";
const SALESFORCE_ID_PATTERN =
  /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

type ScoreRequestBody = {
  opportunityId?: unknown;
};

type SalesforceQueryResponse<T> = {
  totalSize?: number;
  done?: boolean;
  records?: T[];
};

type SalesforceError = {
  message?: string;
  errorCode?: string;
};

type AverageAmountRecord = {
  averageDealAmount?: number | null;
  expr0?: number | null;
};

function createQueryUrl(instanceUrl: string, soql: string) {
  const url = new URL(
    `/services/data/${SALESFORCE_API_VERSION}/query`,
    instanceUrl,
  );

  url.searchParams.set("q", soql);

  return url;
}

function createOpportunityUrl(
  instanceUrl: string,
  opportunityId: string,
) {
  return new URL(
    `/services/data/${SALESFORCE_API_VERSION}/sobjects/Opportunity/${opportunityId}`,
    instanceUrl,
  );
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function getSalesforceErrorMessage(payload: unknown) {
  if (Array.isArray(payload)) {
    const firstError = payload[0] as SalesforceError | undefined;

    return firstError?.message ?? "Salesforce returned an error.";
  }

  if (payload && typeof payload === "object") {
    const error = payload as SalesforceError;

    if (typeof error.message === "string") {
      return error.message;
    }
  }

  return "Salesforce returned an error.";
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown) {
  return value === null || typeof value === "number";
}

function isOpportunityForScoring(
  value: unknown,
): value is OpportunityForScoring {
  if (!value || typeof value !== "object") {
    return false;
  }

  const opportunity = value as Record<string, unknown>;

  return (
    typeof opportunity.Id === "string" &&
    typeof opportunity.Name === "string" &&
    isNullableNumber(opportunity.Amount) &&
    typeof opportunity.StageName === "string" &&
    typeof opportunity.CloseDate === "string" &&
    isNullableString(opportunity.NextStep) &&
    isNullableString(opportunity.LastActivityDate)
  );
}

function getAverageDealAmount(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as SalesforceQueryResponse<AverageAmountRecord>;
  const record = data.records?.[0];

  if (!record) {
    return null;
  }

  if (typeof record.averageDealAmount === "number") {
    return record.averageDealAmount;
  }

  if (typeof record.expr0 === "number") {
    return record.expr0;
  }

  return null;
}

export async function POST(request: Request) {
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

  let body: ScoreRequestBody;

  try {
    body = (await request.json()) as ScoreRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const opportunityId =
    typeof body.opportunityId === "string"
      ? body.opportunityId.trim()
      : "";

  if (!SALESFORCE_ID_PATTERN.test(opportunityId)) {
    return NextResponse.json(
      { error: "A valid Salesforce Opportunity ID is required." },
      { status: 400 },
    );
  }

  const opportunityQuery = `
    SELECT
      Id,
      Name,
      Amount,
      StageName,
      CloseDate,
      NextStep,
      LastActivityDate
    FROM Opportunity
    WHERE Id = '${opportunityId}'
    AND IsClosed = false
    LIMIT 1
  `
    .replace(/\s+/g, " ")
    .trim();

  const averageAmountQuery = `
    SELECT AVG(Amount) averageDealAmount
    FROM Opportunity
    WHERE IsClosed = false
    AND Amount != null
  `
    .replace(/\s+/g, " ")
    .trim();

  const salesforceHeaders = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: "application/json",
  };

  let opportunityResponse: Response;
  let averageAmountResponse: Response;

  try {
    [opportunityResponse, averageAmountResponse] = await Promise.all([
      fetch(
        createQueryUrl(session.instanceUrl, opportunityQuery),
        {
          method: "GET",
          headers: salesforceHeaders,
          cache: "no-store",
        },
      ),
      fetch(
        createQueryUrl(session.instanceUrl, averageAmountQuery),
        {
          method: "GET",
          headers: salesforceHeaders,
          cache: "no-store",
        },
      ),
    ]);
  } catch (error) {
    console.error(
      "Unable to connect to Salesforce while scoring",
      error instanceof Error ? error.message : "Unknown error",
    );

    return NextResponse.json(
      {
        error: "Unable to connect to Salesforce.",
      },
      { status: 502 },
    );
  }

  const [opportunityPayload, averageAmountPayload] =
    await Promise.all([
      readJson(opportunityResponse),
      readJson(averageAmountResponse),
    ]);

  if (!opportunityResponse.ok) {
    const message = getSalesforceErrorMessage(opportunityPayload);

    console.error("Salesforce Opportunity lookup failed", {
      status: opportunityResponse.status,
      opportunityId,
      message,
    });

    if (opportunityResponse.status === 401) {
      return NextResponse.json(
        { error: "Salesforce session expired." },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        error: "Unable to retrieve the Salesforce Opportunity.",
        details:
          process.env.NODE_ENV === "development"
            ? message
            : undefined,
      },
      { status: 502 },
    );
  }

  const opportunityData =
    opportunityPayload as SalesforceQueryResponse<unknown>;

  const opportunity = opportunityData.records?.[0];

  if (!opportunity) {
    return NextResponse.json(
      {
        error: "Open Opportunity not found.",
      },
      { status: 404 },
    );
  }

  if (!isOpportunityForScoring(opportunity)) {
    console.error(
      "Salesforce returned an invalid Opportunity structure",
      { opportunityId },
    );

    return NextResponse.json(
      {
        error:
          "Salesforce returned an unexpected Opportunity response.",
      },
      { status: 502 },
    );
  }

  let averageDealAmount: number | null = null;

  if (averageAmountResponse.ok) {
    averageDealAmount = getAverageDealAmount(
      averageAmountPayload,
    );
  } else {
    console.error("Salesforce average amount query failed", {
      status: averageAmountResponse.status,
      opportunityId,
    });
  }

  let score;

  try {
    score = await scoreOpportunity(opportunity, {
      averageDealAmount,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown AI scoring error";

    console.error("Local AI scoring failed", {
      opportunityId,
      message,
    });

    return NextResponse.json(
      {
        error:
          "The local AI scoring service is currently unavailable.",
        details:
          process.env.NODE_ENV === "development"
            ? message
            : undefined,
      },
      { status: 503 },
    );
  }

  const lastScannedAt = new Date().toISOString();

  let writeBackResponse: Response;

  try {
    writeBackResponse = await fetch(
      createOpportunityUrl(session.instanceUrl, opportunity.Id),
      {
        method: "PATCH",
        headers: {
          ...salesforceHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Health_Score__c: score.healthScore,
          Risk_Summary__c: score.summary,
          Last_Scanned__c: lastScannedAt,
        }),
        cache: "no-store",
      },
    );
  } catch (error) {
    console.error(
      "Unable to connect to Salesforce during AI write-back",
      {
        opportunityId,
        message:
          error instanceof Error
            ? error.message
            : "Unknown write-back error",
      },
    );

    return NextResponse.json(
      {
        error:
          "The deal was analyzed, but the result could not be saved to Salesforce.",
      },
      { status: 502 },
    );
  }

  if (!writeBackResponse.ok) {
    const writeBackPayload = await readJson(writeBackResponse);
    const message = getSalesforceErrorMessage(writeBackPayload);

    console.error("Salesforce AI write-back failed", {
      status: writeBackResponse.status,
      opportunityId,
      message,
    });

    if (writeBackResponse.status === 401) {
      return NextResponse.json(
        { error: "Salesforce session expired." },
        { status: 401 },
      );
    }

    if (writeBackResponse.status === 403) {
      return NextResponse.json(
        {
          error:
            "Salesforce denied permission to update the AI fields.",
          details:
            process.env.NODE_ENV === "development"
              ? message
              : undefined,
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        error:
          "The deal was analyzed, but the result could not be saved to Salesforce.",
        details:
          process.env.NODE_ENV === "development"
            ? message
            : undefined,
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      opportunityId: opportunity.Id,
      score,
      writeBack: {
        success: true,
        lastScannedAt,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}