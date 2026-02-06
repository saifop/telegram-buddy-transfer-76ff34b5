import { useState, useRef } from "react";
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
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  UserPlus,
  Download,
  CheckSquare,
  Square,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "./MembersList";
import type { TelegramAccount } from "@/pages/Index";

interface ActiveMembersExtractorProps {
  accounts: TelegramAccount[];
  onMembersExtracted: (members: Member[]) => void;
  addLog: (type: "info" | "success" | "warning" | "error", message: string) => void;
}

type ExtractStep = "input" | "selecting-accounts" | "extracting" | "preview" | "done" | "error";

interface ExtractedMember {
  id: string;
  oderId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isSelected: boolean;
  messageCount: number;
}

export function ActiveMembersExtractor({
  accounts,
  onMembersExtracted,
  addLog,
}: ActiveMembersExtractorProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ExtractStep>("input");
  const [sourceGroup, setSourceGroup] = useState("");
  const [messagesLimit, setMessagesLimit] = useState(100);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [extractedMembers, setExtractedMembers] = useState<ExtractedMember[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(false);

  const connectedAccounts = accounts.filter((a) => a.status === "connected" && a.sessionString);

  const resetDialog = () => {
    setStep("input");
    setSourceGroup("");
    setSelectedAccountIds(new Set());
    setExtractedMembers([]);
    setProgress(0);
    setError("");
    setSearchQuery("");
    setIsLoading(false);
    abortRef.current = false;
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      abortRef.current = true;
      resetDialog();
    }
  };

  const handleStartExtraction = () => {
    if (!sourceGroup.trim()) {
      setError("الرجاء إدخال رابط المجموعة");
      return;
    }

    if (connectedAccounts.length === 0) {
      setError("لا توجد حسابات متصلة");
      return;
    }

    // Auto-select all accounts
    setSelectedAccountIds(new Set(connectedAccounts.map((a) => a.id)));
    setStep("selecting-accounts");
  };

  const toggleAccountSelection = (accountId: string) => {
    setSelectedAccountIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(accountId)) {
        newSet.delete(accountId);
      } else {
        newSet.add(accountId);
      }
      return newSet;
    });
  };

  const selectAllAccounts = (selected: boolean) => {
    if (selected) {
      setSelectedAccountIds(new Set(connectedAccounts.map((a) => a.id)));
    } else {
      setSelectedAccountIds(new Set());
    }
  };

  const extractActiveMembers = async () => {
    setStep("extracting");
    setIsLoading(true);
    setProgress(0);
    abortRef.current = false;

    const selectedAccounts = connectedAccounts.filter((a) => selectedAccountIds.has(a.id));
    
    if (selectedAccounts.length === 0) {
      setError("الرجاء تحديد حساب واحد على الأقل");
      setStep("error");
      return;
    }

    addLog("info", `جاري استخراج الأعضاء المتفاعلين من: ${sourceGroup}`);

    const memberMap = new Map<string, ExtractedMember>();
    let currentAccountIdx = 0;
    let lastError = "";

    try {
      while (currentAccountIdx < selectedAccounts.length && !abortRef.current) {
        const account = selectedAccounts[currentAccountIdx];
        
        addLog("info", `محاولة الاستخراج بحساب: ${account.phone}`);
        
        try {
          // First join the group
          await supabase.functions.invoke("telegram-auth", {
            body: {
              action: "joinGroup",
              sessionString: account.sessionString,
              groupLink: sourceGroup,
              apiId: account.apiId,
              apiHash: account.apiHash,
            },
          });

          await new Promise((r) => setTimeout(r, 2000));

          // Get active chat participants
          const { data, error: funcError } = await supabase.functions.invoke("telegram-auth", {
            body: {
              action: "getActiveMembers",
              sessionString: account.sessionString,
              groupLink: sourceGroup,
              messagesLimit: messagesLimit,
              apiId: account.apiId,
              apiHash: account.apiHash,
            },
          });

          if (funcError) throw funcError;

          if (data?.success && data?.members) {
            data.members.forEach((m: any) => {
              const oderId = String(m.id);
              if (!memberMap.has(oderId)) {
                memberMap.set(oderId, {
                  id: crypto.randomUUID(),
                  oderId,
                  username: m.username,
                  firstName: m.firstName || m.first_name,
                  lastName: m.lastName || m.last_name,
                  isSelected: true,
                  messageCount: m.messageCount || 1,
                });
              } else {
                // Increment message count for existing member
                const existing = memberMap.get(oderId)!;
                existing.messageCount += m.messageCount || 1;
              }
            });

            addLog("success", `تم استخراج ${data.members.length} عضو متفاعل`);
            break; // Success, exit loop
          } else {
            throw new Error(data?.error || "فشل الاستخراج");
          }
        } catch (err: any) {
          lastError = err.message || "خطأ غير متوقع";
          addLog("warning", `فشل بحساب ${account.phone}: ${lastError}`);
          
          // Check if banned
          if (lastError.toLowerCase().includes("banned") || lastError.toLowerCase().includes("محظور")) {
            addLog("error", `الحساب ${account.phone} محظور - الانتقال للحساب التالي`);
          }
          
          currentAccountIdx++;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      // Simulate progress
      for (let i = 0; i <= 100; i += 10) {
        if (abortRef.current) break;
        setProgress(i);
        await new Promise((r) => setTimeout(r, 100));
      }

      if (memberMap.size > 0) {
        // Sort by message count (most active first)
        const sortedMembers = Array.from(memberMap.values()).sort(
          (a, b) => b.messageCount - a.messageCount
        );
        setExtractedMembers(sortedMembers);
        setStep("preview");
        addLog("success", `تم استخراج ${sortedMembers.length} عضو متفاعل إجمالي`);
      } else {
        if (abortRef.current) return;
        setError(lastError || "لم يتم العثور على أعضاء متفاعلين");
        setStep("error");
      }
    } catch (err: any) {
      if (abortRef.current) return;
      console.error("Active extraction error:", err);
      setError(err.message || "فشل في استخراج الأعضاء المتفاعلين");
      setStep("error");
      addLog("error", `فشل الاستخراج: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
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
        isSelected: true,
        status: "pending" as const,
      }));

    onMembersExtracted(selectedMembers);
    addLog("success", `تم إضافة ${selectedMembers.length} عضو متفاعل إلى القائمة`);
    setStep("done");
  };

  const handleDownloadExtracted = () => {
    const data = {
      extractedAt: new Date().toISOString(),
      sourceGroup,
      type: "active_members",
      totalMembers: extractedMembers.length,
      members: extractedMembers.map((m) => ({
        id: m.oderId,
        username: m.username,
        firstName: m.firstName,
        lastName: m.lastName,
        messageCount: m.messageCount,
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `active-members-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("success", "تم تحميل ملف الأعضاء المتفاعلين");
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
  const allAccountsSelected = selectedAccountIds.size === connectedAccounts.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <MessageSquare className="w-4 h-4" />
          استخراج المتفاعلين
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            استخراج الأعضاء المتفاعلين
          </DialogTitle>
          <DialogDescription>
            استخرج الأعضاء الذين يتفاعلون في المحادثة (يكتبون رسائل)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Step: Input */}
          {step === "input" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>رابط المجموعة</Label>
                <Input
                  placeholder="https://t.me/groupname أو @groupname"
                  value={sourceGroup}
                  onChange={(e) => setSourceGroup(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
              </div>

              <div className="space-y-2">
                <Label>عدد الرسائل للفحص</Label>
                <Input
                  type="number"
                  min={10}
                  max={1000}
                  value={messagesLimit}
                  onChange={(e) => setMessagesLimit(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  كلما زاد العدد، تم استخراج أعضاء أكثر (أبطأ)
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  {error}
                </div>
              )}

              <div className="p-3 rounded-lg bg-accent/50 border text-sm text-muted-foreground">
                <p className="font-medium mb-1">ملاحظات:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>يتم استخراج من كتب رسائل في المجموعة فقط</li>
                  <li>إذا حُظر حساب ينتقل تلقائياً للحساب التالي</li>
                  <li>الأعضاء الأكثر تفاعلاً يظهرون أولاً</li>
                </ul>
              </div>

              <Button onClick={handleStartExtraction} className="w-full gap-2">
                <MessageSquare className="w-4 h-4" />
                متابعة
              </Button>
            </div>
          )}

          {/* Step: Selecting Accounts */}
          {step === "selecting-accounts" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>اختر حسابات الاستخراج</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => selectAllAccounts(!allAccountsSelected)}
                >
                  {allAccountsSelected ? (
                    <>
                      <Square className="w-4 h-4 ml-1" />
                      إلغاء الكل
                    </>
                  ) : (
                    <>
                      <CheckSquare className="w-4 h-4 ml-1" />
                      تحديد الكل
                    </>
                  )}
                </Button>
              </div>
              
              <ScrollArea className="h-48 border rounded-lg p-2">
                <div className="space-y-2">
                  {connectedAccounts.map((account) => (
                    <div
                      key={account.id}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                        selectedAccountIds.has(account.id)
                          ? "bg-accent border border-primary/30"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => toggleAccountSelection(account.id)}
                    >
                      <Checkbox checked={selectedAccountIds.has(account.id)} />
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span dir="ltr" className="text-sm">{account.phone}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <p className="text-xs text-muted-foreground text-center">
                محدد: {selectedAccountIds.size} من {connectedAccounts.length}
              </p>

              <Button
                onClick={extractActiveMembers}
                className="w-full gap-2"
                disabled={selectedAccountIds.size === 0}
              >
                <MessageSquare className="w-4 h-4" />
                بدء الاستخراج
              </Button>
            </div>
          )}

          {/* Step: Extracting */}
          {step === "extracting" && (
            <div className="space-y-4 text-center py-4">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <div>
                <p className="font-medium">جاري استخراج المتفاعلين...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  من: {sourceGroup}
                </p>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground">{progress}%</p>
            </div>
          )}

          {/* Step: Preview */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">
                  {extractedMembers.length} عضو متفاعل
                </Badge>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => selectAll(true)}>
                    تحديد الكل
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => selectAll(false)}>
                    إلغاء الكل
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDownloadExtracted}>
                    <Download className="w-4 h-4" />
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
                        {member.username && (
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            @{member.username}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {member.messageCount} رسالة
                      </Badge>
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
                  تم إضافة {selectedCount} عضو متفاعل إلى القائمة
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
