"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { EventsToolUI, IngestToolUI } from "@/components/school/event-cards";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4111";

export const Assistant = () => {
  const runtime = useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: `${AGENT_URL}/chat/schoolAgent`,
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
