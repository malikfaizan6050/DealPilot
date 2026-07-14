"use client";

import { useState } from "react";

type RiskLevel = "low" | "medium" | "high";

type OpportunityScore = {
  healthScore: number;
  riskLevel: RiskLevel;
  summary: string;
  nextAction: string;
};

type DisplayedScore = {
  healthScore: number;
  riskLevel: RiskLevel;
  summary: string;
  nextAction: string | null;
  lastScannedAt: string | null;
};

type ScoreOpportunityResponse = {
  opportunityId?: string;
  score?: OpportunityScore;
  writeBack?: {
    success?: boolean;
    lastScannedAt?: string;
  };
  error?: string;
  details?: string;
};

type OpportunityScoreButtonProps = {
  opportunityId: string;
  opportunityName: string;
  initialHealthScore?: number | null;
  initialRiskSummary?: string | null;
  initialLastScanned?: string | null;
};

const riskStyles: Record<
  RiskLevel,
  {
    label: string;
    badge: string;
    panel: string;
    score: string;
  }
> = {
  low: {
    label: "Low risk",
    badge:
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    panel: "border-emerald-200 bg-emerald-50/60",
    score: "text-emerald-700",
  },
  medium: {
    label: "Medium risk",
    badge:
      "border-amber-200 bg-amber-50 text-amber-700",
    panel: "border-amber-200 bg-amber-50/60",
    score: "text-amber-700",
  },
  high: {
    label: "High risk",
    badge: "border-red-200 bg-red-50 text-red-700",
    panel: "border-red-200 bg-red-50/60",
    score: "text-red-700",
  },
};

function getRiskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return "low";
  }

  if (score >= 45) {
    return "medium";
  }

  return "high";
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high"
  );
}

function isOpportunityScore(
  value: unknown,
): value is OpportunityScore {
  if (!value || typeof value !== "object") {
    return false;
  }

  const score = value as Record<string, unknown>;

  return (
    typeof score.healthScore === "number" &&
    Number.isInteger(score.healthScore) &&
    score.healthScore >= 0 &&
    score.healthScore <= 100 &&
    isRiskLevel(score.riskLevel) &&
    typeof score.summary === "string" &&
    score.summary.trim().length > 0 &&
    typeof score.nextAction === "string" &&
    score.nextAction.trim().length > 0
  );
}

function createInitialScore(
  healthScore?: number | null,
  summary?: string | null,
  lastScannedAt?: string | null,
): DisplayedScore | null {
  if (
    typeof healthScore !== "number" ||
    !Number.isFinite(healthScore) ||
    healthScore < 0 ||
    healthScore > 100
  ) {
    return null;
  }

  return {
    healthScore,
    riskLevel: getRiskLevel(healthScore),
    summary:
      summary?.trim() ||
      "This score was previously saved in Salesforce.",
    nextAction: null,
    lastScannedAt: lastScannedAt ?? null,
  };
}

function formatLastScanned(value: string) {
  const normalized = value.replace(
    /([+-]\d{2})(\d{2})$/,
    "$1:$2",
  );

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(
  data: ScoreOpportunityResponse,
) {
  return (
    data.error ??
    data.details ??
    "Unable to score this Opportunity."
  );
}

export function OpportunityScoreButton({
  opportunityId,
  opportunityName,
  initialHealthScore,
  initialRiskSummary,
  initialLastScanned,
}: OpportunityScoreButtonProps) {
  const [score, setScore] =
    useState<DisplayedScore | null>(() =>
      createInitialScore(
        initialHealthScore,
        initialRiskSummary,
        initialLastScanned,
      ),
    );

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );

  async function handleScoreOpportunity() {
    if (loading) {
      return;
    }

    const controller = new AbortController();

    const timeout = window.setTimeout(() => {
      controller.abort();
    }, 120_000);

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/ai/score-opportunity",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            opportunityId,
          }),
          signal: controller.signal,
        },
      );

      const responseText = await response.text();

      let data: ScoreOpportunityResponse;

      try {
        data = JSON.parse(
          responseText,
        ) as ScoreOpportunityResponse;
      } catch {
        throw new Error(
          "The AI service returned an unexpected response.",
        );
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(data));
      }

      if (!isOpportunityScore(data.score)) {
        throw new Error(
          "The AI service returned an invalid deal score.",
        );
      }

      if (data.writeBack?.success === false) {
        throw new Error(
          "The deal was analyzed, but the result was not saved to Salesforce.",
        );
      }

      setScore({
        healthScore: data.score.healthScore,
        riskLevel: data.score.riskLevel,
        summary: data.score.summary,
        nextAction: data.score.nextAction,
        lastScannedAt:
          data.writeBack?.lastScannedAt ??
          new Date().toISOString(),
      });
    } catch (requestError) {
      const isAbortError =
        requestError instanceof Error &&
        requestError.name === "AbortError";

      if (isAbortError) {
        setError(
          "The AI model took too long to respond. Make sure Ollama is running and try again.",
        );

        return;
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to score this Opportunity.",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  const riskStyle = score
    ? riskStyles[score.riskLevel]
    : null;

  return (
    <div className="min-w-72">
      <button
        type="button"
        onClick={handleScoreOpportunity}
        disabled={loading}
        aria-label={`Analyze ${opportunityName} with AI`}
        className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading
          ? "Analyzing deal..."
          : score
            ? "Analyze again"
            : "Analyze with AI"}
      </button>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700"
        >
          {error}
        </div>
      )}

      {score && riskStyle && (
        <article
          className={`mt-3 rounded-2xl border p-4 ${riskStyle.panel}`}
          aria-label={`AI deal score for ${opportunityName}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Deal health
              </p>

              <p
                className={`mt-1 text-3xl font-black ${riskStyle.score}`}
              >
                {score.healthScore}

                <span className="text-sm font-bold text-slate-400">
                  /100
                </span>
              </p>
            </div>

            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${riskStyle.badge}`}
            >
              {riskStyle.label}
            </span>
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Risk summary
            </p>

            <p className="mt-1 text-xs leading-5 text-slate-700">
              {score.summary}
            </p>
          </div>

          {score.nextAction && (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Next best action
              </p>

              <p className="mt-1 text-xs font-medium leading-5 text-slate-800">
                {score.nextAction}
              </p>
            </div>
          )}

          {score.lastScannedAt && (
            <p className="mt-4 border-t border-slate-200/70 pt-3 text-[10px] font-medium text-slate-500">
              Last scanned{" "}
              {formatLastScanned(
                score.lastScannedAt,
              )}
            </p>
          )}
        </article>
      )}
    </div>
  );
}