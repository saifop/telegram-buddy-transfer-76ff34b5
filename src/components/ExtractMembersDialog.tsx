import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  UserPlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "./MembersList";
import type { TelegramAccount } from "@/pages/Index";

interface ExtractMembersDialogProps {
  accounts: TelegramAccount[];
  onMembersExtracted: (members: Member[]) => void;
  addLog: (type: "info" | "success" | "warning" | "error", message: string) => void;
}

type ExtractStep = "input" | "selecting-account" | "extracting" | "preview" | "done" | "error";

interface ExtractedMember {
  id: string;
  oderId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  accessHash?: string;
  isSelected: boolean;
}

export function ExtractMembersDialog({
  accounts,
  onMembersExtracted,
  addLog,
}: ExtractMembersDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ExtractStep>("input");
  const [sourceGroup, setSourceGroup] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [extractedMembers, setExtractedMembers] = useState<ExtractedMember[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const connectedAccounts = accounts.filter((a) => a.status === "connected");

  const resetDialog = () => {
    setStep("input");
    setSourceGroup("");
    setSelectedAccountId("");
    setExtractedMembers([]);
    setProgress(0);
    setError("");
    setSearchQuery("");
    setIsLoading(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetDialog();
    }
  };

  const handleStartExtraction = async () => {
    if (!sourceGroup.trim()) {
      setError("الرجاء إدخال رابط أو معرف المجموعة");
      return;
    }

    if (connectedAccounts.length === 0) {
      setError("لا توجد حسابات متصلة. الرجاء استخراج جلسة أولاً");
      return;
    }

    if (connectedAccounts.length === 1) {
      setSelectedAccountId(connectedAccounts[0].id);
      await extractMembers(connectedAccounts[0]);
    } else {
      setStep("selecting-account");
    }
  };

  const [extractionStatus, setExtractionStatus] = useState("");

  const isPrivateLink = (link: string) => {
    return link.includes("/+") || link.includes("joinchat/");
  };

  const extractMembers = async (account: TelegramAccount) => {
    setStep("extracting");
    setIsLoading(true);
    setProgress(0);

    try {
      // Step 0: If private link, join the group first and get chatId
      let resolvedChatId: string | null = null;
      
      if (isPrivateLink(sourceGroup)) {
        setExtractionStatus("جاري الانضمام للمجموعة الخاصة...");
        addLog("info", `رابط خاص، جاري الانضمام أولاً: ${sourceGroup}`);
        
        const { data: joinData, error: joinError } = await supabase.functions.invoke("telegram-auth", {
          body: {
            action: "joinGroup",
            sessionString: account.sessionString,
            groupLink: sourceGroup,
            apiId: account.apiId,
            apiHash: account.apiHash,
          },
        });

        if (joinError) {
          const errText = joinError.message || "";
          if (!errText.includes("already") && !errText.includes("موجود")) {
            throw new Error(`فشل الانضمام: ${joinError.message}`);
          }
        }
        if (joinData?.error) {
          const errText = joinData.error;
          if (!errText.includes("already") && !errText.includes("موجود") && !errText.includes("USER_ALREADY_PARTICIPANT")) {
            throw new Error(`فشل الانضمام: ${errText}`);
          }
        }
        
        // Capture the resolved chatId from join response
        if (joinData?.chatId) {
          resolvedChatId = joinData.chatId.toString();
          addLog("success", `تم الانضمام بنجاح (chatId: ${resolvedChatId})`);
        } else {
          addLog("success", "تم الانضمام للمجموعة الخاصة بنجاح");
        }
        
        await new Promise(r => setTimeout(r, 2000));
      }

      addLog("info", `جاري استخراج جميع الأعضاء من: ${sourceGroup}`);

      const allMembers: any[] = [];
      const seenIds = new Set<string>();

      // Step 1: Initial request
      setExtractionStatus("جاري بدء الاستخراج...");
      const extractBody: any = {
        action: "getGroupMembers",
        sessionString: account.sessionString,
        apiId: account.apiId,
        apiHash: account.apiHash,
      };
      // Use chatId for private groups, groupLink for public
      if (resolvedChatId) {
        extractBody.chatId = resolvedChatId;
      } else {
        extractBody.groupLink = sourceGroup;
      }
      
      const { data: initData, error: initError } = await supabase.functions.invoke("telegram-auth", {
        body: extractBody,
      });

      if (initError) throw initError;
      if (initData?.error) throw new Error(initData.error);

      // Collect initial members
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

      setExtractionStatus(`تم جلب ${allMembers.length} عضو... (1/${totalQueries})`);
      setProgress(Math.round((1 / totalQueries) * 100));

      // Step 2: Iterate through remaining search queries one by one
      for (let i = 0; i < remainingQueries.length; i++) {
        const q = remainingQueries[i];
        const queryNum = i + 2;

        try {
          const batchBody: any = {
              action: "getGroupMembers",
              sessionString: account.sessionString,
              apiId: account.apiId,
              apiHash: account.apiHash,
              searchQuery: q,
              knownIds: Array.from(seenIds),
            };
            if (resolvedChatId) {
              batchBody.chatId = resolvedChatId;
            } else {
              batchBody.groupLink = sourceGroup;
            }
            const { data, error: funcError } = await supabase.functions.invoke("telegram-auth", {
            body: batchBody,
          });

          if (funcError) {
            addLog("warning", `خطأ في استعلام "${q}": ${funcError.message}`);
            continue;
          }

          if (data?.error) {
            // If flood, wait and continue
            if (data.error.includes("تجاوز الحد") || data.error.includes("FLOOD")) {
              addLog("warning", `تجاوز الحد عند "${q}"، متابعة...`);
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
            addLog("warning", `خطأ في "${q}": ${data.error}`);
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
        } catch (err: any) {
          addLog("warning", `خطأ في استعلام "${q}": ${err.message}`);
          continue;
        }

        setExtractionStatus(`تم جلب ${allMembers.length} عضو... (${queryNum}/${totalQueries})`);
        setProgress(Math.round((queryNum / totalQueries) * 100));

        // Small delay between queries
        await new Promise(r => setTimeout(r, 500));
      }

      // Deduplicate and format - include ALL members (with and without username)
      const seenIds2 = new Set<string>();
      const uniqueMembers: ExtractedMember[] = [];
      let withUsername = 0;
      let withoutUsername = 0;
      for (const m of allMembers) {
        const oderId = m.id?.toString() || "";
        if (!oderId || seenIds2.has(oderId)) continue;
        seenIds2.add(oderId);
        const hasUsername = !!(m.username && m.username.trim());
        if (hasUsername) withUsername++; else withoutUsername++;
        uniqueMembers.push({
          id: crypto.randomUUID(),
          oderId,
          username: m.username || "",
          firstName: m.first_name || m.firstName,
          lastName: m.last_name || m.lastName,
          phone: m.phone,
          accessHash: m.accessHash || "",
          isSelected: true,
        });
      }

      setProgress(100);
      setExtractionStatus("");
      setExtractedMembers(uniqueMembers);
      setStep("preview");
      addLog("success", `تم استخراج ${uniqueMembers.length} عضو (${withUsername} بيوزرنيم، ${withoutUsername} بدون يوزرنيم)`);
    } catch (err: any) {
      console.error("Extraction error:", err);
      setError(err.message || "فشل في استخراج الأعضاء");
      setStep("error");
      addLog("error", `فشل استخراج الأعضاء: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccountSelect = (account: TelegramAccount) => {
    setSelectedAccountId(account.id);
    extractMembers(account);
  };

  const toggleMember = (id: string) => {
    setExtractedMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isSelected: !m.isSelected } : m))
    );
  };

  const selectAll = (selected: boolean) => {
    setExtractedMembers((prev) => prev.map((m) => ({ ...m, isSelected: selected })));
  };

  const handleAddToList = () => {
    const selectedMembers: Member[] = extractedMembers
      .filter((m) => m.isSelected)
      .map((m) => ({
        id: m.id,
        oderId: m.oderId,
        username: m.username,
        firstName: m.firstName,
        lastName: m.lastName,
        phone: m.phone,
        accessHash: m.accessHash,
        isSelected: true,
        status: "pending" as const,
      }));

    onMembersExtracted(selectedMembers);
    addLog("success", `تم إضافة ${selectedMembers.length} عضو إلى القائمة`);
    setStep("done");
  };

  const filteredMembers = extractedMembers.filter((m) => {
    const query = searchQuery.toLowerCase();
    return (
      m.username?.toLowerCase().includes(query) ||
      m.firstName?.toLowerCase().includes(query) ||
      m.lastName?.toLowerCase().includes(query) ||
      m.oderId.includes(query)
    );
  });

  const selectedCount = extractedMembers.filter((m) => m.isSelected).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Users className="w-4 h-4" />
          استخراج أعضاء
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            استخراج أعضاء من مجموعة
          </DialogTitle>
          <DialogDescription>
            استخرج قائمة الأعضاء من مجموعة تيليجرام لإضافتهم إلى مجموعتك
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Step: Input */}
          {step === "input" && (
            <div className="space-y-4">
              <div className="space-y-2">
                 <Label>رابط أو معرف المجموعة المصدر</Label>
                <Input
                  placeholder="https://t.me/groupname أو https://t.me/+invite"
                  value={sourceGroup}
                  onChange={(e) => setSourceGroup(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
                {isPrivateLink(sourceGroup) && (
                  <p className="text-xs text-amber-500 mt-1">🔒 رابط خاص — سيتم الانضمام تلقائياً قبل الاستخراج</p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  {error}
                </div>
              )}

              <div className="p-3 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
                <p className="font-medium mb-1">ملاحظات:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>يجب أن يكون الحساب عضواً في المجموعة المصدر</li>
                  <li>بعض المجموعات قد تمنع استخراج الأعضاء</li>
                  <li>سيتم استخراج الأعضاء المرئيين فقط</li>
                </ul>
              </div>

              <Button onClick={handleStartExtraction} className="w-full gap-2">
                <Download className="w-4 h-4" />
                بدء الاستخراج
              </Button>
            </div>
          )}

          {/* Step: Selecting Account */}
          {step === "selecting-account" && (
            <div className="space-y-4">
              <Label>اختر الحساب للاستخراج</Label>
              <div className="space-y-2">
                {connectedAccounts.map((account) => (
                  <Button
                    key={account.id}
                    variant="outline"
                    className="w-full justify-start gap-3"
                    onClick={() => handleAccountSelect(account)}
                  >
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span dir="ltr">{account.phone}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Step: Extracting */}
          {step === "extracting" && (
            <div className="space-y-4 text-center py-4">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <div>
                <p className="font-medium">جاري استخراج جميع الأعضاء...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  من: {sourceGroup}
                </p>
                {extractionStatus && (
                  <p className="text-xs text-muted-foreground mt-2">{extractionStatus}</p>
                )}
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Step: Preview */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">
                  {extractedMembers.length} عضو
                </Badge>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectAll(true)}
                  >
                    تحديد الكل
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectAll(false)}
                  >
                    إلغاء الكل
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-9"
                />
              </div>

              <ScrollArea className="h-60 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredMembers.map((member) => (
                    <div
                      key={member.id}
                      className={`flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer ${
                        member.isSelected ? "bg-accent" : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleMember(member.id)}
                    >
                      <Checkbox
                        checked={member.isSelected}
                        onCheckedChange={() => toggleMember(member.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {member.firstName || member.lastName
                            ? `${member.firstName || ""} ${member.lastName || ""}`.trim()
                            : member.username
                            ? `@${member.username}`
                            : `ID: ${member.oderId}`}
                        </p>
                        {member.username && (member.firstName || member.lastName) && (
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            @{member.username}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted-foreground">
                  محدد: {selectedCount} من {extractedMembers.length}
                </span>
                <Button
                  onClick={handleAddToList}
                  disabled={selectedCount === 0}
                  className="gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  إضافة للقائمة
                </Button>
              </div>
            </div>
          )}

          {/* Step: Done */}
          {step === "done" && (
            <div className="text-center py-6 space-y-4">
              <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
              <div>
                <p className="font-medium text-lg">تم بنجاح!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  تم إضافة {selectedCount} عضو إلى القائمة
                </p>
              </div>
              <Button onClick={() => handleOpenChange(false)} className="w-full">
                إغلاق
              </Button>
            </div>
          )}

          {/* Step: Error */}
          {step === "error" && (
            <div className="text-center py-6 space-y-4">
              <AlertCircle className="w-16 h-16 mx-auto text-destructive" />
              <div>
                <p className="font-medium text-lg">حدث خطأ</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={resetDialog} className="flex-1">
                  إعادة المحاولة
                </Button>
                <Button onClick={() => handleOpenChange(false)} className="flex-1">
                  إغلاق
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
