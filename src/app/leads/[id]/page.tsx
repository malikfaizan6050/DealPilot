"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { signOut } from "next-auth/react";

type Lead = {
    Id: string;
    Name: string;
    Company?: string;
    Status?: string;
};

export default function LeadDetail() {
    const params = useParams();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    const [lead, setLead] = useState<Lead | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;

        async function fetchLead() {
            try {
                const res = await fetch(`/api/salesforce/leads/${id}`);
                const data = await res.json();
                if (!res.ok) {
                    if (res.status === 401) {
                        await signOut({ callbackUrl: "/" });
                        return;
                    }
                    console.error("Lead fetch failed:", data);
                    setLead(null);
                    return;
                }
                setLead(data);
            } catch (error) {
                console.error("Error fetching lead:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchLead();
    }, [id]);

    if (loading) return <div>Loading...</div>;
    if (!lead) return <div>Lead not found.</div>;

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold">{lead.Name}</h1>
            <p>Status: {lead.Status}</p>
            <p>Company: {lead.Company}</p>
            {/* Yahan aap apni baqi styling add kar sakte hain */}
        </div>
    );
}