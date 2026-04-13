"use client";
import { Suspense } from "react";
import { ChatInner } from "@/components/ChatInner";

export default function ChatPage() {
  return (
    <div className="h-[calc(100vh-80px)]">
      <Suspense fallback={<div className="p-8 text-sm text-(--muted)">Memuat...</div>}>
        <ChatInner />
      </Suspense>
    </div>
  );
}
