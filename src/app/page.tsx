"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

type Lead = {
  Id: string;
  Name: string;
  Company?: string;
  Status?: string;
};

export default function Dashboard() {
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && !session?.error;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<unknown>(null);

  useEffect(() => {

    if (!signedIn) return;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/salesforce/leads", {
          method: "GET",
          credentials: "include",
        });

        const data = await res.json();
        setDebug(data.debug ?? null);

        if (!res.ok) {
          setError(data?.error || "Failed to fetch leads");
          setLeads([]);
          if (res.status === 401) {
            await signOut({ callbackUrl: "/" });
          }
          return;
        }

        setLeads(data.leads || []);
      } catch (err) {
        console.error("Fetch failed", err);
        setError("Unable to load leads. Make sure you are signed in.");
        setLeads([]);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [signedIn]);


  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6 md:p-12 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-red-200/50 rounded-full blur-[120px] animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-red-100/50 rounded-full blur-[120px] animate-pulse delay-1000"></div>

      <div className="max-w-7xl mx-auto relative z-10">
        <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6 bg-white/60 backdrop-blur-lg p-8 rounded-3xl border border-gray-200 shadow-sm">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">DealPilot <span className="text-red-600">AI</span></h1>
            <p className="text-gray-500 mt-1">Enterprise Salesforce Insights</p>
          </div>
          <div className="flex gap-4">
            {signedIn ? (
              <button
                onClick={() => signOut()}
                className="px-6 py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-all shadow-lg shadow-red-200"
              >
                Sign Out
              </button>
            ) : (
              <button
                onClick={() => signIn("salesforce")}
                className="px-6 py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-all shadow-lg shadow-red-200"
              >
                Sign in with Salesforce
              </button>
            )}
          </div>
        </header>

        {!signedIn ? (
          <div className="rounded-3xl bg-white border border-gray-200 p-12 shadow-sm text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Please sign in to view Salesforce leads</h2>
            <p className="text-gray-500">This dashboard requires an authenticated Salesforce session to fetch leads.</p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-6 rounded-3xl bg-red-50 border border-red-200 p-6 text-red-700">
                <strong>Error:</strong> {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {[
                { label: "TOTAL LEADS", val: leads.length, border: "border-red-100" },
                { label: "IN PROGRESS", val: leads.filter(l => l.Status?.includes("Working")).length, border: "border-red-100" },
                { label: "NEW ENTRIES", val: leads.filter(l => !l.Status?.includes("Working")).length, border: "border-red-100" }
              ].map((item, i) => (
                <div key={i} className={`p-8 rounded-3xl bg-white border ${item.border} shadow-sm hover:shadow-md transition-shadow`}>
                  <p className="text-[10px] font-bold tracking-widest text-gray-400">{item.label}</p>
                  <h2 className="text-5xl font-black mt-3 text-gray-900">{loading ? "..." : item.val}</h2>
                </div>
              ))}
            </div>

            {leads.length === 0 && debug && (
              <div className="mb-6 rounded-3xl bg-yellow-50 border border-yellow-200 p-6 text-yellow-700">
                <p className="font-semibold">Debug data:</p>
                <pre className="mt-2 max-h-40 overflow-auto text-xs text-gray-700">{JSON.stringify(debug, null, 2)}</pre>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-3xl p-1 shadow-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-gray-400 text-[10px] uppercase tracking-widest border-b border-gray-100">
                    <th className="p-6">Lead Name</th>
                    <th className="p-6">Company</th>
                    <th className="p-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {leads.map((lead) => (
                    <tr key={lead.Id} className="hover:bg-red-50/50 transition-colors">
                      <td className="p-6 font-bold text-gray-900">
                        <Link href={`/leads/${lead.Id}`}>{lead.Name}</Link>
                      </td>
                      <td className="p-6 text-gray-600">{lead.Company}</td>
                      <td className="p-6">
                        <span className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-semibold border border-red-100">{lead.Status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
