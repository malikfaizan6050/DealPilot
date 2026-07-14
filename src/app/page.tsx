"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { OpportunityScoreButton } from "@/components/ai/opportunity-score-button";

type RiskLevel = "high" | "medium" | "low" | "unscanned";
type RiskFilter = "all" | RiskLevel;
type SortOption = "risk" | "closing-soon" | "value-high";
type AttentionFilter =
  | "all"
  | "overdue"
  | "missing-next-step"
  | "no-activity"
  | "high-value";

type DashboardSection =
  | "overview"
  | "risk-radar"
  | "priority-deals"
  | "pipeline";

type IconName =
  | "activity"
  | "alert"
  | "arrow-right"
  | "briefcase"
  | "calendar"
  | "chart"
  | "check"
  | "chevron-down"
  | "clock"
  | "cloud"
  | "database"
  | "dollar"
  | "eye"
  | "filter"
  | "info"
  | "logout"
  | "menu"
  | "pipeline"
  | "radar"
  | "refresh"
  | "search"
  | "shield"
  | "sparkles"
  | "target"
  | "trend"
  | "x";

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

type OpportunitiesResponse = {
  opportunities?: Opportunity[];
  totalSize?: number;
  done?: boolean;
  error?: string;
  details?: string;
};

type ScanProgress = {
  completed: number;
  total: number;
  failed: number;
};

const riskFilters: Array<{
  value: RiskFilter;
  label: string;
}> = [
  { value: "all", label: "All deals" },
  { value: "high", label: "High risk" },
  { value: "medium", label: "Medium risk" },
  { value: "low", label: "Low risk" },
  { value: "unscanned", label: "Unscanned" },
];

const attentionFilters: Array<{
  value: AttentionFilter;
  label: string;
}> = [
  { value: "all", label: "All attention signals" },
  { value: "overdue", label: "Overdue close date" },
  { value: "missing-next-step", label: "Missing next step" },
  { value: "no-activity", label: "No activity" },
  { value: "high-value", label: "Above-average value" },
];

const riskSortOrder: Record<RiskLevel, number> = {
  high: 0,
  medium: 1,
  unscanned: 2,
  low: 3,
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCurrency(amount: number | null) {
  if (amount === null) {
    return "Not specified";
  }

  return currencyFormatter.format(amount);
}

function formatCompactCurrency(amount: number) {
  return compactCurrencyFormatter.format(amount);
}

function parseDateOnly(value: string) {
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (!year || !month || !day) {
    return new Date(value);
  }

  return new Date(year, month - 1, day);
}

function formatDate(date: string | null) {
  if (!date) {
    return "No activity";
  }

  const parsedDate = parseDateOnly(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsedDate);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRefreshTime(value: Date | null) {
  if (!value) {
    return "Not refreshed yet";
  }

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - value.getTime()) / 1000),
  );

  if (seconds < 10) {
    return "Refreshed just now";
  }

  if (seconds < 60) {
    return `Refreshed ${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `Refreshed ${minutes}m ago`;
  }

  return `Refreshed at ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value)}`;
}

function isOverdue(closeDate: string) {
  const date = parseDateOnly(closeDate);
  date.setHours(23, 59, 59, 999);

  return date.getTime() < Date.now();
}

function isClosingThisMonth(closeDate: string) {
  const closeDateValue = parseDateOnly(closeDate);
  const today = new Date();

  return (
    closeDateValue.getFullYear() === today.getFullYear() &&
    closeDateValue.getMonth() === today.getMonth()
  );
}

function getDaysFromToday(dateValue: string) {
  const date = parseDateOnly(dateValue);
  const today = new Date();

  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  return Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function formatCloseTiming(closeDate: string) {
  const days = getDaysFromToday(closeDate);

  if (days < 0) {
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  }

  if (days === 0) {
    return "Closes today";
  }

  return `${days} day${days === 1 ? "" : "s"} to close`;
}

function getRiskLevel(healthScore: number | null): RiskLevel {
  if (healthScore === null) {
    return "unscanned";
  }

  if (healthScore >= 75) {
    return "low";
  }

  if (healthScore >= 45) {
    return "medium";
  }

  return "high";
}

function getScanProgressPercentage(progress: ScanProgress) {
  if (progress.total === 0) {
    return 0;
  }

  return Math.round((progress.completed / progress.total) * 100);
}

function getRiskReasons(
  opportunity: Opportunity,
  averageDealAmount: number,
) {
  const reasons: string[] = [];
  const riskLevel = getRiskLevel(opportunity.Health_Score__c);

  if (riskLevel === "high") {
    reasons.push("AI health score is in the high-risk range");
  } else if (riskLevel === "medium") {
    reasons.push("AI health score requires seller attention");
  }

  if (isOverdue(opportunity.CloseDate)) {
    reasons.push(`Close date is ${formatCloseTiming(opportunity.CloseDate)}`);
  }

  if (!opportunity.NextStep?.trim()) {
    reasons.push("No next step is recorded");
  }

  if (!opportunity.LastActivityDate) {
    reasons.push("No activity is recorded");
  } else {
    const activityAge = Math.abs(getDaysFromToday(opportunity.LastActivityDate));

    if (getDaysFromToday(opportunity.LastActivityDate) < -30) {
      reasons.push(`Last activity was ${activityAge} days ago`);
    }
  }

  if (
    averageDealAmount > 0 &&
    (opportunity.Amount ?? 0) > averageDealAmount
  ) {
    reasons.push("Deal value is above the portfolio average");
  }

  if (reasons.length === 0) {
    reasons.push("No critical risk signals detected");
  }

  return reasons;
}

function getPriorityScore(
  opportunity: Opportunity,
  averageDealAmount: number,
) {
  const riskLevel = getRiskLevel(opportunity.Health_Score__c);
  let score = 0;

  if (riskLevel === "high") {
    score += 100;
  } else if (riskLevel === "medium") {
    score += 60;
  } else if (riskLevel === "unscanned") {
    score += 35;
  }

  if (isOverdue(opportunity.CloseDate)) {
    score += 40;
  }

  if (!opportunity.NextStep?.trim()) {
    score += 25;
  }

  if (!opportunity.LastActivityDate) {
    score += 20;
  }

  if (
    averageDealAmount > 0 &&
    (opportunity.Amount ?? 0) > averageDealAmount
  ) {
    score += 10;
  }

  return score;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && !session?.error;

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDataRefresh, setLastDataRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanAllLoading, setScanAllLoading] = useState(false);
  const [currentScanOpportunity, setCurrentScanOpportunity] =
    useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    completed: 0,
    total: 0,
    failed: 0,
  });
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [attentionFilter, setAttentionFilter] =
    useState<AttentionFilter>("all");
  const [closingThisMonthOnly, setClosingThisMonthOnly] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("risk");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOpportunity, setSelectedOpportunity] =
    useState<Opportunity | null>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<DashboardSection>("overview");

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    const controller = new AbortController();

    async function loadOpportunities() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/salesforce/opportunities", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });

        const data = (await response.json()) as OpportunitiesResponse;

        if (!response.ok) {
          setOpportunities([]);
          setError(
            data.error ?? "Unable to load Salesforce opportunities.",
          );

          if (response.status === 401) {
            await signOut({ callbackUrl: "/" });
          }

          return;
        }

        setOpportunities(data.opportunities ?? []);
        setLastDataRefresh(new Date());
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("Opportunity request failed", requestError);
        setOpportunities([]);
        setError("Unable to connect to the Opportunity API.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadOpportunities();

    return () => {
      controller.abort();
    };
  }, [signedIn]);

  useEffect(() => {
    if (!scanMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setScanMessage(null);
    }, 5_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [scanMessage]);

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    const sectionIds: DashboardSection[] = [
      "overview",
      "risk-radar",
      "priority-deals",
      "pipeline",
    ];

    const sections = sectionIds
      .map((sectionId) => document.getElementById(sectionId))
      .filter((section): section is HTMLElement => section !== null);

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (first, second) =>
              second.intersectionRatio - first.intersectionRatio,
          )[0];

        if (!visibleEntry) {
          return;
        }

        const nextSection = visibleEntry.target.id as DashboardSection;

        if (sectionIds.includes(nextSection)) {
          setActiveSection(nextSection);
        }
      },
      {
        rootMargin: "-88px 0px -62% 0px",
        threshold: [0.05, 0.2, 0.45],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
    };
  }, [signedIn]);

  const dashboardMetrics = useMemo(() => {
    let totalPipelineValue = 0;
    let overdueDeals = 0;
    let missingNextStep = 0;
    let noActivityDeals = 0;
    let highRiskDeals = 0;
    let mediumRiskDeals = 0;
    let lowRiskDeals = 0;
    let unscannedDeals = 0;
    let jeopardizedValue = 0;
    let closingThisMonthDeals = 0;

    for (const opportunity of opportunities) {
      const amount = opportunity.Amount ?? 0;
      const riskLevel = getRiskLevel(opportunity.Health_Score__c);

      totalPipelineValue += amount;

      if (isOverdue(opportunity.CloseDate)) {
        overdueDeals += 1;
      }

      if (!opportunity.NextStep?.trim()) {
        missingNextStep += 1;
      }

      if (!opportunity.LastActivityDate) {
        noActivityDeals += 1;
      }

      if (isClosingThisMonth(opportunity.CloseDate)) {
        closingThisMonthDeals += 1;
      }

      if (riskLevel === "high") {
        highRiskDeals += 1;
        jeopardizedValue += amount;
      }

      if (riskLevel === "medium") {
        mediumRiskDeals += 1;
        jeopardizedValue += amount;
      }

      if (riskLevel === "low") {
        lowRiskDeals += 1;
      }

      if (riskLevel === "unscanned") {
        unscannedDeals += 1;
      }
    }

    return {
      totalPipelineValue,
      averageDealAmount:
        opportunities.length > 0
          ? totalPipelineValue / opportunities.length
          : 0,
      overdueDeals,
      missingNextStep,
      noActivityDeals,
      highRiskDeals,
      mediumRiskDeals,
      lowRiskDeals,
      unscannedDeals,
      atRiskDeals: highRiskDeals + mediumRiskDeals,
      jeopardizedValue,
      closingThisMonthDeals,
      scannedDeals: opportunities.length - unscannedDeals,
    };
  }, [opportunities]);

  const priorityOpportunities = useMemo(() => {
    return [...opportunities]
      .sort(
        (first, second) =>
          getPriorityScore(
            second,
            dashboardMetrics.averageDealAmount,
          ) -
          getPriorityScore(
            first,
            dashboardMetrics.averageDealAmount,
          ),
      )
      .slice(0, 3);
  }, [opportunities, dashboardMetrics.averageDealAmount]);

  const visibleOpportunities = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    const filtered = opportunities.filter((opportunity) => {
      const riskLevel = getRiskLevel(opportunity.Health_Score__c);
      const matchesRisk =
        riskFilter === "all" || riskLevel === riskFilter;
      const matchesMonth =
        !closingThisMonthOnly ||
        isClosingThisMonth(opportunity.CloseDate);
      const matchesSearch =
        normalizedSearch.length === 0 ||
        opportunity.Name.toLowerCase().includes(normalizedSearch) ||
        opportunity.Id.toLowerCase().includes(normalizedSearch) ||
        opportunity.StageName.toLowerCase().includes(normalizedSearch) ||
        opportunity.NextStep?.toLowerCase().includes(normalizedSearch);

      let matchesAttention = true;

      if (attentionFilter === "overdue") {
        matchesAttention = isOverdue(opportunity.CloseDate);
      } else if (attentionFilter === "missing-next-step") {
        matchesAttention = !opportunity.NextStep?.trim();
      } else if (attentionFilter === "no-activity") {
        matchesAttention = !opportunity.LastActivityDate;
      } else if (attentionFilter === "high-value") {
        matchesAttention =
          (opportunity.Amount ?? 0) >
          dashboardMetrics.averageDealAmount;
      }

      return (
        matchesRisk &&
        matchesMonth &&
        matchesSearch &&
        matchesAttention
      );
    });

    return [...filtered].sort((first, second) => {
      const firstRisk = getRiskLevel(first.Health_Score__c);
      const secondRisk = getRiskLevel(second.Health_Score__c);

      if (sortOption === "closing-soon") {
        const dateDifference =
          parseDateOnly(first.CloseDate).getTime() -
          parseDateOnly(second.CloseDate).getTime();

        if (dateDifference !== 0) {
          return dateDifference;
        }

        return riskSortOrder[firstRisk] - riskSortOrder[secondRisk];
      }

      if (sortOption === "value-high") {
        const amountDifference =
          (second.Amount ?? 0) - (first.Amount ?? 0);

        if (amountDifference !== 0) {
          return amountDifference;
        }

        return riskSortOrder[firstRisk] - riskSortOrder[secondRisk];
      }

      const riskDifference =
        riskSortOrder[firstRisk] - riskSortOrder[secondRisk];

      if (riskDifference !== 0) {
        return riskDifference;
      }

      const firstScore = first.Health_Score__c ?? 101;
      const secondScore = second.Health_Score__c ?? 101;

      if (firstScore !== secondScore) {
        return firstScore - secondScore;
      }

      return (
        parseDateOnly(first.CloseDate).getTime() -
        parseDateOnly(second.CloseDate).getTime()
      );
    });
  }, [
    opportunities,
    riskFilter,
    attentionFilter,
    closingThisMonthOnly,
    sortOption,
    searchQuery,
    dashboardMetrics.averageDealAmount,
  ]);

  const riskFilterCounts: Record<RiskFilter, number> = {
    all: opportunities.length,
    high: dashboardMetrics.highRiskDeals,
    medium: dashboardMetrics.mediumRiskDeals,
    low: dashboardMetrics.lowRiskDeals,
    unscanned: dashboardMetrics.unscannedDeals,
  };

  const mostRecentScan = useMemo(() => {
    return opportunities.reduce<string | null>(
      (latest, opportunity) => {
        const value = opportunity.Last_Scanned__c;

        if (!value) {
          return latest;
        }

        if (!latest) {
          return value;
        }

        return new Date(value).getTime() >
          new Date(latest).getTime()
          ? value
          : latest;
      },
      null,
    );
  }, [opportunities]);

  async function refreshOpportunities() {
    const response = await fetch("/api/salesforce/opportunities", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    const data = (await response.json()) as OpportunitiesResponse;

    if (!response.ok) {
      if (response.status === 401) {
        await signOut({ callbackUrl: "/" });
        return;
      }

      throw new Error(
        data.error ??
          "Unable to refresh Salesforce opportunities.",
      );
    }

    setOpportunities(data.opportunities ?? []);
    setLastDataRefresh(new Date());
  }

  async function handleRefresh() {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    setError(null);

    try {
      await refreshOpportunities();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to refresh Salesforce opportunities.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleScanAllDeals() {
    if (scanAllLoading || opportunities.length === 0) {
      return;
    }

    setScanAllLoading(true);
    setScanMessage(null);
    setError(null);

    let failed = 0;

    setScanProgress({
      completed: 0,
      total: opportunities.length,
      failed: 0,
    });

    try {
      for (
        let index = 0;
        index < opportunities.length;
        index += 1
      ) {
        const opportunity = opportunities[index];

        if (!opportunity) {
          continue;
        }

        setCurrentScanOpportunity(opportunity.Name);

        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => {
            controller.abort();
          }, 120_000);

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
                  opportunityId: opportunity.Id,
                }),
                signal: controller.signal,
              },
            );

            if (response.status === 401) {
              await signOut({ callbackUrl: "/" });
              return;
            }

            if (!response.ok) {
              failed += 1;
            }
          } finally {
            window.clearTimeout(timeout);
          }
        } catch (scanError) {
          console.error(
            `Failed to scan Opportunity ${opportunity.Id}`,
            scanError,
          );
          failed += 1;
        }

        setScanProgress({
          completed: index + 1,
          total: opportunities.length,
          failed,
        });
      }

      await refreshOpportunities();

      setScanMessage(
        failed === 0
          ? `Successfully scanned ${opportunities.length} deals.`
          : `Scan completed. ${failed} deal${
              failed === 1 ? "" : "s"
            } failed.`,
      );
    } catch (scanError) {
      console.error(
        "Unable to finish the pipeline scan",
        scanError,
      );
      setScanMessage(
        scanError instanceof Error
          ? scanError.message
          : "The pipeline scan could not be completed.",
      );
    } finally {
      setCurrentScanOpportunity(null);
      setScanAllLoading(false);
    }
  }

  function resetPipelineView() {
    setRiskFilter("all");
    setAttentionFilter("all");
    setClosingThisMonthOnly(false);
    setSortOption("risk");
    setSearchQuery("");
  }

  function handleSignOut() {
    setOpportunities([]);
    setError(null);
    setLoading(false);
    setRefreshing(false);
    setScanAllLoading(false);
    setScanMessage(null);
    setRiskFilter("all");
    setAttentionFilter("all");
    setClosingThisMonthOnly(false);
    setSortOption("risk");
    setSearchQuery("");
    setSelectedOpportunity(null);
    setMobileNavigationOpen(false);
    setActiveSection("overview");

    void signOut({ callbackUrl: "/" });
  }

  if (status === "loading") {
    return <SessionLoadingScreen />;
  }

  if (!signedIn) {
    return <SignInScreen />;
  }

  const userLabel =
    session.user?.name ||
    session.user?.email ||
    "Salesforce user";
  const progressPercentage =
    getScanProgressPercentage(scanProgress);
  const hasActiveView =
    riskFilter !== "all" ||
    attentionFilter !== "all" ||
    closingThisMonthOnly ||
    sortOption !== "risk" ||
    searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <MobileNavigationOverlay
        open={mobileNavigationOpen}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onClose={() => setMobileNavigationOpen(false)}
        onSignOut={handleSignOut}
      />

      <OpportunityDetailDrawer
        opportunity={selectedOpportunity}
        averageDealAmount={dashboardMetrics.averageDealAmount}
        onClose={() => setSelectedOpportunity(null)}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <StatusToast
        message={scanMessage}
        onDismiss={() => setScanMessage(null)}
      />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-slate-800 bg-[#071426] text-white lg:flex">
        <SidebarContent
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onSignOut={handleSignOut}
        />
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 xl:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavigationOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 lg:hidden"
                aria-label="Open navigation"
              >
                <Icon name="menu" className="h-5 w-5" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <span>DealPilot AI</span>
                  <Icon
                    name="arrow-right"
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate text-slate-800">
                    Opportunity Command Center
                  </span>
                </div>
                <h1 className="mt-0.5 truncate text-lg font-bold tracking-tight text-slate-950 sm:text-xl">
                  Pipeline Intelligence
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0b5cab] disabled:cursor-not-allowed sm:flex"
              >
                <Icon
                  name="refresh"
                  className={`h-3.5 w-3.5 ${
                    refreshing ? "animate-spin" : ""
                  }`}
                />
                {formatRefreshTime(lastDataRefresh)}
              </button>

              <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 md:flex">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Salesforce connected
              </div>

              <div className="hidden h-8 w-px bg-slate-200 sm:block" />

              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b5cab] text-xs font-black text-white">
                  {userLabel.charAt(0).toUpperCase()}
                </div>
                <div className="hidden max-w-40 sm:block">
                  <p className="truncate text-xs font-bold text-slate-800">
                    {userLabel}
                  </p>
                  <p className="text-[10px] font-medium text-slate-400">
                    Salesforce workspace
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 py-5 sm:px-6 xl:px-8 xl:py-6">
          <div className="mx-auto max-w-[1600px]">
            <section
              id="overview"
              className="mb-5 flex scroll-mt-24 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"
            >
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#0b5cab]">
                  <Icon
                    name="sparkles"
                    className="h-3.5 w-3.5"
                  />
                  AI revenue operations
                </div>
                <h2 className="max-w-3xl text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-[36px] sm:leading-[1.08]">
                  See risk before it reaches the forecast.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">
                  Monitor every open opportunity, prioritize seller
                  attention, and write AI-generated health insights
                  directly back to Salesforce.
                </p>
              </div>

              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs shadow-sm">
                  <p className="font-semibold text-slate-400">
                    Last portfolio scan
                  </p>
                  <p className="mt-0.5 font-bold text-slate-700">
                    {formatDateTime(mostRecentScan)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleScanAllDeals}
                  disabled={
                    scanAllLoading || opportunities.length === 0
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0b5cab] px-5 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,92,171,0.22)] transition hover:bg-[#094f94] disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
                >
                  <Icon
                    name={scanAllLoading ? "refresh" : "sparkles"}
                    className={`h-4 w-4 ${
                      scanAllLoading ? "animate-spin" : ""
                    }`}
                  />
                  {scanAllLoading
                    ? `Scanning ${scanProgress.completed}/${scanProgress.total}`
                    : "Scan all deals"}
                </button>
              </div>
            </section>

            {error && (
              <div
                role="alert"
                className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100">
                  <Icon name="alert" className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-bold">
                    Unable to load pipeline
                  </p>
                  <p className="mt-1 text-red-600">{error}</p>
                </div>
              </div>
            )}

            {scanAllLoading && (
              <section className="mb-6 overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0b5cab]">
                      <Icon
                        name="radar"
                        className="h-5 w-5 animate-pulse"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        Analyzing opportunity portfolio
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {currentScanOpportunity
                          ? `Current deal: ${currentScanOpportunity}`
                          : "Writing scores and summaries back to Salesforce"}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-black text-[#0b5cab]">
                      {progressPercentage}%
                    </p>
                    <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                      {scanProgress.completed} completed ·{" "}
                      {scanProgress.failed} failed
                    </p>
                  </div>
                </div>
                <div className="h-1.5 bg-blue-50">
                  <div
                    className="h-full bg-[#0b5cab] transition-[width] duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </section>
            )}

            <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <MetricCard
                label="Open pipeline"
                value={
                  loading
                    ? "—"
                    : formatCompactCurrency(
                        dashboardMetrics.totalPipelineValue,
                      )
                }
                description={`${opportunities.length} active opportunities`}
                icon="pipeline"
                accent="blue"
                progress={
                  opportunities.length > 0
                    ? 100
                    : 0
                }
                progressLabel="Portfolio loaded"
                tooltip="Sum of Amount across every open Salesforce Opportunity currently loaded in the command center."
              />
              <MetricCard
                label="Deals at risk"
                value={
                  loading
                    ? "—"
                    : dashboardMetrics.atRiskDeals.toString()
                }
                description={`${dashboardMetrics.highRiskDeals} high · ${dashboardMetrics.mediumRiskDeals} medium`}
                icon="alert"
                accent="red"
                progress={
                  opportunities.length > 0
                    ? (dashboardMetrics.atRiskDeals /
                        opportunities.length) *
                      100
                    : 0
                }
                progressLabel="Share of open deals"
                tooltip="Open Opportunities with a saved health score below 75. Scores below 45 are high risk; scores from 45 to 74 are medium risk."
              />
              <MetricCard
                label="Value in jeopardy"
                value={
                  loading
                    ? "—"
                    : formatCompactCurrency(
                        dashboardMetrics.jeopardizedValue,
                      )
                }
                description="High and medium-risk value"
                icon="dollar"
                accent="amber"
                progress={
                  dashboardMetrics.totalPipelineValue > 0
                    ? (dashboardMetrics.jeopardizedValue /
                        dashboardMetrics.totalPipelineValue) *
                      100
                    : 0
                }
                progressLabel="Share of open pipeline"
                tooltip="Combined Amount of every high- and medium-risk Opportunity in the current open pipeline."
              />
              <MetricCard
                label="AI coverage"
                value={
                  loading
                    ? "—"
                    : `${dashboardMetrics.scannedDeals}/${opportunities.length}`
                }
                description={`${dashboardMetrics.unscannedDeals} awaiting analysis`}
                icon="sparkles"
                accent="violet"
                progress={
                  opportunities.length > 0
                    ? (dashboardMetrics.scannedDeals /
                        opportunities.length) *
                      100
                    : 0
                }
                progressLabel="Deals analyzed"
                tooltip="Open Opportunities that have a saved AI health score and Salesforce scan timestamp."
              />
            </section>

            <section
              id="risk-radar"
              className="mb-6 grid scroll-mt-24 gap-6 2xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.45fr)]"
            >
              <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
                <div className="border-b border-slate-100 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#071426] text-white">
                        <Icon name="radar" className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0b5cab]">
                          Risk radar
                        </p>
                        <h3 className="mt-0.5 text-lg font-black text-slate-950">
                          Portfolio exposure
                        </h3>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Jeopardized value
                      </p>
                      <p className="mt-0.5 text-lg font-black text-slate-900">
                        {formatCompactCurrency(
                          dashboardMetrics.jeopardizedValue,
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div>
                    <p className="max-w-xl text-2xl font-black tracking-[-0.02em] text-slate-950 sm:text-3xl">
                      {dashboardMetrics.atRiskDeals} deals need
                      attention now.
                    </p>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                      Select a signal below to turn portfolio
                      intelligence into an actionable pipeline view.
                    </p>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <InsightPill
                        label="High risk"
                        value={dashboardMetrics.highRiskDeals}
                        tone="red"
                        active={riskFilter === "high"}
                        onClick={() => {
                          setRiskFilter(
                            riskFilter === "high"
                              ? "all"
                              : "high",
                          );
                        }}
                      />
                      <InsightPill
                        label="Medium risk"
                        value={dashboardMetrics.mediumRiskDeals}
                        tone="amber"
                        active={riskFilter === "medium"}
                        onClick={() => {
                          setRiskFilter(
                            riskFilter === "medium"
                              ? "all"
                              : "medium",
                          );
                        }}
                      />
                      <InsightPill
                        label="Overdue"
                        value={dashboardMetrics.overdueDeals}
                        tone="orange"
                        active={attentionFilter === "overdue"}
                        onClick={() => {
                          setAttentionFilter(
                            attentionFilter === "overdue"
                              ? "all"
                              : "overdue",
                          );
                        }}
                      />
                      <InsightPill
                        label="Missing next step"
                        value={dashboardMetrics.missingNextStep}
                        tone="slate"
                        active={
                          attentionFilter === "missing-next-step"
                        }
                        onClick={() => {
                          setAttentionFilter(
                            attentionFilter ===
                              "missing-next-step"
                              ? "all"
                              : "missing-next-step",
                          );
                        }}
                      />
                    </div>
                  </div>

                  <RiskDonut
                    high={dashboardMetrics.highRiskDeals}
                    medium={dashboardMetrics.mediumRiskDeals}
                    low={dashboardMetrics.lowRiskDeals}
                    unscanned={dashboardMetrics.unscannedDeals}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-[#071426] p-5 text-white shadow-[0_12px_35px_rgba(7,20,38,0.18)] sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-blue-200">
                    <Icon name="target" className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                    This month
                  </span>
                </div>

                <p className="mt-6 text-4xl font-black tracking-[-0.04em]">
                  {dashboardMetrics.closingThisMonthDeals}
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  Deals scheduled to close
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Isolate near-term revenue and focus seller
                  follow-up on the opportunities closest to forecast.
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setClosingThisMonthOnly(
                      (current) => !current,
                    )
                  }
                  className="mt-6 inline-flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  {closingThisMonthOnly
                    ? "Show all close dates"
                    : "Focus this month"}
                  <Icon
                    name="arrow-right"
                    className="h-4 w-4"
                  />
                </button>
              </article>
            </section>

            <section
              id="priority-deals"
              className="mb-6 scroll-mt-24"
            >
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Icon
                      name="briefcase"
                      className="h-5 w-5 text-[#0b5cab]"
                    />
                    <h3 className="text-lg font-black text-slate-950">
                      Priority deals
                    </h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    The three opportunities with the strongest
                    combined risk and revenue signals.
                  </p>
                </div>
                <a
                  href="#pipeline"
                  className="inline-flex items-center gap-2 text-xs font-bold text-[#0b5cab] transition hover:text-[#094f94]"
                >
                  View full pipeline
                  <Icon
                    name="arrow-right"
                    className="h-3.5 w-3.5"
                  />
                </a>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                {priorityOpportunities.map(
                  (opportunity, index) => (
                    <PriorityDealCard
                      key={opportunity.Id}
                      opportunity={opportunity}
                      rank={index + 1}
                      averageDealAmount={
                        dashboardMetrics.averageDealAmount
                      }
                      onReview={() =>
                        setSelectedOpportunity(opportunity)
                      }
                    />
                  ),
                )}
              </div>
            </section>

            <section
              id="pipeline"
              className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]"
            >
              <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon
                        name="database"
                        className="h-5 w-5 text-[#0b5cab]"
                      />
                      <h3 className="text-lg font-black text-slate-950">
                        Opportunity pipeline
                      </h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Search, prioritize, and inspect live Salesforce
                      opportunities.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 xl:items-end">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <label className="relative min-w-0 sm:w-72">
                        <Icon
                          name="search"
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={(event) =>
                            setSearchQuery(event.target.value)
                          }
                          placeholder="Search name, stage, ID, or next step"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#0b5cab] focus:ring-2 focus:ring-blue-100"
                        />
                      </label>

                      <label className="relative">
                        <Icon
                          name="alert"
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        />
                        <select
                          value={attentionFilter}
                          onChange={(event) =>
                            setAttentionFilter(
                              event.target
                                .value as AttentionFilter,
                            )
                          }
                          className="h-10 min-w-52 appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-xs font-bold text-slate-700 outline-none transition hover:border-slate-300 focus:border-[#0b5cab] focus:ring-2 focus:ring-blue-100"
                        >
                          {attentionFilters.map((filter) => (
                            <option
                              key={filter.value}
                              value={filter.value}
                            >
                              {filter.label}
                            </option>
                          ))}
                        </select>
                        <Icon
                          name="chevron-down"
                          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                        />
                      </label>

                      <label className="relative">
                        <Icon
                          name="filter"
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        />
                        <select
                          value={sortOption}
                          onChange={(event) =>
                            setSortOption(
                              event.target.value as SortOption,
                            )
                          }
                          className="h-10 min-w-40 appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-xs font-bold text-slate-700 outline-none transition hover:border-slate-300 focus:border-[#0b5cab] focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="risk">
                            Highest risk
                          </option>
                          <option value="closing-soon">
                            Closing soon
                          </option>
                          <option value="value-high">
                            Highest value
                          </option>
                        </select>
                        <Icon
                          name="chevron-down"
                          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {riskFilters.map((filter) => {
                      const active =
                        riskFilter === filter.value;

                      return (
                        <button
                          key={filter.value}
                          type="button"
                          onClick={() =>
                            setRiskFilter(filter.value)
                          }
                          aria-pressed={active}
                          className={
                            active
                              ? "inline-flex items-center gap-2 rounded-lg border border-[#0b5cab] bg-[#0b5cab] px-3 py-2 text-xs font-bold text-white shadow-sm"
                              : "inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                          }
                        >
                          {filter.label}
                          <span
                            className={
                              active
                                ? "rounded-full bg-white/15 px-1.5 py-0.5 text-[10px]"
                                : "rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                            }
                          >
                            {riskFilterCounts[filter.value]}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="inline-flex cursor-pointer items-center gap-3 text-xs font-bold text-slate-600">
                      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
                        <input
                          type="checkbox"
                          checked={closingThisMonthOnly}
                          onChange={(event) =>
                            setClosingThisMonthOnly(
                              event.target.checked,
                            )
                          }
                          className="peer sr-only"
                        />
                        <span className="absolute inset-0 rounded-full bg-slate-200 transition peer-checked:bg-[#0b5cab]" />
                        <span className="relative ml-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4" />
                      </span>
                      Closing this month only
                    </label>

                    <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
                      <span>
                        Showing{" "}
                        <strong className="text-slate-800">
                          {visibleOpportunities.length}
                        </strong>{" "}
                        of {opportunities.length}
                      </span>
                      {hasActiveView && (
                        <button
                          type="button"
                          onClick={resetPipelineView}
                          className="font-bold text-[#0b5cab] transition hover:text-[#094f94]"
                        >
                          Reset view
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {loading ? (
                <OpportunityTableSkeleton />
              ) : opportunities.length === 0 ? (
                <EmptyState
                  icon="cloud"
                  title="No open opportunities found"
                  description="Add or reopen Opportunity records in Salesforce, then refresh this dashboard."
                />
              ) : visibleOpportunities.length === 0 ? (
                <EmptyState
                  icon="search"
                  title="No deals match this view"
                  description="Change the search, risk filter, attention signal, or close-date filter."
                  actionLabel="Reset filters"
                  onAction={resetPipelineView}
                />
              ) : (
                <div className="max-h-[760px] overflow-auto">
                  <table className="min-w-[1320px] w-full text-left">
                    <thead className="sticky top-0 z-10 bg-[#f8fafc] shadow-[0_1px_0_rgba(226,232,240,1)]">
                      <tr className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                        <th className="px-6 py-3.5">
                          Opportunity
                        </th>
                        <th className="px-5 py-3.5">Amount</th>
                        <th className="px-5 py-3.5">Stage</th>
                        <th className="px-5 py-3.5">
                          Close date
                        </th>
                        <th className="px-5 py-3.5">
                          Last activity
                        </th>
                        <th className="px-5 py-3.5">
                          Next step
                        </th>
                        <th className="px-5 py-3.5">Risk</th>
                        <th className="px-5 py-3.5 text-right">
                          Action
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {visibleOpportunities.map(
                        (opportunity) => {
                          const overdue = isOverdue(
                            opportunity.CloseDate,
                          );
                          const riskLevel = getRiskLevel(
                            opportunity.Health_Score__c,
                          );

                          return (
                            <tr
                              key={opportunity.Id}
                              className="group align-middle transition hover:bg-blue-50/30"
                            >
                              <td className="min-w-72 px-6 py-4">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedOpportunity(
                                      opportunity,
                                    )
                                  }
                                  className="flex w-full items-start gap-3 text-left"
                                >
                                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0b5cab] transition group-hover:bg-[#0b5cab] group-hover:text-white">
                                    <Icon
                                      name="trend"
                                      className="h-4 w-4"
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-bold leading-5 text-slate-900 transition group-hover:text-[#0b5cab]">
                                      {opportunity.Name}
                                    </p>
                                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                                      {opportunity.Id}
                                    </p>
                                  </div>
                                </button>
                              </td>

                              <td className="whitespace-nowrap px-5 py-4">
                                <p className="text-sm font-black text-slate-900">
                                  {formatCurrency(
                                    opportunity.Amount,
                                  )}
                                </p>
                              </td>

                              <td className="whitespace-nowrap px-5 py-4">
                                <StageBadge
                                  stage={
                                    opportunity.StageName
                                  }
                                />
                              </td>

                              <td className="whitespace-nowrap px-5 py-4">
                                <div className="flex items-start gap-2">
                                  <Icon
                                    name="calendar"
                                    className={
                                      overdue
                                        ? "mt-0.5 h-4 w-4 text-red-500"
                                        : "mt-0.5 h-4 w-4 text-slate-400"
                                    }
                                  />
                                  <div>
                                    <p
                                      className={
                                        overdue
                                          ? "text-sm font-bold text-red-600"
                                          : "text-sm font-semibold text-slate-700"
                                      }
                                    >
                                      {formatDate(
                                        opportunity.CloseDate,
                                      )}
                                    </p>
                                    <p
                                      className={
                                        overdue
                                          ? "mt-1 text-[10px] font-black uppercase tracking-wider text-red-500"
                                          : "mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                                      }
                                    >
                                      {formatCloseTiming(
                                        opportunity.CloseDate,
                                      )}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              <td className="whitespace-nowrap px-5 py-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                                  <Icon
                                    name="activity"
                                    className="h-4 w-4 text-slate-400"
                                  />
                                  {formatDate(
                                    opportunity.LastActivityDate,
                                  )}
                                </div>
                              </td>

                              <td className="min-w-64 px-5 py-4">
                                {opportunity.NextStep?.trim() ? (
                                  <p className="line-clamp-2 text-sm leading-5 text-slate-600">
                                    {opportunity.NextStep}
                                  </p>
                                ) : (
                                  <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-700">
                                    <Icon
                                      name="alert"
                                      className="h-3.5 w-3.5"
                                    />
                                    Missing next step
                                  </div>
                                )}
                              </td>

                              <td className="whitespace-nowrap px-5 py-4">
                                <RiskBadge
                                  riskLevel={riskLevel}
                                  healthScore={
                                    opportunity.Health_Score__c
                                  }
                                />
                              </td>

                              <td className="whitespace-nowrap px-5 py-4 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedOpportunity(
                                      opportunity,
                                    )
                                  }
                                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0b5cab]"
                                >
                                  <Icon
                                    name="eye"
                                    className="h-3.5 w-3.5"
                                  />
                                  Review
                                </button>
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <footer className="mt-6 flex flex-col gap-2 border-t border-slate-200 py-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <p>
                DealPilot AI · Headless Salesforce revenue
                intelligence
              </p>
              <div className="flex items-center gap-2">
                <Icon
                  name="shield"
                  className="h-3.5 w-3.5"
                />
                <span>
                  Secure OAuth · Local AI inference · Salesforce
                  write-back
                </span>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  activeSection,
  onSectionChange,
  onSignOut,
  onNavigate,
}: {
  activeSection: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-20 items-center border-b border-white/10 px-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0b5cab] shadow-[0_10px_25px_rgba(11,92,171,0.35)]">
          <Icon name="cloud" className="h-6 w-6" />
        </div>
        <div className="ml-3">
          <p className="text-lg font-black tracking-tight">
            DealPilot AI
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
            Revenue command
          </p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6">
        <p className="px-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          Workspace
        </p>
        <div className="mt-3 space-y-1.5">
          <SidebarItem
            icon="chart"
            label="Command center"
            href="#overview"
            active={activeSection === "overview"}
            onNavigate={() => {
              onSectionChange("overview");
              onNavigate?.();
            }}
          />
          <SidebarItem
            icon="pipeline"
            label="Opportunities"
            href="#pipeline"
            active={activeSection === "pipeline"}
            onNavigate={() => {
              onSectionChange("pipeline");
              onNavigate?.();
            }}
          />
          <SidebarItem
            icon="radar"
            label="Risk radar"
            href="#risk-radar"
            active={activeSection === "risk-radar"}
            onNavigate={() => {
              onSectionChange("risk-radar");
              onNavigate?.();
            }}
          />
          <SidebarItem
            icon="sparkles"
            label="Priority deals"
            href="#priority-deals"
            active={activeSection === "priority-deals"}
            onNavigate={() => {
              onSectionChange("priority-deals");
              onNavigate?.();
            }}
          />
        </div>

        <p className="mt-8 px-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
          Data
        </p>
        <div className="mt-3 space-y-1.5">
          <SidebarItem
            icon="cloud"
            label="Salesforce org"
            href="#overview"
            status="Connected"
            onNavigate={() => {
              onSectionChange("overview");
              onNavigate?.();
            }}
          />
          <SidebarItem
            icon="database"
            label="Opportunity object"
            href="#pipeline"
            onNavigate={() => {
              onSectionChange("pipeline");
              onNavigate?.();
            }}
          />
        </div>
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Systems operational
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-400">
            Salesforce API and local Ollama scoring are
            available.
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          <Icon name="logout" className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </>
  );
}

function MobileNavigationOverlay({
  open,
  activeSection,
  onSectionChange,
  onClose,
  onSignOut,
}: {
  open: boolean;
  activeSection: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close navigation"
      />
      <aside className="relative flex h-full w-[286px] flex-col bg-[#071426] text-white shadow-2xl">
        <SidebarContent
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          onSignOut={onSignOut}
          onNavigate={onClose}
        />
      </aside>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  href,
  active = false,
  status,
  onNavigate,
}: {
  icon: IconName;
  label: string;
  href: string;
  active?: boolean;
  status?: string;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      className={
        active
          ? "flex items-center gap-3 rounded-xl bg-[#0b5cab] px-3 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(11,92,171,0.25)]"
          : "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
      }
    >
      <Icon name={icon} className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {status && (
        <span className="text-[9px] font-black uppercase tracking-wider text-emerald-300">
          {status}
        </span>
      )}
    </a>
  );
}

function SessionLoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-4">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0b5cab] text-white shadow-[0_15px_35px_rgba(11,92,171,0.28)]">
          <Icon name="cloud" className="h-8 w-8" />
        </div>
        <div className="mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-blue-100">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-[#0b5cab]" />
        </div>
        <p className="mt-4 text-sm font-bold text-slate-700">
          Connecting to your Salesforce workspace…
        </p>
      </div>
    </main>
  );
}

function SignInScreen() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#061426] px-4 py-8 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[8%] top-[8%] h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[8%] right-[5%] h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center">
        <div className="grid w-full gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <section>
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-blue-200 backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Headless Salesforce · AI revenue intelligence
            </div>

            <h1 className="mt-7 max-w-3xl text-5xl font-black tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              Turn pipeline data into seller action.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              DealPilot AI connects to Salesforce, scores every
              open opportunity, surfaces portfolio risk, and
              writes actionable insight back to your CRM.
            </p>

            <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
              <FeatureChip icon="shield" label="Secure OAuth" />
              <FeatureChip
                icon="sparkles"
                label="Local AI scoring"
              />
              <FeatureChip
                icon="database"
                label="CRM write-back"
              />
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white p-7 text-slate-950 shadow-[0_30px_80px_rgba(0,0,0,0.35)] sm:p-9">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0b5cab] text-white shadow-[0_12px_30px_rgba(11,92,171,0.28)]">
              <Icon name="cloud" className="h-7 w-7" />
            </div>
            <p className="mt-7 text-xs font-black uppercase tracking-[0.16em] text-[#0b5cab]">
              Welcome to DealPilot AI
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              Connect your Salesforce org
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Authorize read and write access to open Opportunities
              so DealPilot can build your live risk command center.
            </p>

            <button
              type="button"
              onClick={() => void signIn("salesforce")}
              className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#0b5cab] px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(11,92,171,0.24)] transition hover:bg-[#094f94]"
            >
              <Icon name="cloud" className="h-5 w-5" />
              Sign in with Salesforce
              <Icon
                name="arrow-right"
                className="h-4 w-4"
              />
            </button>

            <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-slate-400">
              <Icon name="shield" className="h-4 w-4" />
              Your Salesforce credentials are never stored by
              DealPilot.
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StatusToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) {
    return null;
  }

  const warning = /failed|could not|unable/i.test(message);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-4 top-20 z-[80] flex w-[calc(100%_-_2rem)] max-w-md items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.18)] sm:right-6 ${
        warning ? "border-amber-200" : "border-emerald-200"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          warning
            ? "bg-amber-50 text-amber-600"
            : "bg-emerald-50 text-emerald-600"
        }`}
      >
        <Icon
          name={warning ? "alert" : "check"}
          className="h-4 w-4"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-slate-900">
          {warning ? "Scan completed with issues" : "Portfolio scan complete"}
        </p>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label="Dismiss notification"
      >
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}

function MetricTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="flex h-5 w-5 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 focus:bg-slate-100 focus:text-slate-600 focus:outline-none"
      >
        <Icon name="info" className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-7 z-40 hidden w-64 -translate-x-1/2 rounded-xl bg-slate-950 px-3 py-2.5 text-left text-[11px] font-semibold normal-case leading-5 tracking-normal text-white shadow-xl group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

function FeatureChip({
  icon,
  label,
}: {
  icon: IconName;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-bold text-slate-200 backdrop-blur">
      <Icon name={icon} className="h-4 w-4 text-blue-300" />
      {label}
    </div>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  description: string;
  icon: IconName;
  accent: "blue" | "red" | "amber" | "violet";
  progress: number;
  progressLabel: string;
  tooltip: string;
};

const metricAccentStyles: Record<
  MetricCardProps["accent"],
  { icon: string; line: string; progress: string }
> = {
  blue: {
    icon: "bg-blue-50 text-[#0b5cab]",
    line: "bg-[#0b5cab]",
    progress: "bg-[#0b5cab]",
  },
  red: {
    icon: "bg-red-50 text-red-600",
    line: "bg-red-500",
    progress: "bg-red-500",
  },
  amber: {
    icon: "bg-amber-50 text-amber-600",
    line: "bg-amber-500",
    progress: "bg-amber-500",
  },
  violet: {
    icon: "bg-violet-50 text-violet-600",
    line: "bg-violet-500",
    progress: "bg-violet-500",
  },
};

function MetricCard({
  label,
  value,
  description,
  icon,
  accent,
  progress,
  progressLabel,
  tooltip,
}: MetricCardProps) {
  const styles = metricAccentStyles[accent];
  const boundedProgress = Math.min(
    100,
    Math.max(0, progress),
  );

  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.045)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
      <div
        className={`absolute inset-x-0 top-0 h-1 ${styles.line}`}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.13em] text-slate-400">
              {label}
            </p>
            <MetricTooltip text={tooltip} />
          </div>
          <p className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950">
            {value}
          </p>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            {description}
          </p>
        </div>
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}
        >
          <Icon name={icon} className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <span>{progressLabel}</span>
          <span>{Math.round(boundedProgress)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${styles.progress}`}
            style={{ width: `${boundedProgress}%` }}
          />
        </div>
      </div>
    </article>
  );
}

function InsightPill({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "orange" | "slate";
  active: boolean;
  onClick: () => void;
}) {
  const styles = {
    red: active
      ? "border-red-600 bg-red-600 text-white shadow-sm"
      : "border-red-200 bg-red-50 text-red-700",
    amber: active
      ? "border-amber-500 bg-amber-500 text-white shadow-sm"
      : "border-amber-200 bg-amber-50 text-amber-700",
    orange: active
      ? "border-orange-500 bg-orange-500 text-white shadow-sm"
      : "border-orange-200 bg-orange-50 text-orange-700",
    slate: active
      ? "border-slate-700 bg-slate-700 text-white shadow-sm"
      : "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:-translate-y-0.5 ${styles}`}
    >
      <span className="text-sm font-black">{value}</span>
      {label}
    </button>
  );
}

function RiskDonut({
  high,
  medium,
  low,
  unscanned,
}: {
  high: number;
  medium: number;
  low: number;
  unscanned: number;
}) {
  const total = Math.max(high + medium + low + unscanned, 1);
  const highEnd = (high / total) * 100;
  const mediumEnd =
    highEnd + (medium / total) * 100;
  const lowEnd =
    mediumEnd + (low / total) * 100;

  return (
    <div className="flex items-center justify-center">
      <div
        className="relative flex h-36 w-36 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(#ef4444 0% ${highEnd}%, #f59e0b ${highEnd}% ${mediumEnd}%, #10b981 ${mediumEnd}% ${lowEnd}%, #cbd5e1 ${lowEnd}% 100%)`,
        }}
        aria-label={`${high} high-risk, ${medium} medium-risk, ${low} low-risk, and ${unscanned} unscanned deals`}
      >
        <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white shadow-inner">
          <span className="text-3xl font-black text-slate-950">
            {high + medium}
          </span>
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            At risk
          </span>
        </div>
      </div>
    </div>
  );
}

function PriorityDealCard({
  opportunity,
  rank,
  averageDealAmount,
  onReview,
}: {
  opportunity: Opportunity;
  rank: number;
  averageDealAmount: number;
  onReview: () => void;
}) {
  const riskLevel = getRiskLevel(
    opportunity.Health_Score__c,
  );
  const reasons = getRiskReasons(
    opportunity,
    averageDealAmount,
  );

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.045)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_14px_35px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#071426] text-xs font-black text-white">
            {rank}
          </span>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
            Priority opportunity
          </p>
        </div>
        <RiskBadge
          riskLevel={riskLevel}
          healthScore={opportunity.Health_Score__c}
        />
      </div>

      <div className="p-5">
        <h4 className="line-clamp-2 min-h-10 text-base font-black leading-5 text-slate-950">
          {opportunity.Name}
        </h4>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-black tracking-[-0.03em] text-slate-950">
              {formatCurrency(opportunity.Amount)}
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              {opportunity.StageName}
            </p>
          </div>
          <p
            className={
              isOverdue(opportunity.CloseDate)
                ? "text-right text-xs font-bold text-red-600"
                : "text-right text-xs font-bold text-slate-500"
            }
          >
            {formatCloseTiming(opportunity.CloseDate)}
          </p>
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            Primary attention signal
          </p>
          <p className="mt-1.5 text-sm font-semibold leading-5 text-slate-700">
            {reasons[0]}
          </p>
        </div>

        <button
          type="button"
          onClick={onReview}
          className="mt-4 inline-flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-[#0b5cab]"
        >
          Review deal
          <Icon name="arrow-right" className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function OpportunityDetailDrawer({
  opportunity,
  averageDealAmount,
  onClose,
  onRefresh,
  refreshing,
}: {
  opportunity: Opportunity | null;
  averageDealAmount: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
}) {
  if (!opportunity) {
    return null;
  }

  const riskLevel = getRiskLevel(
    opportunity.Health_Score__c,
  );
  const reasons = getRiskReasons(
    opportunity,
    averageDealAmount,
  );

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
        aria-label="Close opportunity details"
      />

      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-[#f7f9fc] shadow-[-20px_0_60px_rgba(15,23,42,0.18)]">
        <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge
                  riskLevel={riskLevel}
                  healthScore={
                    opportunity.Health_Score__c
                  }
                />
                <StageBadge
                  stage={opportunity.StageName}
                />
              </div>
              <h2 className="mt-4 text-2xl font-black tracking-[-0.03em] text-slate-950">
                {opportunity.Name}
              </h2>
              <p className="mt-1 font-mono text-xs text-slate-400">
                {opportunity.Id}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close drawer"
            >
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <section className="grid gap-3 sm:grid-cols-2">
            <DrawerMetric
              label="Open value"
              value={formatCurrency(opportunity.Amount)}
              icon="dollar"
            />
            <DrawerMetric
              label="Close timing"
              value={formatCloseTiming(
                opportunity.CloseDate,
              )}
              icon="calendar"
            />
            <DrawerMetric
              label="Last activity"
              value={formatDate(
                opportunity.LastActivityDate,
              )}
              icon="activity"
            />
            <DrawerMetric
              label="Last AI scan"
              value={formatDateTime(
                opportunity.Last_Scanned__c,
              )}
              icon="clock"
            />
          </section>

          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Icon
                name="alert"
                className="h-5 w-5 text-red-500"
              />
              <h3 className="text-sm font-black text-slate-900">
                Why this deal needs attention
              </h3>
            </div>

            <div className="mt-4 space-y-3">
              {reasons.map((reason) => (
                <div
                  key={reason}
                  className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <p className="text-sm font-semibold leading-5 text-slate-700">
                    {reason}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Icon
                name="target"
                className="h-5 w-5 text-[#0b5cab]"
              />
              <h3 className="text-sm font-black text-slate-900">
                Salesforce next step
              </h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {opportunity.NextStep?.trim() ||
                "No next step is currently recorded in Salesforce."}
            </p>
          </section>

          {opportunity.Risk_Summary__c && (
            <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Icon
                  name="sparkles"
                  className="h-5 w-5 text-violet-600"
                />
                <h3 className="text-sm font-black text-slate-900">
                  Saved AI risk summary
                </h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {opportunity.Risk_Summary__c}
              </p>
            </section>
          )}

          <section className="mt-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0b5cab]">
                DealPilot AI
              </p>
              <h3 className="mt-1 text-lg font-black text-slate-950">
                Run or refresh deal analysis
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Generate a new score, summary, and recommended
                action, then write the saved fields back to
                Salesforce.
              </p>
            </div>

            <OpportunityScoreButton
              key={`${opportunity.Id}-${opportunity.Last_Scanned__c ?? "unscanned"}-drawer`}
              opportunityId={opportunity.Id}
              opportunityName={opportunity.Name}
              initialHealthScore={
                opportunity.Health_Score__c
              }
              initialRiskSummary={
                opportunity.Risk_Summary__c
              }
              initialLastScanned={
                opportunity.Last_Scanned__c
              }
            />
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          <p className="hidden text-xs text-slate-400 sm:block">
            Refresh after analysis to update portfolio metrics.
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed"
            >
              <Icon
                name="refresh"
                className={`h-3.5 w-3.5 ${
                  refreshing ? "animate-spin" : ""
                }`}
              />
              Refresh data
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-[#071426] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function DrawerMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: IconName;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon name={icon} className="h-4 w-4" />
        <p className="text-[10px] font-black uppercase tracking-[0.12em]">
          {label}
        </p>
      </div>
      <p className="mt-3 text-base font-black text-slate-900">
        {value}
      </p>
    </article>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const normalized = stage.toLowerCase();

  let styles =
    "border-blue-200 bg-blue-50 text-blue-700";

  if (normalized.includes("negotiation")) {
    styles =
      "border-violet-200 bg-violet-50 text-violet-700";
  } else if (
    normalized.includes("proposal") ||
    normalized.includes("value")
  ) {
    styles =
      "border-cyan-200 bg-cyan-50 text-cyan-700";
  } else if (
    normalized.includes("qualification") ||
    normalized.includes("prospecting")
  ) {
    styles =
      "border-slate-200 bg-slate-50 text-slate-700";
  }

  return (
    <span
      className={`inline-flex rounded-lg border px-2.5 py-1.5 text-xs font-bold ${styles}`}
    >
      {stage}
    </span>
  );
}

type RiskBadgeProps = {
  riskLevel: RiskLevel;
  healthScore: number | null;
};

function RiskBadge({
  riskLevel,
  healthScore,
}: RiskBadgeProps) {
  const config: Record<
    RiskLevel,
    { label: string; dot: string; container: string }
  > = {
    high: {
      label: "High risk",
      dot: "bg-red-500",
      container:
        "border-red-200 bg-red-50 text-red-700",
    },
    medium: {
      label: "Medium risk",
      dot: "bg-amber-500",
      container:
        "border-amber-200 bg-amber-50 text-amber-700",
    },
    low: {
      label: "Low risk",
      dot: "bg-emerald-500",
      container:
        "border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    unscanned: {
      label: "Unscanned",
      dot: "bg-slate-400",
      container:
        "border-slate-200 bg-slate-50 text-slate-600",
    },
  };

  const current = config[riskLevel];

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${current.container}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${current.dot}`}
      />
      {current.label}
      {healthScore !== null && (
        <span className="font-black">
          · {healthScore}
        </span>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <h4 className="mt-5 text-lg font-black text-slate-900">
        {title}
      </h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 rounded-xl bg-[#0b5cab] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#094f94]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function OpportunityTableSkeleton() {
  return (
    <div className="space-y-0 divide-y divide-slate-100">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid min-w-[1100px] grid-cols-[1.2fr_0.7fr_0.8fr_0.8fr_0.9fr_1fr] gap-6 px-6 py-5"
        >
          {Array.from({ length: 6 }).map(
            (__, cellIndex) => (
              <div
                key={cellIndex}
                className="h-10 animate-pulse rounded-lg bg-slate-100"
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 12h4l2.5-7 5 14 2.5-7H21" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M10.3 3.5 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...common}>
          <path d="M17.5 19H7a5 5 0 1 1 1.3-9.8A7 7 0 0 1 21 13.5 5.5 5.5 0 0 1 17.5 19Z" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case "dollar":
      return (
        <svg {...common}>
          <path d="M12 2v20M17 6.5c0-1.4-2.2-2.5-5-2.5S7 5.1 7 6.5 9.2 9 12 9s5 1.1 5 2.5S14.8 14 12 14s-5 1.1-5 2.5S9.2 19 12 19s5-1.1 5-2.5" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M4 5h16M7 12h10M10 19h4" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 17l5-5-5-5M15 12H3" />
          <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "pipeline":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M8 6h8M7 8l4 8M17 8l-4 8" />
        </svg>
      );
    case "radar":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <path d="M12 12 18.5 5.5M12 3v2M3 12h2M12 19v2M19 12h2" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 0 0-14.9-4M4 4v5h5M4 13a8 8 0 0 0 14.9 4M20 20v-5h-5" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
          <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
          <path d="m5 14 .7 1.8 1.8.7-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      );
    case "trend":
      return (
        <svg {...common}>
          <path d="m3 17 6-6 4 4 8-8" />
          <path d="M15 7h6v6" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    default:
      return null;
  }
}
