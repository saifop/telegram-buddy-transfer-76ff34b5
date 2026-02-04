import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderOpen, Upload, FileText } from "lucide-react";

interface SessionManagerProps {
  onLoadSessions: (files: File[]) => void;
}

export function SessionManager({ onLoadSessions }: SessionManagerProps) {
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

  return (
    <Card className="flex-shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderOpen className="w-4 h-4" />
          تحميل الجلسات
        </CardTitle>
      </CardHeader>
      <CardContent>
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

        <div className="mt-4 flex gap-2">
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
