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

  // Fetch existing members from the target group to skip them
  const fetchTargetGroupMembers = async (
    account: TelegramAccount
  ): Promise<Set<string>> => {
    const existingIds = new Set<string>();
    const existingUsernames = new Set<string>();
    let offset = 0;
    let hasMore = true;
    let safety = 0;

    addLog("info", `🔍 جاري فحص أعضاء المجموعة المستهدفة لتجنب الإضافات المكررة...`);

    while (hasMore && safety < 100) {
      safety++;
      try {
        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "getGroupMembers",
            sessionString: account.sessionString,
            groupLink: settings.targetGroup,
            apiId: account.apiId,
            apiHash: account.apiHash,
            limit: 200,
            offset,
          },
        });

        if (error || data?.error) {
          addLog("warning", `تعذر فحص أعضاء المجموعة المستهدفة: ${error?.message || data?.error}`);
          break;
        }

        const batch = Array.isArray(data?.members) ? data.members : [];
        for (const m of batch) {
          const id = String(m?.id ?? "");
          if (id) existingIds.add(id);
          const uname = (m?.username || "").toLowerCase().trim();
          if (uname) existingUsernames.add(uname);
        }

        hasMore = Boolean(data?.hasMore) && batch.length > 0;
        offset = typeof data?.nextOffset === "number" ? data.nextOffset : offset + batch.length;
        await sleep(1200);
      } catch {
        break;
      }
    }

    // Merge: return a combined set (IDs + usernames) for matching
    const combined = new Set<string>();
    existingIds.forEach(id => combined.add(id));
    existingUsernames.forEach(u => combined.add(u));
    
    addLog("info", `✅ تم العثور على ${existingIds.size} عضو موجود في المجموعة المستهدفة`);
    return combined;
  };

  // Check if a member already exists in the target group
  const isMemberInTargetGroup = (member: Member, existingSet: Set<string>): boolean => {
    if (existingSet.has(member.oderId)) return true;
    if (member.username && existingSet.has(member.username.toLowerCase().trim())) return true;
    return false;
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
        // Check for USER_ALREADY_PARTICIPANT returned as "success" — treat as skip
        if (data?.alreadyParticipant) {
          return { success: false, error: "العضو موجود مسبقاً في المجموعة" };
        }
        return { success: true };
      }

      const errorMsg = data?.error || "خطأ غير معروف";

      // USER_ALREADY_PARTICIPANT — not a real add
      if (errorMsg.includes("USER_ALREADY_PARTICIPANT") || errorMsg.includes("موجود مسبقاً")) {
        return { success: false, error: "العضو موجود مسبقاً في المجموعة" };
      }

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
          addLog("info", `⏳ ${worker.account.phone} - انتظار ${remainingSec} ثانية...`);
          await sleep(Math.min(10000, worker.pausedUntil - now));
          continue;
        } else {
          // Flood wait ended, resume
          worker.pausedUntil = null;
          onUpdateAccountStatus?.(worker.account.id, "connected", undefined);
          addLog("success", `✅ ${worker.account.phone} - انتهى وقت الانتظار، استئناف`);
        }
      }

      // Get next member to process
      const member = getNextMember();
      if (!member) break;

      // Skip members without username
      if (!member.username || !member.username.trim()) {
        onUpdateMemberStatus(member.id, "failed", "لا يملك username");
        onMemberProcessed();
        continue;
      }

      addLog("info", `جاري إضافة: @${member.username}`, worker.account.phone);

      let retries = 0;
      const maxRetries = settings.maxRetries || 2;
      let success = false;

      while (retries <= maxRetries && !abortRef.current && !success) {
        const result = await addMemberWithAccount(member, worker.account);

        if (result.success) {
          onUpdateMemberStatus(member.id, "added");
          worker.addedCount++;
          addLog("success", `✅ تمت إضافة: @${member.username}`, worker.account.phone);
          success = true;
        } else if (result.error?.includes("موجود مسبقاً")) {
          onUpdateMemberStatus(member.id, "skipped", "موجود مسبقاً في المجموعة");
          addLog("info", `⏭️ @${member.username} موجود مسبقاً`, worker.account.phone);
          success = true; // Don't retry
        } else if (result.floodWait) {
          const waitSec = result.floodWait;
          addLog("warning", `⚠️ Flood Wait ${waitSec}s على ${worker.account.phone}`, worker.account.phone);
          worker.pausedUntil = Date.now() + (waitSec * 1000);
          onUpdateAccountStatus?.(worker.account.id, "flood", `انتظار ${waitSec} ثانية`);
          // Don't mark member as failed - it will be picked up after cooldown
          // Put this member back by not calling onMemberProcessed yet
          // Wait for the flood to end
          await sleep(waitSec * 1000);
          worker.pausedUntil = null;
          onUpdateAccountStatus?.(worker.account.id, "connected", undefined);
          addLog("info", `✅ ${worker.account.phone} - استئناف بعد Flood Wait`);
          retries++;
        } else if (result.isBanned) {
          onUpdateMemberStatus(member.id, "failed", result.error);
          onUpdateAccountStatus?.(worker.account.id, "banned", result.error);
          addLog("error", `⛔ الحساب ${worker.account.phone} محظور`, worker.account.phone);
          // Stop this worker permanently
          worker.isWorking = false;
          onMemberProcessed();
          return;
        } else {
          // Other errors - retry
          retries++;
          if (retries <= maxRetries) {
            addLog("warning", `إعادة محاولة (${retries}/${maxRetries}): @${member.username}`, worker.account.phone);
            await sleep(5000);
          } else {
            onUpdateMemberStatus(member.id, "failed", result.error);
            addLog("error", `❌ فشل إضافة @${member.username}: ${result.error}`, worker.account.phone);
          }
        }
      }

      onMemberProcessed();

      // Delay before next operation - use longer delays for safety
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

    // Step 2: Pre-fetch existing members from target group to skip duplicates
    const existingMembers = await fetchTargetGroupMembers(activeAccounts[0]);
    
    // Filter out members already in target group
    const filteredMembers = selectedMembers.filter(m => {
      if (isMemberInTargetGroup(m, existingMembers)) {
        onUpdateMemberStatus(m.id, "skipped", "موجود مسبقاً في المجموعة المستهدفة");
        addLog("info", `⏭️ تخطي ${m.username || m.firstName} - موجود مسبقاً`);
        return false;
      }
      return true;
    });

    if (filteredMembers.length === 0) {
      addLog("success", "جميع الأعضاء موجودون مسبقاً في المجموعة المستهدفة!");
      setIsRunning(false);
      onOperationEnd();
      return;
    }

    const skippedCount = selectedMembers.length - filteredMembers.length;
    if (skippedCount > 0) {
      addLog("info", `تم تخطي ${skippedCount} عضو موجود مسبقاً`);
    }

    // Step 3: Start adding members
    addLog("info", `بدء إضافة ${filteredMembers.length} عضو بواسطة ${activeAccounts.length} حساب بالتوازي`);
    onUpdateProgress({ current: 0, total: filteredMembers.length });

    // Create a queue of members
    const memberQueue = [...filteredMembers];
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
