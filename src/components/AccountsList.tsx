import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Users, Trash2, CheckSquare, Square, RefreshCw, AlertTriangle, Ban, Zap } from "lucide-react";
import type { TelegramAccount } from "@/pages/Index";

interface AccountsListProps {
  accounts: TelegramAccount[];
  onToggleAccount: (id: string) => void;
  onSelectAll: (selected: boolean) => void;
  onRemoveAccount: (id: string) => void;
  onResetAccountStatus?: (id: string) => void;
}

const statusConfig = {
  connected: { label: "متصل", variant: "default" as const, color: "bg-green-500", icon: null },
  disconnected: { label: "غير متصل", variant: "secondary" as const, color: "bg-gray-400", icon: null },
  loading: { label: "جاري...", variant: "outline" as const, color: "bg-yellow-500", icon: null },
  error: { label: "خطأ", variant: "destructive" as const, color: "bg-red-500", icon: AlertTriangle },
  banned: { label: "محظور", variant: "destructive" as const, color: "bg-red-700", icon: Ban },
  flood: { label: "تحذير", variant: "outline" as const, color: "bg-orange-500", icon: Zap },
};

export function AccountsList({
  accounts,
  onToggleAccount,
  onSelectAll,
  onRemoveAccount,
  onResetAccountStatus,
}: AccountsListProps) {
  const selectedCount = accounts.filter((a) => a.isSelected).length;
  const allSelected = accounts.length > 0 && selectedCount === accounts.length;
  const bannedCount = accounts.filter((a) => a.status === "banned").length;
  const floodCount = accounts.filter((a) => a.status === "flood").length;

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
        <div className="flex flex-wrap gap-2 text-xs">
          {selectedCount > 0 && (
            <span className="text-muted-foreground">
              محدد: {selectedCount}
            </span>
          )}
          {bannedCount > 0 && (
            <span className="text-destructive flex items-center gap-1">
              <Ban className="w-3 h-3" />
              محظور: {bannedCount}
            </span>
          )}
          {floodCount > 0 && (
            <span className="text-orange-500 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              تحذير: {floodCount}
            </span>
          )}
        </div>
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
                const StatusIcon = status.icon;
                const isDisabled = account.status === "banned" || account.status === "flood";
                
                return (
                  <TooltipProvider key={account.id}>
                    <div
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        isDisabled
                          ? "bg-destructive/5 border-destructive/30 opacity-70"
                          : account.isSelected
                          ? "bg-accent border-primary/30"
                          : "bg-card hover:bg-accent/50"
                      }`}
                    >
                      <Checkbox
                        checked={account.isSelected}
                        onCheckedChange={() => onToggleAccount(account.id)}
                        disabled={isDisabled}
                      />
                      <div className={`w-2 h-2 rounded-full ${status.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" dir="ltr">
                          {account.phone}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{account.sessionFile}</span>
                          {(account.addedCount || account.failedCount) && (
                            <span className="flex-shrink-0">
                              {account.addedCount ? `✓${account.addedCount}` : ""}
                              {account.failedCount ? ` ✗${account.failedCount}` : ""}
                            </span>
                          )}
                        </div>
                        {account.statusMessage && (
                          <p className="text-xs text-destructive truncate mt-0.5">
                            {account.statusMessage}
                          </p>
                        )}
                      </div>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant={status.variant} className="text-xs flex items-center gap-1">
                            {StatusIcon && <StatusIcon className="w-3 h-3" />}
                            {status.label}
                          </Badge>
                        </TooltipTrigger>
                        {account.statusMessage && (
                          <TooltipContent>
                            <p>{account.statusMessage}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>

                      {isDisabled && onResetAccountStatus && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                          onClick={() => onResetAccountStatus(account.id)}
                          title="إعادة تفعيل"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveAccount(account.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TooltipProvider>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
