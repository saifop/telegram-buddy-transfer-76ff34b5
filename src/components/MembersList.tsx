import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Trash2,
  CheckSquare,
  Square,
  Download,
  Upload,
  Search,
  UserPlus,
} from "lucide-react";

export interface Member {
  id: string;
  oderId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isSelected: boolean;
  status: "pending" | "added" | "failed" | "skipped" | "banned";
  errorMessage?: string;
  addedAt?: Date;
}

interface MembersListProps {
  members: Member[];
  onToggleMember: (id: string) => void;
  onSelectAll: (selected: boolean) => void;
  onRemoveMember: (id: string) => void;
  onClearAll: () => void;
  onImportMembers: (members: Member[]) => void;
  onExportMembers: () => void;
}

const statusConfig = {
  pending: { label: "قيد الانتظار", variant: "secondary" as const, color: "bg-gray-400" },
  added: { label: "تمت الإضافة", variant: "default" as const, color: "bg-green-500" },
  failed: { label: "فشل", variant: "destructive" as const, color: "bg-red-500" },
  skipped: { label: "تم تخطيه", variant: "outline" as const, color: "bg-yellow-500" },
  banned: { label: "محظور", variant: "destructive" as const, color: "bg-red-700" },
};

export function MembersList({
  members,
  onToggleMember,
  onSelectAll,
  onRemoveMember,
  onClearAll,
  onImportMembers,
  onExportMembers,
}: MembersListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCount = members.filter((m) => m.isSelected).length;
  const allSelected = members.length > 0 && selectedCount === members.length;

  const filteredMembers = members.filter((member) => {
    const query = searchQuery.toLowerCase();
    return (
      member.username?.toLowerCase().includes(query) ||
      member.firstName?.toLowerCase().includes(query) ||
      member.lastName?.toLowerCase().includes(query) ||
      member.oderId.includes(query)
    );
  });

  const stats = {
    total: members.length,
    pending: members.filter((m) => m.status === "pending").length,
    added: members.filter((m) => m.status === "added").length,
    failed: members.filter((m) => m.status === "failed").length,
    skipped: members.filter((m) => m.status === "skipped").length,
  };

  const handleImportClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.txt,.csv";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = event.target?.result as string;
            // Try JSON first
            try {
              const data = JSON.parse(content);
              const importedMembers: Member[] = (Array.isArray(data) ? data : [data]).map(
                (item: any, index: number) => ({
                  id: crypto.randomUUID(),
                  oderId: item.id || item.user_id || String(index),
                  username: item.username,
                  firstName: item.first_name || item.firstName,
                  lastName: item.last_name || item.lastName,
                  phone: item.phone,
                  isSelected: true,
                  status: "pending" as const,
                })
              );
              onImportMembers(importedMembers);
            } catch {
              // Try line-by-line format (usernames or IDs)
              const lines = content.split("\n").filter((l) => l.trim());
              const importedMembers: Member[] = lines.map((line, index) => ({
                id: crypto.randomUUID(),
                oderId: String(index),
                username: line.trim().replace("@", ""),
                isSelected: true,
                status: "pending" as const,
              }));
              onImportMembers(importedMembers);
            }
          } catch (err) {
            console.error("Failed to import members:", err);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  return (
    <Card className="flex-1 flex flex-col min-h-0">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            قائمة الأعضاء ({members.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleImportClick}
              title="استيراد قائمة"
            >
              <Upload className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onExportMembers}
              disabled={members.length === 0}
              title="تصدير القائمة"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectAll(!allSelected)}
              title={allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
            >
              {allSelected ? <Square className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              disabled={members.length === 0}
              title="مسح الكل"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-2 flex-wrap text-xs">
          <Badge variant="secondary">الكل: {stats.total}</Badge>
          <Badge variant="outline" className="bg-green-500/10 text-green-600">
            نجح: {stats.added}
          </Badge>
          <Badge variant="outline" className="bg-red-500/10 text-red-600">
            فشل: {stats.failed}
          </Badge>
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">
            تخطي: {stats.skipped}
          </Badge>
        </div>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث بالاسم أو المعرف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9 text-sm"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {filteredMembers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا يوجد أعضاء</p>
              <p className="text-xs">قم باستيراد قائمة أو استخراج الأعضاء من مجموعة</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMembers.map((member) => {
                const status = statusConfig[member.status];
                return (
                  <div
                    key={member.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      member.isSelected
                        ? "bg-accent border-primary/30"
                        : "bg-card hover:bg-accent/50"
                    }`}
                  >
                    <Checkbox
                      checked={member.isSelected}
                      onCheckedChange={() => onToggleMember(member.id)}
                    />
                    <div className={`w-2 h-2 rounded-full ${status.color}`} />
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
                      {member.errorMessage && (
                        <p className="text-xs text-destructive mt-1">{member.errorMessage}</p>
                      )}
                    </div>
                    <Badge variant={status.variant} className="text-xs">
                      {status.label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveMember(member.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
