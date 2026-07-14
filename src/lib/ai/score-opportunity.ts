import "server-only";

export type RiskLevel = "low" | "medium" | "high";

export type OpportunityForScoring = {
  Id: string;
  Name: string;
  Amount: number | null;
  StageName: string;
  CloseDate: string;
  NextStep: string | null;
  LastActivityDate: string | null;
};

export type OpportunityScore = {
  healthScore: number;
  riskLevel: RiskLevel;
  summary: string;
  nextAction: string;
};

export type OpportunityScoringContext = {
  averageDealAmount?: number | null;
  daysInCurrentStage?: number | null;
  currentDate?: Date;
};

type OllamaGenerateResponse = {
  response?: string;
  done?: boolean;
  error?: string;
};

type DealSignals = {
  currentDate: string;
  daysUntilClose: number | null;
  daysSinceLastActivity: number | null;
  hasNextStep: boolean;
  daysInCurrentStage: number | null;
  averageDealAmount: number | null;
  isHighValueDeal: boolean;
  isLateStage: boolean;
};

type DeterministicAssessment = {
  healthScore: number;
  riskLevel: RiskLevel;
  signals: DealSignals;
  findings: string[];
};

type NarrativeResponse = {
  summary: string;
  nextAction: string;
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const LATE_STAGE_NAMES = new Set([
  "Value Proposition",
  "Id. Decision Makers",
  "Perception Analysis",
  "Proposal/Price Quote",
  "Negotiation/Review",
]);

const narrativeSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 400,
    },
    nextAction: {
      type: "string",
      minLength: 1,
      maxLength: 400,
    },
  },
  required: ["summary", "nextAction"],
  additionalProperties: false,
} as const;

function parseSalesforceDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toUtcDay(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

function differenceInDays(laterDate: Date, earlierDate: Date): number {
  return Math.round(
    (toUtcDay(laterDate) - toUtcDay(earlierDate)) /
      DAY_IN_MILLISECONDS,
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRiskLevel(healthScore: number): RiskLevel {
  if (healthScore >= 75) {
    return "low";
  }

  if (healthScore >= 45) {
    return "medium";
  }

  return "high";
}

function buildSignals(
  opportunity: OpportunityForScoring,
  context: OpportunityScoringContext,
): DealSignals {
  const currentDate = context.currentDate ?? new Date();
  const closeDate = parseSalesforceDate(opportunity.CloseDate);

  const lastActivityDate = opportunity.LastActivityDate
    ? parseSalesforceDate(opportunity.LastActivityDate)
    : null;

  const averageDealAmount = context.averageDealAmount ?? null;

  const isHighValueDeal =
    opportunity.Amount !== null &&
    averageDealAmount !== null &&
    averageDealAmount > 0 &&
    opportunity.Amount >= averageDealAmount * 1.5;

  return {
    currentDate: currentDate.toISOString().slice(0, 10),
    daysUntilClose: closeDate
      ? differenceInDays(closeDate, currentDate)
      : null,
    daysSinceLastActivity: lastActivityDate
      ? differenceInDays(currentDate, lastActivityDate)
      : null,
    hasNextStep: Boolean(opportunity.NextStep?.trim()),
    daysInCurrentStage: context.daysInCurrentStage ?? null,
    averageDealAmount,
    isHighValueDeal,
    isLateStage: LATE_STAGE_NAMES.has(opportunity.StageName),
  };
}

function calculateAssessment(
  opportunity: OpportunityForScoring,
  context: OpportunityScoringContext,
): DeterministicAssessment {
  const signals = buildSignals(opportunity, context);
  const findings: string[] = [];

  let score = 100;

  if (signals.daysUntilClose === null) {
    score -= 15;
    findings.push("The close-date timing could not be evaluated.");
  } else if (signals.daysUntilClose < 0) {
    score -= 35;
    findings.push(
      `The close date is overdue by ${Math.abs(
        signals.daysUntilClose,
      )} days.`,
    );

    if (signals.daysUntilClose < -30) {
      score -= 10;
      findings.push("The close date has been overdue for more than 30 days.");
    }
  } else {
    findings.push(
      `The close date is ${signals.daysUntilClose} days away.`,
    );

    if (signals.daysUntilClose <= 7) {
      score -= 8;
      findings.push("The close date is within the next seven days.");
    } else if (signals.daysUntilClose <= 14) {
      score -= 4;
      findings.push("The close date is within the next two weeks.");
    }
  }

  if (signals.daysSinceLastActivity === null) {
    score -= 25;
    findings.push("No completed Salesforce activity is recorded.");
  } else if (signals.daysSinceLastActivity > 30) {
    score -= 25;
    findings.push(
      `The last recorded activity was ${signals.daysSinceLastActivity} days ago.`,
    );
  } else if (signals.daysSinceLastActivity > 14) {
    score -= 15;
    findings.push(
      `The last recorded activity was ${signals.daysSinceLastActivity} days ago.`,
    );
  } else if (signals.daysSinceLastActivity > 7) {
    score -= 8;
    findings.push(
      `The last recorded activity was ${signals.daysSinceLastActivity} days ago.`,
    );
  } else {
    findings.push(
      `The deal had activity ${signals.daysSinceLastActivity} days ago.`,
    );
  }

  if (!signals.hasNextStep) {
    score -= 20;
    findings.push("The Opportunity does not have a next step.");
  } else {
    findings.push("The Opportunity has a documented next step.");
  }

  if (
    signals.daysInCurrentStage !== null &&
    signals.daysInCurrentStage > 30
  ) {
    score -= signals.daysInCurrentStage > 60 ? 15 : 8;
    findings.push(
      `The deal has remained in its current stage for ${signals.daysInCurrentStage} days.`,
    );
  }

  if (
    signals.daysUntilClose !== null &&
    signals.daysUntilClose <= 14 &&
    signals.daysUntilClose >= 0 &&
    signals.daysSinceLastActivity === null
  ) {
    score -= 8;
    findings.push(
      "The close date is approaching without a recorded activity.",
    );
  }

  if (
    signals.isLateStage &&
    !signals.hasNextStep
  ) {
    score -= 8;
    findings.push(
      "A late-stage Opportunity is missing a concrete next step.",
    );
  }

  if (
    signals.isHighValueDeal &&
    (signals.daysSinceLastActivity === null ||
      !signals.hasNextStep)
  ) {
    score -= 5;
    findings.push(
      "This is a high-value deal with unresolved execution risk.",
    );
  }

  if (
    signals.daysSinceLastActivity === null &&
    !signals.hasNextStep
  ) {
    score -= 7;
    findings.push(
      "Both activity history and next-step information are missing.",
    );
  }

  const healthScore = clampScore(score);

  return {
    healthScore,
    riskLevel: getRiskLevel(healthScore),
    signals,
    findings,
  };
}

function validateNarrative(value: unknown): NarrativeResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Ollama returned an invalid narrative object.");
  }

  const result = value as Record<string, unknown>;

  if (
    typeof result.summary !== "string" ||
    result.summary.trim().length === 0
  ) {
    throw new Error("Ollama returned an invalid summary.");
  }

  if (
    typeof result.nextAction !== "string" ||
    result.nextAction.trim().length === 0
  ) {
    throw new Error("Ollama returned an invalid next action.");
  }

  return {
    summary: result.summary.trim(),
    nextAction: result.nextAction.trim(),
  };
}

function containsContradiction(
  narrative: NarrativeResponse,
  assessment: DeterministicAssessment,
): boolean {
  const text =
    `${narrative.summary} ${narrative.nextAction}`.toLowerCase();

  if (
    assessment.signals.daysUntilClose !== null &&
    assessment.signals.daysUntilClose >= 0 &&
    (text.includes("overdue") ||
      text.includes("past due") ||
      text.includes("close date has passed"))
  ) {
    return true;
  }

  if (
    assessment.signals.hasNextStep &&
    (text.includes("missing next step") ||
      text.includes("no next step") ||
      text.includes("next step is missing"))
  ) {
    return true;
  }

  if (
    assessment.signals.daysSinceLastActivity !== null &&
    (text.includes("no activity") ||
      text.includes("without activity") ||
      text.includes("missing activity"))
  ) {
    return true;
  }

  return false;
}

function buildFallbackNarrative(
  opportunity: OpportunityForScoring,
  assessment: DeterministicAssessment,
): NarrativeResponse {
  const strongestFindings = assessment.findings.slice(0, 3).join(" ");

  let nextAction: string;

  if (!assessment.signals.hasNextStep) {
    nextAction =
      "Add a specific next step with an owner and target date, then confirm it with the buyer.";
  } else if (
    assessment.signals.daysSinceLastActivity === null ||
    assessment.signals.daysSinceLastActivity > 14
  ) {
    nextAction =
      "Contact the buyer, confirm the current status, and record the outcome as a Salesforce activity.";
  } else if (
    assessment.signals.daysUntilClose !== null &&
    assessment.signals.daysUntilClose < 0
  ) {
    nextAction =
      "Confirm whether the deal is still active and update the close date, stage, and next step.";
  } else {
    nextAction =
      opportunity.NextStep?.trim() ??
      "Continue the documented next step and record the outcome in Salesforce.";
  }

  return {
    summary: `${opportunity.Name} is classified as ${assessment.riskLevel} risk with a health score of ${assessment.healthScore}/100. ${strongestFindings}`,
    nextAction,
  };
}

function getOllamaConfiguration() {
  const baseUrl = (
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
  ).replace(/\/+$/, "");

  const model = process.env.OLLAMA_MODEL ?? "llama3.2:3b";

  const configuredTimeout = Number(
    process.env.OLLAMA_TIMEOUT_MS ?? "90000",
  );

  const timeoutMilliseconds =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 90_000;

  return {
    baseUrl,
    model,
    timeoutMilliseconds,
  };
}

export async function scoreOpportunity(
  opportunity: OpportunityForScoring,
  context: OpportunityScoringContext = {},
): Promise<OpportunityScore> {
  const assessment = calculateAssessment(opportunity, context);

  const { baseUrl, model, timeoutMilliseconds } =
    getOllamaConfiguration();

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMilliseconds,
  );

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        system:
          "You write concise Salesforce deal-health explanations. The application has already calculated the score and risk level. Never recalculate or contradict them. Never claim a close date is overdue when daysUntilClose is zero or positive. Never claim a next step is missing when hasNextStep is true. Never claim there is no activity when daysSinceLastActivity is a number.",
        prompt: JSON.stringify(
          {
            task:
              "Write a short risk summary and a practical next action for this Salesforce Opportunity.",
            fixedAssessment: {
              healthScore: assessment.healthScore,
              riskLevel: assessment.riskLevel,
            },
            opportunity: {
              name: opportunity.Name,
              amount: opportunity.Amount,
              stage: opportunity.StageName,
              closeDate: opportunity.CloseDate,
              lastActivityDate: opportunity.LastActivityDate,
              nextStep: opportunity.NextStep,
            },
            verifiedSignals: assessment.signals,
            verifiedFindings: assessment.findings,
            requirements: [
              "Accept the supplied score and risk level as final.",
              "Use only the supplied facts.",
              "Do not invent missing CRM information.",
              "Keep the summary under three sentences.",
              "Make the next action specific and practical.",
            ],
          },
          null,
          2,
        ),
        format: narrativeSchema,
        stream: false,
        keep_alive: "5m",
        options: {
          temperature: 0,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload =
      (await response.json()) as OllamaGenerateResponse;

    if (!response.ok) {
      throw new Error(
        payload.error ??
          `Ollama request failed with status ${response.status}.`,
      );
    }

    if (!payload.response) {
      throw new Error("Ollama returned an empty response.");
    }

    let parsedResponse: unknown;

    try {
      parsedResponse = JSON.parse(payload.response);
    } catch {
      throw new Error("Ollama returned malformed JSON.");
    }

    const narrative = validateNarrative(parsedResponse);

    const safeNarrative = containsContradiction(
      narrative,
      assessment,
    )
      ? buildFallbackNarrative(opportunity, assessment)
      : narrative;

    return {
      healthScore: assessment.healthScore,
      riskLevel: assessment.riskLevel,
      summary: safeNarrative.summary,
      nextAction: safeNarrative.nextAction,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Ollama did not respond within ${timeoutMilliseconds}ms.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}