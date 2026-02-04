import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Users, Trash2, CheckSquare, Square } from "lucide-react";
import type { TelegramAccount } from "@/pages/Index";

interface AccountsListProps {
  accounts: TelegramAccount[];
  onToggleAccount: (id: string) => void;
  onSelectAll: (selected: boolean) => void;
  onRemoveAccount: (id: string) => void;
}

const statusConfig = {
  connected: { label: "متصل", variant: "default" as const, color: "bg-green-500" },
  disconnected: { label: "غير متصل", variant: "secondary" as const, color: "bg-gray-400" },
  loading: { label: "جاري...", variant: "outline" as const, color: "bg-yellow-500" },
  error: { label: "خطأ", variant: "destructive" as const, color: "bg-red-500" },
  banned: { label: "محظور", variant: "destructive" as const, color: "bg-red-700" },
};

export function AccountsList({
  accounts,
  onToggleAccount,
  onSelectAll,
  onRemoveAccount,
}: AccountsListProps) {
  const selectedCount = accounts.filter((a) => a.isSelected).length;
  const allSelected = accounts.length > 0 && selectedCount === accounts.length;

  return (
    <Card className="flex-1 flex flex-col min-h-0">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            الحسابات ({accounts.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectAll(!allSelected)}
              title={allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
            >
              {allSelected ? (
                <Square className="w-4 h-4" />
              ) : (
                <CheckSquare className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        {selectedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            محدد: {selectedCount} من {accounts.length}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد حسابات</p>
              <p className="text-xs">قم بتحميل ملفات الجلسات للبدء</p>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => {
                const status = statusConfig[account.status];
                return (
                  <div
                    key={account.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      account.isSelected
                        ? "bg-accent border-primary/30"
                        : "bg-card hover:bg-accent/50"
                    }`}
                  >
                    <Checkbox
                      checked={account.isSelected}
                      onCheckedChange={() => onToggleAccount(account.id)}
                    />
                    <div className={`w-2 h-2 rounded-full ${status.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" dir="ltr">
                        {account.phone}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {account.sessionFile}
                      </p>
                    </div>
                    <Badge variant={status.variant} className="text-xs">
                      {status.label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveAccount(account.id)}
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
