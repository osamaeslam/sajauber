const MONTHLY_BANDWIDTH_LIMIT_MB = 2 * 1024;
const WARNING_THRESHOLD_MB = 1.5 * 1024;
const CRITICAL_THRESHOLD_MB = 1.8 * 1024;

interface RequestRecord {
  timestamp: number;
  method: string;
  table?: string;
  sizeKB: number;
}

class BandwidthMonitor {
  private records: RequestRecord[] = [];
  private currentMonth: string = '';
  private totalKB: number = 0;
  private alertThresholds: { warning: number; critical: number } = {
    warning: WARNING_THRESHOLD_MB * 1024,
    critical: CRITICAL_THRESHOLD_MB * 1024,
  };
  private onAlert?: (level: 'warning' | 'critical', usedMB: number) => void;

  constructor(onAlert?: (level: 'warning' | 'critical', usedMB: number) => void) {
    this.onAlert = onAlert;
    this.currentMonth = this.getCurrentMonth();
    this.loadFromStorage();
  }

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('ezz_bandwidth_monitor');
      if (stored) {
        const data = JSON.parse(stored);
        if (data.month === this.currentMonth) {
          this.records = data.records || [];
          this.totalKB = data.totalKB || 0;
        } else {
          this.reset();
        }
      }
    } catch {}
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem('ezz_bandwidth_monitor', JSON.stringify({
        month: this.currentMonth,
        records: this.records.slice(-500),
        totalKB: this.totalKB,
      }));
    } catch {}
  }

  private checkAlerts(): void {
    const usedMB = this.totalKB / 1024;
    if (this.onAlert) {
      if (usedMB >= this.alertThresholds.critical / 1024) {
        this.onAlert('critical', usedMB);
      } else if (usedMB >= this.alertThresholds.warning / 1024) {
        this.onAlert('warning', usedMB);
      }
    }
  }

  recordRequest(method: string, table?: string, payloadSizeKB: number = 0): void {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (monthKey !== this.currentMonth) {
      this.reset();
      this.currentMonth = monthKey;
    }

    const record: RequestRecord = {
      timestamp: Date.now(),
      method,
      table,
      sizeKB: payloadSizeKB,
    };

    this.records.push(record);
    this.totalKB += payloadSizeKB;

    if (this.records.length > 1000) {
      this.records = this.records.slice(-500);
    }

    this.saveToStorage();
    this.checkAlerts();
  }

  getUsage(): { totalMB: number; limitMB: number; percentage: number; requestCount: number } {
    const totalMB = this.totalKB / 1024;
    return {
      totalMB: parseFloat(totalMB.toFixed(2)),
      limitMB: MONTHLY_BANDWIDTH_LIMIT_MB,
      percentage: parseFloat(((totalMB / MONTHLY_BANDWIDTH_LIMIT_MB) * 100).toFixed(2)),
      requestCount: this.records.length,
    };
  }

  getRecentRequests(limit: number = 20): RequestRecord[] {
    return this.records.slice(-limit);
  }

  reset(): void {
    this.records = [];
    this.totalKB = 0;
    this.saveToStorage();
  }

  getRemainingMB(): number {
    return Math.max(0, parseFloat(((MONTHLY_BANDWIDTH_LIMIT_MB - this.totalKB / 1024)).toFixed(2)));
  }
}

export const bandwidthMonitor = new BandwidthMonitor((level, usedMB) => {
  if (level === 'critical') {
    console.warn(`[BandwidthMonitor] CRITICAL: ${usedMB.toFixed(2)} MB used this month. Approaching 2 GB limit.`);
  } else if (level === 'warning') {
    console.warn(`[BandwidthMonitor] WARNING: ${usedMB.toFixed(2)} MB used this month. Consider reducing polling.`);
  }
});

export function estimatePayloadSize(obj: any): number {
  try {
    const json = JSON.stringify(obj);
    return Math.max(1, Math.round(json.length / 1024));
  } catch {
    return 1;
  }
}

export { MONTHLY_BANDWIDTH_LIMIT_MB, WARNING_THRESHOLD_MB, CRITICAL_THRESHOLD_MB };
