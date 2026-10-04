"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";

type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  calendar: "school" | "personal";
};

type IngestResult = {
  summary: string;
  created: CalEvent[];
  duplicates: { title: string }[];
  conflicts: { event: CalEvent; with: CalEvent }[];
  actionItems: { what: string; due: string | null; amount: string | null }[];
};

const when = (e: CalEvent) => {
  const d = new Date(e.allDay && e.start.length === 10 ? `${e.start}T12:00:00` : e.start);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (e.allDay) return day;
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return `${day}, ${t}`;
};

function EventCard({ e, highlight }: { e: CalEvent; highlight?: boolean }) {
  const child = e.description?.match(/^For: (.+)$/m)?.[1];
  return (
    <li className="flex gap-3 py-2">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{when(e)}</span>
      <span>
        <span className={highlight ? "font-semibold bg-yellow-200 dark:bg-yellow-700/60 px-0.5" : e.calendar === "school" ? "font-semibold" : ""}>
          {e.title}
        </span>
        {(e.location || child) && (
          <span className="block text-sm text-muted-foreground">
            {[e.location, child && `for ${child}`].filter(Boolean).join(", ")}
          </span>
        )}
      </span>
    </li>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="my-2 rounded-xl border p-4">
      <div className="mb-1 text-sm text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export const EventsToolUI = makeAssistantToolUI<{ timeMin: string; timeMax: string }, CalEvent[]>({
  toolName: "listEventsTool",
  render: ({ result, status }) => {
    if (status.type === "running") return <Card title="Checking the calendar">…</Card>;
    if (!result) return null;
    if (!result.length) return <Card title="Calendar">Nothing on the calendar in that range.</Card>;
    return (
      <Card title={`${result.length} on the calendar`}>
        <ul className="divide-y">{result.map((e) => <EventCard key={e.id} e={e} />)}</ul>
      </Card>
    );
  },
});

export const IngestToolUI = makeAssistantToolUI<{ text: string }, IngestResult>({
  toolName: "ingestTool",
  render: ({ result, status }) => {
    if (status.type === "running") return <Card title="Reading the dates and checking your calendar">…</Card>;
    if (!result) return null;
    return (
      <Card title={result.created.length ? `Added ${result.created.length} to the School calendar` : "Nothing new to add"}>
        <ul className="divide-y">{result.created.map((e) => <EventCard key={e.id} e={e} highlight />)}</ul>
        {result.conflicts.map((c, i) => (
          <p key={i} className="mt-2 text-sm text-red-600 dark:text-red-400">Heads up: {c.event.title} overlaps with {c.with.title}.</p>
        ))}
        {result.actionItems.length > 0 && (
          <ul className="mt-2 text-sm">
            {result.actionItems.map((a, i) => (
              <li key={i}>To do: {a.what}{a.amount ? ` (${a.amount})` : ""}{a.due ? ` by ${when({ start: a.due, allDay: true } as CalEvent)}` : ""}</li>
            ))}
          </ul>
        )}
      </Card>
    );
  },
});
