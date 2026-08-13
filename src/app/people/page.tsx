"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SyncBar } from "@/components/SyncBar";
import { PEOPLE_DIRECTORY, PersonProfile } from "@/data/hse-data";

export default function PeoplePage() {
  const [selectedPerson, setSelectedPerson] = useState<PersonProfile>(PEOPLE_DIRECTORY[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<"ALL" | "SAFETY" | "ENG" | "LAB">("ALL");

  const filteredPeople = PEOPLE_DIRECTORY.filter((p) => {
    const matchesDept = deptFilter === "ALL" || p.department === deptFilter;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.role.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDept && matchesSearch;
  });

  return (
    <div className="flex flex-col">
      <SyncBar />

      <PageHeader
        category="HSE HUB / RECORDS"
        title="People &amp; Profiles"
        meta={`${PEOPLE_DIRECTORY.length} ACTIVE CONSULTANTS &amp; STAFF`}
      />

      <div className="flex flex-col border-b border-[var(--border)] lg:flex-row min-h-[calc(100vh-130px)]">
        {/* Left: People Master List (330px) */}
        <div className="flex w-full flex-none flex-col border-b border-[var(--border)] lg:w-[330px] lg:border-b-0 lg:border-r bg-[var(--sidebar)]">
          <div className="flex flex-col gap-2.5 border-b border-[var(--border)] p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">People</span>
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                {filteredPeople.length} ACTIVE
              </span>
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, role, certificate…"
              className="border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />

            <div className="flex gap-1.5 font-mono text-[10.5px]">
              {(["ALL", "SAFETY", "ENG", "LAB"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setDeptFilter(filter)}
                  className={`px-2 py-0.5 ${
                    deptFilter === filter
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)] font-medium"
                      : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* People items */}
          <div className="flex flex-col divide-y divide-[#3a414c] overflow-y-auto">
            {filteredPeople.map((person) => {
              const isSelected = selectedPerson.id === person.id;
              return (
                <button
                  key={person.id}
                  onClick={() => setSelectedPerson(person)}
                  className={`flex items-center gap-3 p-3.5 text-left transition-colors ${
                    isSelected
                      ? "border-l-2 border-[var(--accent)] bg-[var(--surface-hover)]"
                      : "border-l-2 border-transparent hover:bg-[var(--surface)]"
                  }`}
                >
                  <div
                    className="h-7 w-7 flex-none rounded-full"
                    style={{
                      background:
                        "repeating-linear-gradient(45deg, #4a525d, #4a525d 3px, #3c434e 3px, #3c434e 6px)",
                    }}
                  />
                  <div className="flex flex-1 flex-col">
                    <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
                      {person.name}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {person.role}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-[11px] font-medium ${
                      person.capacityStatus === "OVER CAPACITY"
                        ? "text-[var(--critical)]"
                        : person.capacityStatus === "LEAVE"
                        ? "text-[var(--text-faint)]"
                        : "text-[var(--accent)]"
                    }`}
                  >
                    {person.capacityStatus === "LEAVE" ? "LEAVE" : `${person.billableShare}%`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Person Profile */}
        <div className="flex flex-1 flex-col bg-[var(--page)] p-6">
          {/* Profile Header */}
          <div className="flex flex-wrap items-start gap-4 border-b border-[var(--border)] pb-5">
            <div
              className="h-14 w-14 flex-none rounded-full"
              style={{
                background:
                  "repeating-linear-gradient(45deg, #4a525d, #4a525d 3px, #3c434e 3px, #3c434e 6px)",
              }}
            />

            <div className="flex flex-col gap-1">
              <h2 className="text-[19px] font-semibold text-[var(--text-primary)]">
                {selectedPerson.name}
              </h2>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {selectedPerson.role} · {selectedPerson.department} · SINCE {selectedPerson.since}
              </span>
              <div className="mt-1 flex flex-wrap gap-2">
                <span
                  className={`px-2 py-0.5 font-mono text-[10.5px] font-medium ${
                    selectedPerson.capacityStatus === "OVER CAPACITY"
                      ? "bg-[#4a251d] text-[#f0a08c]"
                      : selectedPerson.capacityStatus === "LEAVE"
                      ? "bg-[#3a414c] text-[var(--text-muted)]"
                      : "bg-[#2a474b] text-[#b4d6ce]"
                  }`}
                >
                  {selectedPerson.capacityStatus}
                </span>
                <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)]">
                  {selectedPerson.contractHours} H CONTRACT
                </span>
                <span className="bg-[var(--surface)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)]">
                  {selectedPerson.employeeNumber}
                </span>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button className="border border-[var(--border-strong)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
                Open in Factorial
              </button>
              <button className="bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">
                Assign to project
              </button>
            </div>
          </div>

          {/* 4-KPI Strip for Person */}
          <div className="my-5 grid grid-cols-1 border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3.5 sm:border-r lg:border-b-0">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                LOGGED THIS MONTH
              </span>
              <span className="font-mono text-[22px] font-semibold text-[var(--text-primary)]">
                {selectedPerson.loggedThisMonth}{" "}
                <span className="text-[12px] font-normal text-[var(--text-muted)]">
                  / {selectedPerson.totalMonthlyHours} H
                </span>
              </span>
            </div>

            <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3.5 lg:border-b-0 lg:border-r">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                BILLABLE SHARE
              </span>
              <span className="font-mono text-[22px] font-semibold text-[var(--accent)]">
                {selectedPerson.billableShare}%
              </span>
            </div>

            <div className="flex flex-col gap-1 border-b border-[var(--border)] p-3.5 sm:border-r sm:border-b-0 lg:border-r">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                OPEN TASKS
              </span>
              <span className="font-mono text-[22px] font-semibold text-[var(--text-primary)]">
                {selectedPerson.openTasks}{" "}
                {selectedPerson.overdueTasks > 0 && (
                  <span className="text-[12px] font-normal text-[var(--critical)]">
                    · {selectedPerson.overdueTasks} OVERDUE
                  </span>
                )}
              </span>
            </div>

            <div className="flex flex-col gap-1 p-3.5">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)]">
                HOLIDAY LEFT
              </span>
              <span className="font-mono text-[22px] font-semibold text-[var(--text-primary)]">
                {selectedPerson.holidayLeft}{" "}
                <span className="text-[12px] font-normal text-[var(--text-muted)]">
                  / {selectedPerson.totalHoliday} D
                </span>
              </span>
            </div>
          </div>

          {/* Assignments & Qualifications Grid */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Assignments (7 cols) */}
            <div className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-7">
              <div className="flex items-baseline gap-2.5">
                <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                  Assignments
                </span>
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
                  ASANA · HOURS FROM TRACKINGTIME
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="grid min-w-[380px] grid-cols-12 border-b border-[var(--border)] pb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
                  <span className="col-span-6">PROJECT</span>
                  <span className="col-span-2 text-right">LOGGED</span>
                  <span className="col-span-2 text-right">TASKS</span>
                  <span className="col-span-2 text-right">SHARE</span>
                </div>

                {selectedPerson.assignments.map((asg) => (
                  <div
                    key={asg.project}
                    className="grid min-w-[380px] grid-cols-12 items-center border-b border-[#3a414c] py-2 text-[12.5px]"
                  >
                    <span className="col-span-6 font-medium text-[var(--text-primary)]">
                      {asg.project}
                    </span>
                    <span className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
                      {asg.loggedHours} h
                    </span>
                    <span className="col-span-2 text-right font-mono text-[var(--text-secondary)]">
                      {asg.tasksCount > 0 ? asg.tasksCount : "–"}
                    </span>
                    <span className="col-span-2 text-right font-mono text-[var(--accent)] font-medium">
                      {asg.sharePercent}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Qualifications & Documents (5 cols) */}
            <div className="flex flex-col gap-4 lg:col-span-5">
              {/* Qualifications */}
              <div className="flex flex-col gap-2.5 border border-[var(--border)] bg-[var(--surface)] p-4">
                <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                  Qualifications &amp; Certifications
                </span>

                <div className="flex flex-col gap-2">
                  {selectedPerson.qualifications.map((q) => (
                    <div key={q.name} className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--text-primary)]">{q.name}</span>
                      <span
                        className={`font-mono text-[10.5px] font-medium ${
                          q.status === "RENEW"
                            ? "text-[var(--warning)]"
                            : "text-[var(--accent)]"
                        }`}
                      >
                        {q.validity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Documents */}
              <div className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface)] p-4">
                <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                  Documents (Factorial)
                </span>
                <div className="flex gap-2">
                  {["CONTRACT", "SIFA CERT", "NDA"].map((doc) => (
                    <div
                      key={doc}
                      className="flex h-12 flex-1 items-end p-1.5"
                      style={{
                        background:
                          "repeating-linear-gradient(45deg, #3a414c, #3a414c 4px, #15191c 4px, #15191c 8px)",
                      }}
                    >
                      <span className="font-mono text-[9px] text-[var(--text-faint)]">{doc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
