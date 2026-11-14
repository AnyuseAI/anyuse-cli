export class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public executionID?: string,
  ) {
    super(message);
  }
}

export class Client {
  private base: URL;
  constructor(
    base = process.env.ANYUSE_API_URL || "https://api.anyuse.app",
    private key = process.env.ANYUSE_API_KEY,
  ) {
    this.base = new URL(base);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw new Error(
        "API URL must not contain credentials, query, or fragment",
      );
    if (
      this.base.protocol !== "https:" &&
      !(
        this.base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname)
      )
    )
      throw new Error("Use HTTPS, except for a local development server");
  }
  async events(
    id: string,
    receive: (event: any) => void,
    signal = AbortSignal.timeout(3_600_000),
  ) {
    if (!this.key) throw new APIError("missing_key", "Set ANYUSE_API_KEY", 401);
    try {
      const response = await fetch(
        new URL(
          `/v1/executions/${encodeURIComponent(id)}/events`,
          this.base,
        ),
        {
          headers: {
            Authorization: `Bearer ${this.key}`,
            Accept: "text/event-stream",
          },
          signal,
          redirect: "error",
        },
      );
      if (!response.ok || !response.body)
        throw new APIError(
          "stream_unavailable",
          `HTTP ${response.status}; fetch execution for final result`,
          response.status,
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("\n");
            if (!data) continue;
            const event = JSON.parse(data);
            if (event.code)
              throw new APIError(
                event.code,
                `Fetch execution ${id}; do not resubmit`,
                409,
                id,
              );
            receive(event);
            if (event.type === "done") return;
          }
        }
        throw new APIError(
          "stream_interrupted",
          `Fetch execution ${id}; do not resubmit`,
          409,
          id,
        );
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof APIError) {
        error.executionID ??= id;
        throw error;
      }
      throw new APIError(
        "stream_interrupted",
        `Stream interrupted. Fetch execution ${id}; do not resubmit.`,
        409,
        id,
      );
    }
  }

  async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      idempotencyKey?: string;
      public?: boolean;
    } = {},
  ): Promise<T> {
    if (!options.public && !this.key)
      throw new APIError(
        "missing_key",
        "Set ANYUSE_API_KEY before calling this command",
        401,
      );
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.key) headers.Authorization = `Bearer ${this.key}`;
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (options.idempotencyKey)
      headers["Idempotency-Key"] = options.idempotencyKey;
    const response = await fetch(new URL(path, this.base), {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (response.status === 204) return undefined as T;
    const data = (await response.json()) as any;
    if (!response.ok)
      throw new APIError(
        data.error?.code || "api_error",
        data.error?.message || `HTTP ${response.status}`,
        response.status,
        typeof data.execution_id === "string" ? data.execution_id : undefined,
      );
    return data as T;
  }
}

export async function waitForExecution(
  client: Client,
  id: string,
  timeoutSeconds: number,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const result = await client
      .request(`/v1/executions/${encodeURIComponent(id)}`)
      .catch((error: unknown) => {
        if (error instanceof APIError) {
          error.executionID ??= id;
          throw error;
        }
        throw new APIError(
          "execution_query_failed",
          `Query failed. Resume with: anyuse jobs wait ${id}`,
          503,
          id,
        );
      });
    if (
      result.status === "unknown" ||
      (["succeeded", "failed", "canceled"].includes(result.status) &&
        result.settlement !== "reserved")
    )
      return result;
    if (Date.now() >= deadline)
      throw new APIError(
        "wait_timeout",
        `Waiting stopped. Resume with: anyuse jobs wait ${id}`,
        408,
        id,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
