export type WorkerConfig = {
  url: string;
  headers: HeadersInit;
};

export function getWorkerConfig(): WorkerConfig | null {
  const url = process.env.MAP_FORGE_WORKER_URL?.trim().replace(/\/$/, "");
  if (!url) return null;

  const token = process.env.MAP_FORGE_WORKER_TOKEN?.trim();
  return {
    url,
    headers: token ? { "x-worker-token": token } : {},
  };
}
