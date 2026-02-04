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
import {
  Key,
  Phone,
  Hash,
  Loader2,
  CheckCircle,
  Download,
  AlertCircle,
  Shield,
} from "lucide-react";
import { useTelegramAuth, AuthStep } from "@/hooks/useTelegramAuth";

interface ExtractSessionDialogProps {
  onSessionExtracted: (sessionData: {
    phone: string;
    sessionFile: string;
    sessionContent: string;
    apiId?: number;
    apiHash?: string;
  }) => void;
}

export function ExtractSessionDialog({ onSessionExtracted }: ExtractSessionDialogProps) {
  const [open, setOpen] = useState(false);
  
  // Form data - Pre-configured API credentials
  const [apiId] = useState("38763488");
  const [apiHash] = useState("e7e593b5bfed97ca142c557824361e02");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");

  // Use the Telegram auth hook
  const {
    step,
    isLoading,
    error,
    sessionData,
    sendCode,
    verifyCode,
    verify2FA,
    reset,
  } = useTelegramAuth();

  const resetForm = () => {
    reset();
    setPhoneNumber("");
    setVerificationCode("");
    setTwoFactorPassword("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  const handleSubmitCredentials = async () => {
    // Validate credentials format
    if (!apiId || !apiHash) {
      return;
    }
    // Just advance to phone step visually - no API call yet
    // The actual API call happens when user submits phone number
  };

  const handleSubmitPhone = async () => {
    await sendCode(apiId, apiHash, phoneNumber);
  };

  const handleSubmitCode = async () => {
    await verifyCode(verificationCode);
  };

  const handleSubmit2FA = async () => {
    await verify2FA(twoFactorPassword);
  };

  const handleSaveSession = () => {
    if (!sessionData) return;

    const blob = new Blob([sessionData.sessionContent], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sessionData.sessionFile;
    a.click();
    URL.revokeObjectURL(url);

    // Notify parent component with API credentials
    onSessionExtracted({
      ...sessionData,
      apiId: apiId ? parseInt(apiId) : undefined,
      apiHash: apiHash || undefined,
    });

    handleOpenChange(false);
  };

  const getStepProgress = (currentStep: AuthStep) => {
    switch (currentStep) {
      case "credentials":
        return 25;
      case "phone":
        return 50;
      case "code":
        return 75;
      case "password":
        return 90;
      case "success":
        return 100;
      default:
        return 0;
    }
  };

  const getStepLabel = (currentStep: AuthStep) => {
    switch (currentStep) {
      case "credentials":
        return "بيانات API";
      case "phone":
        return "رقم الهاتف";
      case "code":
        return "رمز التحقق";
      case "password":
        return "التحقق بخطوتين";
      case "success":
        return "تم بنجاح";
      default:
        return "";
    }
  };

  // Always show phone step directly since credentials are pre-configured
  const showPhoneStep = step === "credentials";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-2">
          <Key className="w-4 h-4" />
          استخراج جلسة جديدة
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            استخراج جلسة تيليجرام
          </DialogTitle>
          <DialogDescription>
            قم بتسجيل الدخول لاستخراج ملف الجلسة
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">التقدم</span>
            <Badge variant="outline">{getStepLabel(step)}</Badge>
          </div>
          <Progress value={getStepProgress(step)} className="h-2" />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Step: Phone - Show directly since credentials are pre-configured */}
        {showPhoneStep && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                رقم الهاتف
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+964XXXXXXXXX"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                dir="ltr"
                className="text-left"
              />
              <p className="text-xs text-muted-foreground">
                أدخل الرقم مع رمز الدولة
              </p>
            </div>

            <Button
              onClick={handleSubmitPhone}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : null}
              إرسال رمز التحقق
            </Button>
          </div>
        )}

        {/* Step: Verification Code */}
        {step === "code" && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-accent/50 text-sm text-center">
              تم إرسال رمز التحقق إلى
              <span className="font-mono font-medium mx-1" dir="ltr">
                {phoneNumber}
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">رمز التحقق</Label>
              <Input
                id="code"
                type="text"
                placeholder="XXXXX"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                maxLength={6}
                dir="ltr"
                className="text-center text-2xl tracking-widest"
              />
            </div>

            <Button
              onClick={handleSubmitCode}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : null}
              تأكيد
            </Button>
          </div>
        )}

        {/* Step: 2FA Password */}
        {step === "password" && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-accent/50 text-sm flex items-center gap-2">
              <Shield className="w-4 h-4" />
              حسابك محمي بالتحقق بخطوتين
            </div>

            <div className="space-y-2">
              <Label htmlFor="2fa">كلمة مرور التحقق بخطوتين</Label>
              <Input
                id="2fa"
                type="password"
                placeholder="أدخل كلمة المرور"
                value={twoFactorPassword}
                onChange={(e) => setTwoFactorPassword(e.target.value)}
              />
            </div>

            <Button
              onClick={handleSubmit2FA}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : null}
              تسجيل الدخول
            </Button>
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && sessionData && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="font-semibold text-lg">تم استخراج الجلسة بنجاح!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                رقم الهاتف: <span dir="ltr">{sessionData.phone}</span>
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <p>• ملف الجلسة يحتوي على بيانات تسجيل الدخول</p>
              <p>• احتفظ به في مكان آمن</p>
              <p>• لا تشاركه مع أي شخص</p>
            </div>

            <Button onClick={handleSaveSession} className="w-full gap-2">
              <Download className="w-4 h-4" />
              حفظ ملف الجلسة
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
