/**
 * Audit Logging System
 * Tracks all sensitive actions for security and compliance
 * Persisted to Supabase (ezz_audit_logs) - no local storage.
 */

export type AuditAction = 
  | 'rider_login'
  | 'rider_signup'
  | 'rider_logout'
  | 'driver_login'
  | 'driver_signup'
  | 'driver_logout'
  | 'admin_login'
  | 'admin_logout'
  | 'trip_requested'
  | 'trip_accepted'
  | 'trip_cancelled'
  | 'trip_completed'
  | 'driver_rated'
  | 'rider_rated'
  | 'driver_approved'
  | 'driver_rejected'
  | 'driver_frozen'
  | 'driver_unfrozen'
  | 'driver_deleted'
  | 'stats_updated'
  | 'location_added'
  | 'location_deleted'
  | 'password_changed'
  | 'data_exported'
  | 'data_imported';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  userId: string;
  userType: 'rider' | 'driver' | 'admin' | 'system';
  details: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

import { logAuditToDB } from '../supabaseService';

class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogs = 1000;

  // Cooldown per (userId + action) to avoid flooding audit table on repeated rapid failures.
  // e.g. a user smashing the login button 8x in 2 seconds should only write 1-2 audit rows.
  private lastWriteTimestamps = new Map<string, number>();
  private static readonly COOLDOWN_MS = 60000; // 1 minute between identical failed writes

  log(action: AuditAction, userId: string, userType: AuditLogEntry['userType'], details: string, success = true, errorMessage?: string): void {
    const entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      action,
      userId,
      userType,
      details,
      success,
      errorMessage,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    };

    this.logs.unshift(entry);
    
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // Persist to Supabase audit_logs table (no local storage)
    // Deduplicate failed writes: if the same userId + action + details failed within the last minute,
    // skip writing to the DB to prevent audit spam from rapid double-submits / retries.
    // Note: works even when errorMessage is omitted (many Login failed calls don't pass it),
    // so the cooldown actually prevents audit-table flooding from repeated invalid attempts.
    if (!success) {
      const key = `${action}::${userId}::${entry.details}`;
      const now = Date.now();
      const last = this.lastWriteTimestamps.get(key) || 0;
      if (now - last < AuditLogger.COOLDOWN_MS) {
        return;
      }
      this.lastWriteTimestamps.set(key, now);
    }

    logAuditToDB(entry);
  }

  getLogs(userId?: string, action?: AuditAction, limit = 100): AuditLogEntry[] {
    let filtered = this.logs;
    
    if (userId) {
      filtered = filtered.filter(log => log.userId === userId);
    }
    
    if (action) {
      filtered = filtered.filter(log => log.action === action);
    }
    
    return filtered.slice(0, limit);
  }

  clear(): void {
    this.logs = [];
  }
}

export const auditLogger = new AuditLogger();
