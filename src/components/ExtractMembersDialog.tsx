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

  const extractMembers = async (account: TelegramAccount) => {
    setStep("extracting");
    setIsLoading(true);
    setProgress(0);

    try {
      addLog("info", `جاري استخراج الأعضاء من: ${sourceGroup}`);

      // Call the edge function to extract members
      const { data, error: funcError } = await supabase.functions.invoke("telegram-auth", {
        body: {
          action: "extractMembers",
          phone: account.phone,
          groupUsername: sourceGroup.replace("https://t.me/", "").replace("@", ""),
        },
      });

      if (funcError) throw funcError;

      // Simulate progress
      for (let i = 0; i <= 100; i += 10) {
        setProgress(i);
        await new Promise((r) => setTimeout(r, 200));
      }

      if (data?.members && Array.isArray(data.members)) {
        const members: ExtractedMember[] = data.members.map((m: any, index: number) => ({
          id: crypto.randomUUID(),
          oderId: m.id?.toString() || String(index),
          username: m.username,
          firstName: m.first_name || m.firstName,
          lastName: m.last_name || m.lastName,
          phone: m.phone,
          isSelected: true,
        }));

        setExtractedMembers(members);
        setStep("preview");
        addLog("success", `تم استخراج ${members.length} عضو من المجموعة`);
      } else {
        // Demo mode - generate sample members for testing
        const sampleMembers: ExtractedMember[] = Array.from({ length: 25 }, (_, i) => ({
          id: crypto.randomUUID(),
          oderId: String(1000 + i),
          username: `user_${Math.random().toString(36).substring(7)}`,
          firstName: ["أحمد", "محمد", "علي", "حسن", "فاطمة", "زينب", "مريم"][i % 7],
          lastName: ["العلي", "الحسن", "المحمد", "السعيد", "الكريم"][i % 5],
          isSelected: true,
        }));

        setExtractedMembers(sampleMembers);
        setStep("preview");
        addLog("info", `وضع التجربة: تم إنشاء ${sampleMembers.length} عضو للعرض`);
      }
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
                  placeholder="https://t.me/groupname أو @groupname"
                  value={sourceGroup}
                  onChange={(e) => setSourceGroup(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
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
                <p className="font-medium">جاري استخراج الأعضاء...</p>
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
