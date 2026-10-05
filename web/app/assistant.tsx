"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { EventsToolUI, IngestToolUI } from "@/components/school/event-cards";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4111";

// Family code for a gated agent: taken once from ?code= in the URL, then remembered in this browser.
function familyCode(): string {
  if (typeof window === "undefined") return "";
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl) localStorage.setItem("familyCode", fromUrl);
    return localStorage.getItem("familyCode") ?? "";
  } catch {
    return "";
  }
}

export const Assistant = () => {
  const runtime = useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: `${AGENT_URL}/chat/schoolAgent`,
      headers: (): Record<string, string> => {
        const code = familyCode();
        return code ? { "x-family-code": code } : {};
      },
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <EventsToolUI />
      <IngestToolUI />
      <div className="h-dvh">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
};
