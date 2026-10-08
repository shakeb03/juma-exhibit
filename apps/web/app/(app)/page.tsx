"use client";

import { Network, Users } from "lucide-react";
import Link from "next/link";
import { ClientCard, ClientCardSkeleton } from "@/components/home/client-card";
import { Scenarios } from "@/components/home/scenarios";
import { Button, ErrorNote } from "@/components/ui";
import { useClients } from "@/lib/hooks";

export default function HomePage() {
  const clients = useClients();

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10 desk:px-8">
        <h1 className="text-[32px] font-medium leading-tight tracking-tight">What are we working on today?</h1>
        <p className="mt-1 font-serif text-lg italic text-text-muted">Good ideas. Evidence attached.</p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <a href="#clients" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border-strong bg-aqua/50 p-4">
            <Users size={20} className="text-teal" aria-hidden />
            <span><span className="block text-[15px] font-medium">Client workspaces</span><span className="text-sm text-text-muted">Reports, answers, and revisions for one client</span></span>
          </a>
          <Link href="/intelligence" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:bg-surface-muted">
            <Network size={20} className="text-teal" aria-hidden />
            <span><span className="block text-[15px] font-medium">Intelligence canvas</span><span className="text-sm text-text-muted">Find patterns across clients that approved sharing</span></span>
          </Link>
        </div>

        <div className="mt-10">
          {clients.data ? <Scenarios clients={clients.data} /> : <Scenarios clients={[]} />}
        </div>

        <section id="clients" className="mt-10" aria-labelledby="clients-heading">
          <h2 id="clients-heading" className="text-[18px] font-medium">Clients</h2>
          <p className="mt-0.5 text-sm text-text-muted">Three fictional clothing brands. All data is synthetic.</p>
          {clients.isError ? (
            <div className="mt-4"><ErrorNote title="Clients could not load" action={<Button onClick={() => clients.refetch()}>Try again</Button>}>Nothing was changed. Try again in a moment.</ErrorNote></div>
          ) : (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {clients.isLoading
                ? [0, 1, 2].map((i) => <li key={i}><ClientCardSkeleton /></li>)
                : clients.data?.map((client) => <li key={client.id}><ClientCard client={client} /></li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
