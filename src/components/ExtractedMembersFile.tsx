import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, FileJson, FileText, Check, AlertCircle } from "lucide-react";
import type { Member } from "./MembersList";

interface ExtractedMembersFileProps {
  members: Member[];
  onImportMembers: (members: Member[]) => void;
  addLog: (type: "info" | "success" | "warning" | "error", message: string) => void;
}

export interface ExtractedMemberFile {
  extractedAt: string;
  sourceGroup?: string;
  totalMembers: number;
  members: {
    id: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    status: string;
    addedAt?: string;
  }[];
}

export function ExtractedMembersFile({
  members,
  onImportMembers,
  addLog,
}: ExtractedMembersFileProps) {
  const [importStats, setImportStats] = useState<{ total: number; new: number } | null>(null);

  const CHUNK_SIZE = 15000;

  const downloadChunked = (membersList: typeof members, filePrefix: string) => {
    const mapped = membersList.map((m) => ({
      id: m.oderId,
      username: m.username,
      firstName: m.firstName,
      lastName: m.lastName,
      phone: m.phone,
      status: m.status,
      addedAt: m.addedAt?.toISOString(),
    }));

    const totalChunks = Math.ceil(mapped.length / CHUNK_SIZE);
    const date = new Date().toISOString().split("T")[0];

    for (let i = 0; i < totalChunks; i++) {
      const chunk = mapped.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const extractedData: ExtractedMemberFile = {
        extractedAt: new Date().toISOString(),
        totalMembers: chunk.length,
        members: chunk,
      };

      const blob = new Blob([JSON.stringify(extractedData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = totalChunks > 1 ? `-part${i + 1}of${totalChunks}` : "";
      a.download = `${filePrefix}-${date}${suffix}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    const chunksMsg = totalChunks > 1 ? ` (${totalChunks} ملفات)` : "";
    addLog("success", `تم تحميل ${membersList.length} عضو${chunksMsg}`);
  };

  // Download all extracted members
  const handleDownloadExtracted = () => {
    downloadChunked(members, "extracted-members");
  };

  // Download only successfully added members
  const handleDownloadSuccessful = () => {
    const addedMembers = members.filter((m) => m.status === "added");
    
    if (addedMembers.length === 0) {
      addLog("warning", "لا يوجد أعضاء تمت إضافتهم بنجاح");
      return;
    }

    downloadChunked(addedMembers, "successful-members");
  };

  // Import members from file
  const handleImportFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = event.target?.result as string;
            const data: ExtractedMemberFile = JSON.parse(content);

            if (!data.members || !Array.isArray(data.members)) {
              throw new Error("Invalid file format");
            }

            // Get existing member IDs to avoid duplicates
            const existingIds = new Set(members.map((m) => m.oderId));

            const importedMembers: Member[] = data.members
              .filter((item) => !existingIds.has(item.id))
              .map((item) => ({
                id: crypto.randomUUID(),
                oderId: item.id,
                username: item.username,
                firstName: item.firstName,
                lastName: item.lastName,
                phone: item.phone,
                isSelected: true,
                status: "pending" as const,
              }));

            setImportStats({ total: data.members.length, new: importedMembers.length });
            
            if (importedMembers.length > 0) {
              onImportMembers(importedMembers);
              addLog("success", `تم استيراد ${importedMembers.length} عضو جديد من ${data.members.length}`);
            } else {
              addLog("warning", "جميع الأعضاء موجودون مسبقاً");
            }
          } catch (err) {
            console.error("Failed to import members:", err);
            addLog("error", "فشل في قراءة الملف - تأكد من صحة التنسيق");
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const addedCount = members.filter((m) => m.status === "added").length;
  const pendingCount = members.filter((m) => m.status === "pending").length;

  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileJson className="w-4 h-4" />
          ملفات الاستخراج
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="secondary" className="gap-1">
            <FileText className="w-3 h-3" />
            الكل: {members.length}
          </Badge>
          <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-600">
            <Check className="w-3 h-3" />
            نجاح: {addedCount}
          </Badge>
          <Badge variant="outline" className="gap-1">
            قيد الانتظار: {pendingCount}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Download All Extracted */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadExtracted}
            disabled={members.length === 0}
            className="gap-2"
          >
            <Download className="w-3 h-3" />
            تنزيل الكل
          </Button>

          {/* Download Successful Only */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadSuccessful}
            disabled={addedCount === 0}
            className="gap-2 bg-green-500/10 hover:bg-green-500/20 text-green-600"
          >
            <Download className="w-3 h-3" />
            الناجحين فقط
          </Button>
        </div>

        {/* Import Button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleImportFile}
          className="w-full gap-2"
        >
          <Upload className="w-3 h-3" />
          رفع ملف مستخرج
        </Button>

        {importStats && (
          <div className="p-2 rounded bg-accent text-xs flex items-center gap-2">
            {importStats.new > 0 ? (
              <>
                <Check className="w-3 h-3 text-green-500" />
                <span>تم استيراد {importStats.new} من {importStats.total}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-yellow-500" />
                <span>جميع الأعضاء موجودون مسبقاً</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
