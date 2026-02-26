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
  ): Promise<{ success: boolean; floodWait?: number; isBanned?: boolean; isNotAdmin?: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "addMemberToGroup",
          sessionString: account.sessionString,
          groupLink: settings.targetGroup,
          sourceGroup: settings.sourceGroup,
          userId: member.oderId,
          username: member.username,
          accessHash: (member as any).accessHash || "",
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (error) {
        return { success: false, error: error.message || "فشل في الاتصال بالخادم" };
      }

      // Check alreadyParticipant flag (server may return success:true or success:false with this)
      if (data?.alreadyParticipant) {
        return { success: false, error: "العضو موجود مسبقاً في المجموعة" };
      }

      // If server returned success, trust it - InviteToChannel didn't throw
      if (data?.success) {
        return { success: true };
      }

      const errorMsg = data?.error || "خطأ غير معروف";

      // USER_ALREADY_PARTICIPANT — not a real add
      if (errorMsg.includes("USER_ALREADY_PARTICIPANT") || errorMsg.includes("موجود مسبقاً")) {
        return { success: false, error: "العضو موجود مسبقاً في المجموعة" };
      }

      // Skippable errors - don't retry, just skip this member
      if (errorMsg.includes("جهة اتصال متبادلة") || 
          errorMsg.includes("PEER_ID_INVALID") ||
          errorMsg.includes("ADD_NOT_CONFIRMED") ||
          errorMsg.includes("لم يتم تأكيد") ||
          errorMsg.includes("USER_PRIVACY_RESTRICTED") ||
          errorMsg.includes("خصوصية") ||
          errorMsg.includes("USER_CHANNELS_TOO_MUCH") ||
          errorMsg.includes("500 مجموعة")) {
        return { success: false, error: errorMsg };
      }

      // Check for flood wait (also check floodWait field from server)
      if (data?.floodWait || errorMsg.toLowerCase().includes("flood") || errorMsg.includes("تم تجاوز الحد") || errorMsg.includes("429")) {
        const waitSeconds = data?.floodWait || extractFloodWaitSeconds(errorMsg);
        return { success: false, floodWait: waitSeconds, error: errorMsg };
      }

      // Check for ban (actual ban, not just missing admin rights)
      if (errorMsg.includes("محظور") || errorMsg.includes("banned") || errorMsg.includes("USER_BANNED")) {
        return { success: false, isBanned: true, error: errorMsg };
      }

      // CHAT_WRITE_FORBIDDEN = not admin, should rotate account, not ban it
      if (errorMsg.includes("CHAT_WRITE_FORBIDDEN") || errorMsg.includes("ليس لديك صلاحية") || errorMsg.includes("مشرف")) {
        return { success: false, isNotAdmin: true, error: errorMsg };
      }

      return { success: false, error: errorMsg };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "خطأ غير متوقع";
      return { success: false, error: errorMessage };
    }
  };

  // Sequential adding: one request at a time, rotating accounts
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

    // Pre-filter: separate resolvable vs unresolvable members
    const hasSourceGroup = !!settings.sourceGroup.trim();
    const resolvableMembers: Member[] = [];
    const unresolvableMembers: Member[] = [];
    
    for (const m of selectedMembers) {
      const hasUsername = !!m.username?.trim();
      const hasAccessHash = !!(m as any).accessHash?.trim();
      
      if (hasUsername || hasAccessHash || hasSourceGroup) {
        resolvableMembers.push(m);
      } else {
        unresolvableMembers.push(m);
      }
    }

    // Mark unresolvable members as skipped
    if (unresolvableMembers.length > 0) {
      addLog("warning", `⚠️ ${unresolvableMembers.length} عضو بدون username أو accessHash وبدون مجموعة مصدر - سيتم تخطيهم`);
      for (const m of unresolvableMembers) {
        onUpdateMemberStatus(m.id, "skipped", "لا يوجد username أو accessHash - حدد المجموعة المصدر");
      }
    }

    if (resolvableMembers.length === 0) {
      addLog("error", "لا يوجد أعضاء قابلون للإضافة");
      setIsRunning(false);
      onOperationEnd();
      return;
    }

    // Direct adding without join step - sequential with account rotation (ONE request at a time)
    addLog("info", `بدء إضافة ${resolvableMembers.length} عضو بالتناوب على ${activeAccounts.length} حساب (طلب واحد في كل مرة)`);
    onUpdateProgress({ current: 0, total: resolvableMembers.length });

    // Track account states
    const accountFloodUntil = new Map<string, number>(); // accountId -> timestamp
    const bannedAccounts = new Set<string>();
    const notAdminAccounts = new Set<string>();
    let currentAccountIdx = 0;
    let successCount = 0;
    let processedCount = 0;

    const getAvailableAccount = (): TelegramAccount | null => {
      const now = Date.now();
      const totalAccounts = activeAccounts.length;
      
      for (let i = 0; i < totalAccounts; i++) {
        const idx = (currentAccountIdx + i) % totalAccounts;
        const acc = activeAccounts[idx];
        
        if (bannedAccounts.has(acc.id)) continue;
        if (notAdminAccounts.has(acc.id)) continue;
        
        const floodUntil = accountFloodUntil.get(acc.id);
        if (floodUntil && now < floodUntil) continue;
        
        // Clear expired flood
        if (floodUntil && now >= floodUntil) {
          accountFloodUntil.delete(acc.id);
          onUpdateAccountStatus?.(acc.id, "connected", undefined);
        }
        
        currentAccountIdx = (idx + 1) % totalAccounts;
        return acc;
      }
      
      // All accounts busy - find shortest flood wait
      let shortestWait = Infinity;
      for (const [accId, until] of accountFloodUntil) {
        if (!bannedAccounts.has(accId) && !notAdminAccounts.has(accId)) {
          shortestWait = Math.min(shortestWait, until - now);
        }
      }
      
      if (shortestWait < Infinity && shortestWait > 0) {
        return null; // Caller should wait
      }
      
      return null;
    };

    for (let i = 0; i < resolvableMembers.length && !abortRef.current; i++) {
      // Check pause
      while (pauseRef.current && !abortRef.current) {
        await sleep(500);
      }
      if (abortRef.current) break;

      const member = resolvableMembers[i];
      const memberLabel = member.username ? `@${member.username}` : (member.firstName || `ID:${member.oderId}`);

      let retries = 0;
      const maxRetries = settings.maxRetries || 2;
      let memberDone = false;

      while (!memberDone && retries <= maxRetries && !abortRef.current) {
        // Get available account (wait if all in flood)
        let account = getAvailableAccount();
        
        if (!account) {
          // All accounts in flood/banned - wait for shortest flood to end
          const now = Date.now();
          let shortestWait = Infinity;
          for (const [accId, until] of accountFloodUntil) {
            if (!bannedAccounts.has(accId) && !notAdminAccounts.has(accId)) {
              shortestWait = Math.min(shortestWait, until - now);
            }
          }
          
          if (shortestWait < Infinity && shortestWait > 0) {
            addLog("info", `⏳ جميع الحسابات في انتظار - ${Math.ceil(shortestWait / 1000)}s...`);
            await sleep(shortestWait + 1000);
            account = getAvailableAccount();
          }
          
          if (!account) {
            // All banned/not admin
            addLog("error", "لا يوجد حسابات متاحة - استنفذت جميع الحسابات");
            onUpdateMemberStatus(member.id, "failed", "لا يوجد حسابات متاحة");
            memberDone = true;
            break;
          }
        }

        addLog("info", `جاري إضافة: ${memberLabel}`, account.phone);
        const result = await addMemberWithAccount(member, account);

        if (result.success) {
          onUpdateMemberStatus(member.id, "added");
          successCount++;
          addLog("success", `✅ تمت إضافة: ${memberLabel}`, account.phone);
          memberDone = true;
        } else if (result.error?.includes("موجود مسبقاً")) {
          onUpdateMemberStatus(member.id, "skipped", "موجود مسبقاً");
          addLog("info", `⏭️ ${memberLabel} موجود مسبقاً`, account.phone);
          memberDone = true;
        } else if (
          result.error?.includes("جهة اتصال متبادلة") ||
          result.error?.includes("PEER_ID_INVALID") ||
          result.error?.includes("ADD_NOT_CONFIRMED") ||
          result.error?.includes("لم يتم تأكيد") ||
          result.error?.includes("USER_PRIVACY_RESTRICTED") ||
          result.error?.includes("خصوصية") ||
          result.error?.includes("USER_CHANNELS_TOO_MUCH") ||
          result.error?.includes("لا يمكن التعرف") ||
          result.error?.includes("INPUT_USER_DEACTIVATED") ||
          result.error?.includes("USER_ID_INVALID")
        ) {
          onUpdateMemberStatus(member.id, "skipped", result.error);
          addLog("info", `⏭️ تخطي ${memberLabel}: ${result.error}`, account.phone);
          memberDone = true;
        } else if (result.floodWait) {
          const waitSec = result.floodWait;
          addLog("warning", `⚠️ Flood Wait ${waitSec}s على ${account.phone}`, account.phone);
          accountFloodUntil.set(account.id, Date.now() + (waitSec * 1000));
          onUpdateAccountStatus?.(account.id, "flood", `انتظار ${waitSec}s`);
          // Don't increment retries - just rotate to next account
          retries++;
        } else if (result.isBanned) {
          bannedAccounts.add(account.id);
          onUpdateAccountStatus?.(account.id, "banned", result.error);
          addLog("error", `⛔ ${account.phone} محظور`, account.phone);
          retries++;
        } else if (result.isNotAdmin) {
          notAdminAccounts.add(account.id);
          onUpdateAccountStatus?.(account.id, "error", "ليس مشرفاً");
          addLog("error", `⚠️ ${account.phone} ليس مشرفاً`, account.phone);
          retries++;
        } else {
          retries++;
          if (retries <= maxRetries) {
            addLog("warning", `إعادة محاولة (${retries}/${maxRetries}): ${memberLabel}`, account.phone);
            await sleep(5000);
          } else {
            onUpdateMemberStatus(member.id, "failed", result.error);
            addLog("error", `❌ فشل إضافة ${memberLabel}: ${result.error}`, account.phone);
            memberDone = true;
          }
        }
      }

      processedCount++;
      onUpdateProgress({ current: processedCount, total: resolvableMembers.length });

      // Delay before next member
      if (!abortRef.current && i < resolvableMembers.length - 1) {
        const delay = getRandomDelay();
        await sleep(delay * 1000);
      }
    }

    setIsRunning(false);
    setIsPaused(false);
    onOperationEnd();
    addLog("success", `انتهت العملية: ${successCount} نجاح، ${processedCount - successCount} فشل/تخطي`);
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
