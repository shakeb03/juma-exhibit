"use client";

import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { WorkspaceProvider } from "@/components/workspace/context";
import { SessionProvider } from "@/lib/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <WorkspaceProvider>
        <div className="flex h-screen flex-col">
          <Header />
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1 overflow-hidden" id="main">{children}</main>
            <Sidebar />
          </div>
        </div>
      </WorkspaceProvider>
    </SessionProvider>
  );
}
