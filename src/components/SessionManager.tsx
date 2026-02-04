import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderOpen, Upload, FileText } from "lucide-react";
import { ExtractSessionDialog } from "./ExtractSessionDialog";

interface SessionManagerProps {
  onLoadSessions: (files: File[]) => void;
  onSessionExtracted?: (sessionData: {
    phone: string;
    sessionFile: string;
    sessionContent: string;
    apiId?: number;
    apiHash?: string;
  }) => void;
}

export function SessionManager({ onLoadSessions, onSessionExtracted }: SessionManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const sessionFiles = files.filter((f) => f.name.endsWith(".session"));
    if (sessionFiles.length > 0) {
      onLoadSessions(sessionFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const sessionFiles = files.filter((f) => f.name.endsWith(".session"));
    if (sessionFiles.length > 0) {
      onLoadSessions(sessionFiles);
    }
  };

  const handleSessionExtracted = (sessionData: {
    phone: string;
    sessionFile: string;
    sessionContent: string;
    apiId?: number;
    apiHash?: string;
  }) => {
    if (onSessionExtracted) {
      onSessionExtracted(sessionData);
    }
  };

  return (
    <Card className="flex-shrink-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            إدارة الجلسات
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Extract New Session Button */}
        <ExtractSessionDialog onSessionExtracted={handleSessionExtracted} />

        {/* Drag & Drop Area */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 hover:bg-accent/50 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-1">
            اسحب ملفات .session هنا
          </p>
          <p className="text-xs text-muted-foreground">أو انقر للتصفح</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".session"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText className="w-4 h-4 ml-2" />
            اختيار ملفات
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen className="w-4 h-4 ml-2" />
            فتح مجلد
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
