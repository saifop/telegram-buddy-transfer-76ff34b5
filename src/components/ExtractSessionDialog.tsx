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

interface ExtractSessionDialogProps {
  onSessionExtracted: (sessionData: {
    phone: string;
    sessionFile: string;
    sessionContent: string;
  }) => void;
}

type Step = "credentials" | "phone" | "code" | "password" | "success";

export function ExtractSessionDialog({ onSessionExtracted }: ExtractSessionDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("credentials");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Form data
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");

  // Session result
  const [sessionData, setSessionData] = useState<string | null>(null);

  const resetForm = () => {
    setStep("credentials");
    setIsLoading(false);
    setError("");
    setApiId("");
    setApiHash("");
    setPhoneNumber("");
    setVerificationCode("");
    setTwoFactorPassword("");
    setSessionData(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  const simulateApiCall = (delay: number = 1500) => {
    return new Promise((resolve) => setTimeout(resolve, delay));
  };

  const handleSubmitCredentials = async () => {
    if (!apiId || !apiHash) {
      setError("يرجى إدخال API ID و API Hash");
      return;
    }
    setError("");
    setIsLoading(true);
    await simulateApiCall(1000);
    setIsLoading(false);
    setStep("phone");
  };

  const handleSubmitPhone = async () => {
    if (!phoneNumber) {
      setError("يرجى إدخال رقم الهاتف");
      return;
    }
    setError("");
    setIsLoading(true);
    await simulateApiCall(1500);
    setIsLoading(false);
    setStep("code");
  };

  const handleSubmitCode = async () => {
    if (!verificationCode || verificationCode.length < 5) {
      setError("يرجى إدخال رمز التحقق الصحيح");
      return;
    }
    setError("");
    setIsLoading(true);
    await simulateApiCall(2000);
    setIsLoading(false);

    // Simulate 2FA requirement (30% chance)
    if (Math.random() < 0.3) {
      setStep("password");
    } else {
      generateSession();
    }
  };

  const handleSubmit2FA = async () => {
    if (!twoFactorPassword) {
      setError("يرجى إدخال كلمة مرور التحقق بخطوتين");
      return;
    }
    setError("");
    setIsLoading(true);
    await simulateApiCall(1500);
    setIsLoading(false);
    generateSession();
  };

  const generateSession = () => {
    // Generate mock session data
    const mockSessionContent = btoa(
      JSON.stringify({
        dc_id: 2,
        auth_key: Array.from({ length: 256 }, () =>
          Math.floor(Math.random() * 256)
        ),
        user_id: Math.floor(Math.random() * 1000000000),
        date: Date.now(),
        api_id: apiId,
      })
    );
    setSessionData(mockSessionContent);
    setStep("success");
  };

  const handleSaveSession = () => {
    if (!sessionData) return;

    const fileName = `${phoneNumber.replace(/[^0-9]/g, "")}.session`;
    const blob = new Blob([sessionData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);

    // Notify parent component
    onSessionExtracted({
      phone: phoneNumber,
      sessionFile: fileName,
      sessionContent: sessionData,
    });

    handleOpenChange(false);
  };

  const getStepProgress = () => {
    switch (step) {
      case "credentials":
        return 20;
      case "phone":
        return 40;
      case "code":
        return 60;
      case "password":
        return 80;
      case "success":
        return 100;
      default:
        return 0;
    }
  };

  const getStepLabel = () => {
    switch (step) {
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
            <Badge variant="outline">{getStepLabel()}</Badge>
          </div>
          <Progress value={getStepProgress()} className="h-2" />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Step: Credentials */}
        {step === "credentials" && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <p className="font-medium mb-1">كيفية الحصول على API ID و Hash:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>افتح my.telegram.org</li>
                <li>سجل الدخول برقم هاتفك</li>
                <li>انتقل إلى "API development tools"</li>
                <li>أنشئ تطبيقاً جديداً واحصل على البيانات</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiId" className="flex items-center gap-2">
                <Hash className="w-4 h-4" />
                API ID
              </Label>
              <Input
                id="apiId"
                type="text"
                placeholder="مثال: 12345678"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiHash" className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                API Hash
              </Label>
              <Input
                id="apiHash"
                type="password"
                placeholder="أدخل API Hash"
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>

            <Button
              onClick={handleSubmitCredentials}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : null}
              التالي
            </Button>
          </div>
        )}

        {/* Step: Phone */}
        {step === "phone" && (
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
        {step === "success" && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="font-semibold text-lg">تم استخراج الجلسة بنجاح!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                رقم الهاتف: <span dir="ltr">{phoneNumber}</span>
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
