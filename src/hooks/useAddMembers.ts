import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "@/components/MembersList";
import type { TelegramAccount, LogEntry } from "@/pages/Index";

interface AddSettings {
  targetGroup: string;
  sourceGroup: string;
  membersPerAccount: number;
  delayMin: number;
  delayMax: number;
  pauseAfterBan: boolean;
  skipExisting: boolean;
  rotateAccounts: boolean;
  maxRetries: number;
  cooldownAfterFlood: number;
}

interface UseAddMembersProps {
  members: Member[];
  accounts: TelegramAccount[];
  settings: AddSettings;
  addLog: (type: LogEntry["type"], message: string, accountPhone?: string) => void;
  onUpdateProgress: (progress: { current: number; total: number }) => void;
  onUpdateMemberStatus: (
    memberId: string,
    status: Member["status"],
    errorMessage?: string
  ) => void;
  onUpdateAccountStatus?: (
    accountId: string,
    status: TelegramAccount["status"],
    statusMessage?: string
  ) => void;
  onOperationStart: () => void;
  onOperationEnd: () => void;
}

// Account worker state
interface AccountWorker {
  account: TelegramAccount;
  pausedUntil: number | null; // timestamp when flood wait ends
  isWorking: boolean;
  addedCount: number;
}

export function useAddMembers({
  members,
  accounts,
  settings,
  addLog,
  onUpdateProgress,
  onUpdateMemberStatus,
  onUpdateAccountStatus,
  onOperationStart,
  onOperationEnd,
}: UseAddMembersProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getRandomDelay = () => {
    return Math.floor(Math.random() * (settings.delayMax - settings.delayMin + 1)) + settings.delayMin;
  };

  // Extract flood wait seconds from error message
  const extractFloodWaitSeconds = (errorMsg: string): number => {
    // Look for patterns like "FLOOD_WAIT_X" or "انتظر X ثانية"
    const match = errorMsg.match(/FLOOD_WAIT[_\s]*(\d+)/i) || errorMsg.match(/(\d+)\s*ثانية/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Default flood wait
    return settings.cooldownAfterFlood;
  };

  // Join a group with an account
  const joinGroupWithAccount = async (
    account: TelegramAccount,
    groupLink: string
  ): Promise<{ success: boolean; error?: string; alreadyJoined?: boolean }> => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "joinGroup",
          sessionString: account.sessionString,
          groupLink: groupLink,
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (error) {
        return { success: false, error: error.message || "فشل في الاتصال بالخادم" };
      }

      if (data?.success) {
        return { success: true, alreadyJoined: data.alreadyJoined };
      }

      const errorMsg = data?.error || "خطأ غير معروف";
      
      // Check if already a member
      if (errorMsg.includes("USER_ALREADY_PARTICIPANT") || errorMsg.includes("موجود مسبقاً")) {
        return { success: true, alreadyJoined: true };
      }

      return { success: false, error: errorMsg };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "خطأ غير متوقع";
      return { success: false, error: errorMessage };
    }
  };

  // Add a single member using a specific account
  const addMemberWithAccount = async (
    member: Member,
    account: TelegramAccount
  ): Promise<{ success: boolean; floodWait?: number; isBanned?: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "addMemberToGroup",
          sessionString: account.sessionString,
          groupLink: settings.targetGroup,
          sourceGroup: settings.sourceGroup,
          userId: member.oderId,
          username: member.username,
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (error) {
        return { success: false, error: error.message || "فشل في الاتصال بالخادم" };
      }

      if (data?.success) {
        return { success: true };
      }

      const errorMsg = data?.error || "خطأ غير معروف";

      // Check for flood wait
      if (errorMsg.toLowerCase().includes("flood") || errorMsg.includes("تم تجاوز الحد") || errorMsg.includes("429")) {
        const waitSeconds = extractFloodWaitSeconds(errorMsg);
        return { success: false, floodWait: waitSeconds, error: errorMsg };
      }

      // Check for ban
      if (errorMsg.includes("محظور") || errorMsg.includes("banned") || errorMsg.includes("BAN") || errorMsg.includes("CHAT_WRITE_FORBIDDEN")) {
        return { success: false, isBanned: true, error: errorMsg };
      }

      return { success: false, error: errorMsg };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "خطأ غير متوقع";
      return { success: false, error: errorMessage };
    }
  };

  // Worker function for each account - runs in parallel
  const accountWorkerFn = async (
    worker: AccountWorker,
    memberQueue: Member[],
    getNextMember: () => Member | null,
    onMemberProcessed: () => void,
    staggerDelayMs: number
  ) => {
    // Initial stagger delay so accounts don't all start at once
    await sleep(staggerDelayMs);

    while (!abortRef.current) {
      // Check if paused globally
      while (pauseRef.current && !abortRef.current) {
        await sleep(500);
      }
      if (abortRef.current) break;

      // Check if account is in flood wait
      if (worker.pausedUntil) {
        const now = Date.now();
        if (now < worker.pausedUntil) {
          const remainingSec = Math.ceil((worker.pausedUntil - now) / 1000);
          // Wait and check periodically
          await sleep(5000);
          continue;
        } else {
          // Flood wait ended, resume
          worker.pausedUntil = null;
          onUpdateAccountStatus?.(worker.account.id, "connected", undefined);
          addLog("success", `انتهى وقت الانتظار - استئناف الإضافة`, worker.account.phone);
        }
      }

      // Get next member to process
      const member = getNextMember();
      if (!member) {
        // No more members
        break;
      }

      // Skip members without username
      if (!member.username || !member.username.trim()) {
        const msg = "لا يمكن إضافة هذا العضو لأنه لا يملك username";
        onUpdateMemberStatus(member.id, "failed", msg);
        addLog("warning", msg, worker.account.phone);
        onMemberProcessed();
        continue;
      }

      addLog("info", `جاري إضافة: ${member.username || member.firstName}`, worker.account.phone);

      const result = await addMemberWithAccount(member, worker.account);

      if (result.success) {
        onUpdateMemberStatus(member.id, "added");
        worker.addedCount++;
        addLog("success", `تمت إضافة: ${member.username || member.firstName}`, worker.account.phone);
      } else if (result.floodWait) {
        // Put member back? No, mark as failed for this attempt
        onUpdateMemberStatus(member.id, "failed", result.error);
        addLog("warning", `تحذير Flood - انتظار ${result.floodWait} ثانية`, worker.account.phone);
        
        // Pause this account
        worker.pausedUntil = Date.now() + (result.floodWait * 1000);
        onUpdateAccountStatus?.(worker.account.id, "flood", `انتظار ${result.floodWait} ثانية`);
      } else if (result.isBanned) {
        onUpdateMemberStatus(member.id, "failed", result.error);
        onUpdateAccountStatus?.(worker.account.id, "banned", result.error);
        addLog("error", `الحساب محظور: ${worker.account.phone}`, worker.account.phone);
        
        // Stop this worker if banned
        break;
      } else {
        onUpdateMemberStatus(member.id, "failed", result.error);
        addLog("error", `فشل إضافة ${member.username || member.firstName}: ${result.error}`, worker.account.phone);
      }

      onMemberProcessed();

      // Delay before next operation
      const delay = getRandomDelay();
      await sleep(delay * 1000);
    }

    worker.isWorking = false;
  };

  const startAdding = useCallback(async () => {
    const selectedMembers = members.filter((m) => m.isSelected && m.status === "pending");
    const activeAccounts = accounts.filter((a) => a.isSelected && a.status === "connected" && a.sessionString);

    if (selectedMembers.length === 0) {
      addLog("warning", "لا يوجد أعضاء محددون للإضافة");
      return;
    }

    if (activeAccounts.length === 0) {
      addLog("error", "لا يوجد حسابات متصلة للإضافة");
      return;
    }

    if (!settings.targetGroup.trim()) {
      addLog("error", "يرجى تحديد المجموعة المستهدفة");
      return;
    }

    setIsRunning(true);
    abortRef.current = false;
    pauseRef.current = false;
    onOperationStart();

    // Step 1: Join groups with all accounts first
    addLog("info", `جاري انضمام ${activeAccounts.length} حساب للمجموعات...`);
    
    const groupsToJoin: string[] = [];
    if (settings.sourceGroup.trim()) {
      groupsToJoin.push(settings.sourceGroup.trim());
    }
    groupsToJoin.push(settings.targetGroup.trim());
    
    for (const account of activeAccounts) {
      if (abortRef.current) break;
      
      for (const groupLink of groupsToJoin) {
        if (abortRef.current) break;
        
        const groupName = groupLink.includes("/") ? groupLink.split("/").pop() : groupLink;
        addLog("info", `${account.phone} - جاري الانضمام إلى ${groupName}...`);
        
        const result = await joinGroupWithAccount(account, groupLink);
        
        if (result.success) {
          if (result.alreadyJoined) {
            addLog("info", `${account.phone} - موجود مسبقاً في ${groupName}`);
          } else {
            addLog("success", `${account.phone} - تم الانضمام إلى ${groupName}`);
          }
        } else {
          addLog("warning", `${account.phone} - فشل الانضمام إلى ${groupName}: ${result.error}`);
        }
        
        // Small delay between join attempts
        await sleep(2000);
      }
    }
    
    if (abortRef.current) {
      setIsRunning(false);
      setIsPaused(false);
      onOperationEnd();
      addLog("warning", "تم إلغاء العملية");
      return;
    }

    // Step 2: Start adding members
    addLog("info", `بدء إضافة ${selectedMembers.length} عضو بواسطة ${activeAccounts.length} حساب بالتوازي`);
    onUpdateProgress({ current: 0, total: selectedMembers.length });

    // Create a queue of members
    const memberQueue = [...selectedMembers];
    let queueIndex = 0;
    let processedCount = 0;

    // Thread-safe get next member
    const getNextMember = (): Member | null => {
      if (queueIndex >= memberQueue.length) return null;
      const member = memberQueue[queueIndex];
      queueIndex++;
      return member;
    };

    // Update progress when member processed
    const onMemberProcessed = () => {
      processedCount++;
      onUpdateProgress({ current: processedCount, total: selectedMembers.length });
    };

    // Create workers for each account
    const workers: AccountWorker[] = activeAccounts.map((account) => ({
      account,
      pausedUntil: null,
      isWorking: true,
      addedCount: 0,
    }));

    // Start all workers with staggered delays (2-5 seconds between each)
    const staggerDelay = 3000; // 3 seconds between each account start
    const workerPromises = workers.map((worker, index) =>
      accountWorkerFn(
        worker,
        memberQueue,
        getNextMember,
        onMemberProcessed,
        index * staggerDelay
      )
    );

    // Wait for all workers to finish
    await Promise.all(workerPromises);

    // Calculate results
    const successCount = workers.reduce((sum, w) => sum + w.addedCount, 0);
    const failCount = processedCount - successCount;

    setIsRunning(false);
    setIsPaused(false);
    onOperationEnd();
    addLog("success", `انتهت العملية: ${successCount} نجاح، ${failCount} فشل`);
    onUpdateProgress({ current: 0, total: 0 });
  }, [members, accounts, settings, addLog, onUpdateProgress, onUpdateMemberStatus, onUpdateAccountStatus, onOperationStart, onOperationEnd]);

  const pauseAdding = useCallback(() => {
    pauseRef.current = true;
    setIsPaused(true);
    addLog("warning", "تم إيقاف العملية مؤقتاً");
  }, [addLog]);

  const resumeAdding = useCallback(() => {
    pauseRef.current = false;
    setIsPaused(false);
    addLog("info", "تم استئناف العملية");
  }, [addLog]);

  const stopAdding = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
  }, []);

  return {
    isRunning,
    isPaused,
    startAdding,
    pauseAdding,
    resumeAdding,
    stopAdding,
  };
}
