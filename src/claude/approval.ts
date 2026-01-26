import type { PendingApproval } from "../types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("approval");

/**
 * Queue for managing pending tool approvals
 */
export class ApprovalQueue {
  private pending: Map<string, PendingApproval> = new Map();

  /**
   * Add a pending approval to the queue
   * Returns a promise that resolves when the approval is resolved
   */
  add(approval: Omit<PendingApproval, "resolve" | "createdAt">): Promise<boolean> {
    return new Promise((resolve) => {
      const pendingApproval: PendingApproval = {
        ...approval,
        resolve,
        createdAt: Date.now(),
      };

      this.pending.set(approval.id, pendingApproval);
      logger.info(
        { toolId: approval.id, toolName: approval.toolName, sessionId: approval.sessionId },
        "Added pending approval"
      );
    });
  }

  /**
   * Resolve a pending approval
   */
  resolve(toolId: string, approved: boolean): boolean {
    const approval = this.pending.get(toolId);
    if (!approval) {
      logger.warn({ toolId }, "Attempted to resolve non-existent approval");
      return false;
    }

    logger.info({ toolId, approved, toolName: approval.toolName }, "Resolving approval");
    approval.resolve(approved);
    this.pending.delete(toolId);
    return true;
  }

  /**
   * Get a pending approval by ID
   */
  get(toolId: string): PendingApproval | undefined {
    return this.pending.get(toolId);
  }

  /**
   * Get all pending approvals for a session
   */
  getBySession(sessionId: string): PendingApproval[] {
    return Array.from(this.pending.values()).filter((a) => a.sessionId === sessionId);
  }

  /**
   * Get all pending approvals for a chat
   */
  getByChat(chatId: number): PendingApproval[] {
    return Array.from(this.pending.values()).filter((a) => a.chatId === chatId);
  }

  /**
   * Check if there are any pending approvals for a session
   */
  hasPending(sessionId: string): boolean {
    return this.getBySession(sessionId).length > 0;
  }

  /**
   * Get count of pending approvals
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Remove old approvals that have exceeded maxAge
   * @param maxAge Maximum age in milliseconds
   * @returns Number of approvals cleaned up
   */
  cleanup(maxAge: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, approval] of this.pending) {
      if (now - approval.createdAt > maxAge) {
        logger.info(
          { toolId: id, toolName: approval.toolName, age: now - approval.createdAt },
          "Cleaning up stale approval"
        );
        // Reject stale approvals
        approval.resolve(false);
        this.pending.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, "Cleaned up stale approvals");
    }

    return cleaned;
  }

  /**
   * Cancel all pending approvals for a session
   * @returns Number of approvals cancelled
   */
  cancelSession(sessionId: string): number {
    const approvals = this.getBySession(sessionId);
    for (const approval of approvals) {
      logger.info({ toolId: approval.id, toolName: approval.toolName }, "Cancelling approval");
      approval.resolve(false);
      this.pending.delete(approval.id);
    }
    return approvals.length;
  }

  /**
   * Clear all pending approvals (reject all)
   */
  clear(): void {
    for (const approval of this.pending.values()) {
      approval.resolve(false);
    }
    this.pending.clear();
    logger.info("Cleared all pending approvals");
  }

  /**
   * Get all pending approvals as an array
   */
  all(): PendingApproval[] {
    return Array.from(this.pending.values());
  }
}

// Singleton instance for the application
export const approvalQueue = new ApprovalQueue();
