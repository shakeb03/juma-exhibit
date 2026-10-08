// The frontend's own deployed commit, shown beside the backend's in the geek panel. Vercel supplies it at build time.
export function GET() {
  return Response.json(
    { frontendCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
