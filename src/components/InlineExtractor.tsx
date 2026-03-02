import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "./MembersList";
import type { TelegramAccount } from "@/pages/Index";
import { toast } from "sonner";

interface InlineExtractorProps {
  accounts: TelegramAccount[];
  onMembersExtracted: (members: Member[]) => void;
  addLog: (type: "info" | "success" | "warning" | "error", message: string) => void;
}

type ExtractStatus = "idle" | "extracting" | "done" | "error";

export function InlineExtractor({
  accounts,
  onMembersExtracted,
  addLog,
}: InlineExtractorProps) {
  const [sourceGroup, setSourceGroup] = useState("");
  const [status, setStatus] = useState<ExtractStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [extractedCount, setExtractedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef(false);

  const connectedAccounts = accounts.filter((a) => a.status === "connected" && a.sessionString);

  const handleExtract = async () => {
    const link = sourceGroup.trim();
    if (!link) {
      toast.error("أدخل رابط المجموعة");
      return;
    }
    if (connectedAccounts.length === 0) {
      toast.error("لا توجد حسابات متصلة");
      return;
    }

    abortRef.current = false;
    setStatus("extracting");
    setProgress(0);
    setExtractedCount(0);
    setErrorMsg("");

    const account = connectedAccounts[0]; // Use first connected account

    try {
      // Step 1: Join group
      setStatusText("جاري الانضمام للمجموعة...");
      let resolvedChatId: string | null = null;

      const { data: joinData, error: joinError } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "joinGroup",
          sessionString: account.sessionString,
          groupLink: link,
          apiId: account.apiId,
          apiHash: account.apiHash,
        },
      });

      if (joinError) {
        const errText = joinError.message || "";
        if (!errText.includes("already") && !errText.includes("موجود")) {
          // Not a "already joined" error, but continue anyway
          addLog("warning", `تحذير الانضمام: ${errText}`);
        }
      }
      if (joinData?.error) {
        const errText = joinData.error;
        if (!errText.includes("already") && !errText.includes("موجود") && !errText.includes("USER_ALREADY_PARTICIPANT") && !errText.includes("FLOOD")) {
          addLog("warning", `تحذير: ${errText}`);
        }
      }

      if (joinData?.chatId) {
        resolvedChatId = joinData.chatId.toString();
      }

      if (abortRef.current) return;
      await new Promise(r => setTimeout(r, 1500));

      // Step 2: Extract members
      setStatusText("جاري بدء الاستخراج...");
      addLog("info", `جاري استخراج الأعضاء من: ${link}`);

      const allMembers: any[] = [];
      const seenIds = new Set<string>();

      const extractBody: any = {
        action: "getGroupMembers",
        sessionString: account.sessionString,
        apiId: account.apiId,
        apiHash: account.apiHash,
        groupLink: link,
      };
      if (resolvedChatId) extractBody.chatId = resolvedChatId;

      const { data: initData, error: initError } = await supabase.functions.invoke("telegram-auth", {
        body: extractBody,
      });

      if (initError) throw initError;
      if (initData?.error) throw new Error(initData.error);

      const initMembers = Array.isArray(initData?.members) ? initData.members : [];
      for (const m of initMembers) {
        const id = m?.id?.toString?.() ?? "";
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allMembers.push(m);
        }
      }

      const remainingQueries: string[] = Array.isArray(initData?.remainingQueries) ? initData.remainingQueries : [];
      const totalQueries = remainingQueries.length + 1;

      setExtractedCount(allMembers.length);
      setStatusText(`تم جلب ${allMembers.length} عضو (1/${totalQueries})`);
      setProgress(Math.round((1 / totalQueries) * 100));

      // Step 3: Continue with remaining queries
      for (let i = 0; i < remainingQueries.length; i++) {
        if (abortRef.current) return;
        const q = remainingQueries[i];
        const queryNum = i + 2;

        try {
          // Only send last 200 knownIds to avoid request size limits
          const knownArr = Array.from(seenIds);
          const batchBody: any = {
            action: "getGroupMembers",
            sessionString: account.sessionString,
            apiId: account.apiId,
            apiHash: account.apiHash,
            groupLink: link,
            searchQuery: q,
            knownIds: knownArr.length > 200 ? knownArr.slice(-200) : knownArr,
          };
          if (resolvedChatId) batchBody.chatId = resolvedChatId;

          const { data, error: funcError } = await supabase.functions.invoke("telegram-auth", {
            body: batchBody,
          });

          if (funcError) {
            addLog("warning", `خطأ في "${q}": ${funcError.message}`);
            continue;
          }

          if (data?.error) {
            if (data.error.includes("تجاوز الحد") || data.error.includes("FLOOD")) {
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
            continue;
          }

          const batch = Array.isArray(data?.members) ? data.members : [];
          for (const m of batch) {
            const id = m?.id?.toString?.() ?? "";
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              allMembers.push(m);
            }
          }
        } catch {
          continue;
        }

        setExtractedCount(allMembers.length);
        setStatusText(`تم جلب ${allMembers.length} عضو (${queryNum}/${totalQueries})`);
        setProgress(Math.round((queryNum / totalQueries) * 100));

        await new Promise(r => setTimeout(r, 150));
      }

      // Step 4: Auto-add all members to list
      if (abortRef.current) return;

      const members: Member[] = allMembers.map((m) => ({
        id: crypto.randomUUID(),
        oderId: m.id?.toString() || "",
        username: m.username || "",
        firstName: m.first_name || m.firstName || "",
        lastName: m.last_name || m.lastName || "",
        phone: m.phone,
        accessHash: m.accessHash || "",
        isSelected: true,
        status: "pending" as const,
      }));

      // Deduplicate
      const seen2 = new Set<string>();
      const unique = members.filter((m) => {
        if (seen2.has(m.oderId)) return false;
        seen2.add(m.oderId);
        return true;
      });

      onMembersExtracted(unique);
      setExtractedCount(unique.length);
      setStatus("done");
      setProgress(100);
      setStatusText(`تم استخراج وإضافة ${unique.length} عضو تلقائياً`);
      addLog("success", `تم استخراج وإضافة ${unique.length} عضو من ${link}`);
      toast.success(`تم إضافة ${unique.length} عضو للقائمة`);

    } catch (err: any) {
      if (abortRef.current) return;
      setStatus("error");
      setErrorMsg(err.message || "فشل الاستخراج");
      addLog("error", `فشل الاستخراج: ${err.message}`);
    }
  };

  const handleCancel = () => {
    abortRef.current = true;
    setStatus("idle");
    setStatusText("");
    setProgress(0);
  };

  const handleReset = () => {
    setStatus("idle");
    setStatusText("");
    setProgress(0);
    setErrorMsg("");
    setSourceGroup("");
    setExtractedCount(0);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4" />
          استخراج أعضاء
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Input + Button */}
        <div className="flex gap-2">
          <Input
            placeholder="الصق رابط المجموعة هنا..."
            value={sourceGroup}
            onChange={(e) => setSourceGroup(e.target.value)}
            dir="ltr"
            className="text-xs h-8"
            disabled={status === "extracting"}
          />
          {status === "idle" || status === "done" || status === "error" ? (
            <Button
              size="sm"
              className="h-8 shrink-0 text-xs"
              onClick={handleExtract}
              disabled={!sourceGroup.trim() || connectedAccounts.length === 0}
            >
              استخراج
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="h-8 shrink-0 text-xs"
              onClick={handleCancel}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

        {/* Progress - shown during extraction */}
        {status === "extracting" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              <span>{statusText}</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* Done */}
        {status === "done" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3 h-3" />
              <span>{statusText}</span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleReset}>
              استخراج آخر
            </Button>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="w-3 h-3" />
              <span className="truncate">{errorMsg}</span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleReset}>
              إعادة
            </Button>
          </div>
        )}

        {connectedAccounts.length === 0 && (
          <p className="text-xs text-muted-foreground">أضف حساب متصل أولاً من تبويب الحسابات</p>
        )}
      </CardContent>
    </Card>
  );
}
