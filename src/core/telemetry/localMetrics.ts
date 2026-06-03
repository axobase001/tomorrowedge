export type LocalMetric = {
  name: string;
  value: number;
  unit: "ms" | "usd" | "count";
};

export class LocalMetrics {
  private readonly metrics: LocalMetric[] = [];

  add(metric: LocalMetric): void {
    this.metrics.push(metric);
  }

  list(): LocalMetric[] {
    return [...this.metrics];
  }
}
