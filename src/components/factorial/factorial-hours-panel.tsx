"use client";

import { useMemo } from "react";
import type { FactorialHoursReport, PersonComparison } from "@/lib/queries/factorial-hours";
import { Card } from "@/components/ui/Card";

export function FactorialHoursPanel({ report }: { report: FactorialHoursReport }) {
  const { people, totals, factorialError, windowDays } = report;

  // Group by Factorial team for rollup view, falling back to TT team.
  const byTeam = useMemo(() => {
    const groups = new Map<string, PersonComparison[]>();
    for (const p of people) {
      const teamKey = p.factorialTeams[0] ?? p.memberTeam ?? "(No team)";
      const cur = groups.get(teamKey) ?? [];
      cur.push(p);
      groups.set(teamKey, cur);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  }, [people]);

  return (
    <div className="space-y-6">
      {/* Error state */}
      {factorialError && (
        <Card className="border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-900">Factorial Unavailable</div>
          <div className="mt-1 text-sm text-red-800">{factorialError}</div>
        </Card>
      )}

      {/* Totals banner */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium text-gray-600">Present (HR)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold">{totals.presentHours}h</span>
            <span className="text-xs text-gray-500">{totals.presentCount} people</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-gray-600">Logged (TT)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold">{totals.loggedHours}h</span>
            <span className="text-xs text-gray-500">{totals.loggedCount} people</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-gray-600">Billable</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold">{totals.billableHours}h</span>
            <span className="text-xs text-gray-500">of {totals.loggedHours}h</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-gray-600">Window</div>
          <div className="mt-1">
            <span className="text-2xl font-bold">{windowDays}</span>
            <span className="text-xs text-gray-500"> days</span>
          </div>
        </Card>
      </div>

      {/* By-team rollup */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">By Team</h3>
        {byTeam.map(([teamName, members]) => {
          const avgPresent = members.filter((p) => p.presentHours !== null).length
            ? Math.round(
                (members.reduce((s, p) => s + (p.presentHours ?? 0), 0) /
                  members.filter((p) => p.presentHours !== null).length) *
                  10,
              ) / 10
            : null;
          const avgLogged = members.filter((p) => p.loggedHours !== null).length
            ? Math.round(
                (members.reduce((s, p) => s + (p.loggedHours ?? 0), 0) /
                  members.filter((p) => p.loggedHours !== null).length) *
                  10,
              ) / 10
            : null;
          return (
            <Card key={teamName} className="p-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <h4 className="font-medium">{teamName}</h4>
                <span className="text-sm text-gray-500">{members.length} members</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                <div>
                  <div className="text-xs text-gray-600">Avg Present</div>
                  <div className="font-medium">{avgPresent ? `${avgPresent}h` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Avg Logged</div>
                  <div className="font-medium">{avgLogged ? `${avgLogged}h` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Members w/ Data</div>
                  <div className="font-medium">
                    {members.filter((p) => p.loggedHours !== null).length} /
                    {members.filter((p) => p.presentHours !== null).length}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {members.slice(0, 5).map((p) => (
                  <PersonRow key={p.memberId ?? p.factorialId} person={p} />
                ))}
                {members.length > 5 && (
                  <div className="text-xs text-gray-500 py-1">+{members.length - 5} more</div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Full roster */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Full Roster ({people.length})</h3>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-right font-medium">Present</th>
                <th className="px-4 py-2 text-right font-medium">Logged</th>
                <th className="px-4 py-2 text-right font-medium">Billable</th>
                <th className="px-4 py-2 text-center font-medium">% Bill</th>
                <th className="px-4 py-2 text-left font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.memberId ?? p.factorialId} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {p.presentHours !== null ? `${p.presentHours}h` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {p.loggedHours !== null ? `${p.loggedHours}h` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {p.billableHours !== null ? `${p.billableHours}h` : "—"}
                  </td>
                  <td className="px-4 py-2 text-center font-mono text-xs">
                    {p.billableShare !== null ? `${p.billableShare}%` : "—"}
                  </td>
                  <td className="px-4 py-2 text-left">
                    <span className={`inline-block px-2 py-1 text-xs rounded ${
                      p.matchState === "matched"
                        ? "bg-green-100 text-green-800"
                        : p.matchState === "factorial_only"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-orange-100 text-orange-800"
                    }`}>
                      {p.matchState === "matched" && "Both"}
                      {p.matchState === "factorial_only" && "HR only"}
                      {p.matchState === "trackingtime_only" && "TT only"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function PersonRow({ person }: { person: PersonComparison }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex-1">
        <div className="font-medium">{person.name}</div>
        <div className="text-gray-500">
          {person.factorialTeams.length > 0 && person.factorialTeams.join(", ")}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {person.presentHours !== null && (
          <div className="text-right">
            <div className="text-gray-500">Present</div>
            <div className="font-medium">{person.presentHours}h</div>
          </div>
        )}
        {person.loggedHours !== null && (
          <div className="text-right">
            <div className="text-gray-500">Logged</div>
            <div className="font-medium">{person.loggedHours}h</div>
          </div>
        )}
        {person.billableHours !== null && (
          <div className="text-right">
            <div className="text-gray-500">Bill</div>
            <div className="font-medium">{person.billableShare}%</div>
          </div>
        )}
      </div>
    </div>
  );
}
