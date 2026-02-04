import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type AuthStep = 'credentials' | 'phone' | 'code' | 'password' | 'success';

interface SessionData {
  phone: string;
  sessionFile: string;
  sessionContent: string;
}

interface UseTelegramAuthReturn {
  step: AuthStep;
  isLoading: boolean;
  error: string;
  sessionId: string | null;
  sessionData: SessionData | null;
  sendCode: (apiId: string, apiHash: string, phoneNumber: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  verify2FA: (password: string) => Promise<boolean>;
  getSession: () => Promise<SessionData | null>;
  reset: () => void;
}

export function useTelegramAuth(): UseTelegramAuthReturn {
  const [step, setStep] = useState<AuthStep>('credentials');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');

  const reset = () => {
    setStep('credentials');
    setIsLoading(false);
    setError('');
    setSessionId(null);
    setSessionData(null);
    setPhoneNumber('');
  };


  const sendCode = async (apiId: string, apiHash: string, phone: string): Promise<boolean> => {

    if (!apiId || !apiHash) {
      setError('يرجى إدخال API ID و API Hash');
      return false;
    }
    if (!phone) {
      setError('يرجى إدخال رقم الهاتف');
      return false;
    }

    // Validate phone format
    if (!/^\+\d{10,15}$/.test(phone)) {
      setError('صيغة رقم الهاتف غير صحيحة. استخدم +[رمز الدولة][الرقم]');
      return false;
    }

    setError('');
    setIsLoading(true);
    setPhoneNumber(phone);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auth', {
        body: {
          action: 'sendCode',
          apiId,
          apiHash,
          phoneNumber: phone,
        },
      });

      if (fnError) {
        console.error('Function error:', fnError);
        setError('فشل الاتصال بالخادم. حاول مرة أخرى.');
        return false;
      }

      if (data.error) {
        setError(data.error);
        return false;
      }

      setSessionId(data.sessionId);
      setStep('code');
      console.log('Code sent successfully:', data);
      return true;
    } catch (err) {
      console.error('Send code error:', err);
      setError('حدث خطأ غير متوقع');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyCode = async (code: string): Promise<boolean> => {
    if (!code || code.length < 5) {
      setError('يرجى إدخال رمز التحقق الصحيح');
      return false;
    }

    if (!sessionId) {
      setError('الجلسة غير صالحة. أعد المحاولة.');
      return false;
    }

    setError('');
    setIsLoading(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auth', {
        body: {
          action: 'verifyCode',
          sessionId,
          code,
        },
      });

      if (fnError) {
        console.error('Function error:', fnError);
        setError('فشل التحقق من الرمز');
        return false;
      }

      if (data.error) {
        setError(data.error);
        return false;
      }

      if (data.requiresPassword) {
        setStep('password');
      } else {
        // Get session directly
        const session = await getSession();
        if (session) {
          setStep('success');
        }
      }
      return true;
    } catch (err) {
      console.error('Verify code error:', err);
      setError('حدث خطأ غير متوقع');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const verify2FA = async (password: string): Promise<boolean> => {
    if (!password) {
      setError('يرجى إدخال كلمة مرور التحقق بخطوتين');
      return false;
    }

    if (!sessionId) {
      setError('الجلسة غير صالحة. أعد المحاولة.');
      return false;
    }

    setError('');
    setIsLoading(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auth', {
        body: {
          action: 'verify2FA',
          sessionId,
          password,
        },
      });

      if (fnError) {
        console.error('Function error:', fnError);
        setError('فشل التحقق من كلمة المرور');
        return false;
      }

      if (data.error) {
        setError(data.error);
        return false;
      }

      // Get session after 2FA
      const session = await getSession();
      if (session) {
        setStep('success');
      }
      return true;
    } catch (err) {
      console.error('Verify 2FA error:', err);
      setError('حدث خطأ غير متوقع');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const getSession = async (): Promise<SessionData | null> => {
    if (!sessionId) {
      setError('الجلسة غير صالحة');
      return null;
    }

    try {
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auth', {
        body: {
          action: 'getSession',
          sessionId,
        },
      });

      if (fnError || data.error) {
        console.error('Get session error:', fnError || data.error);
        setError('فشل استخراج الجلسة');
        return null;
      }

      const result: SessionData = {
        phone: data.phone || phoneNumber,
        sessionFile: `${(data.phone || phoneNumber).replace(/[^0-9]/g, '')}.session`,
        sessionContent: data.sessionString,
      };

      setSessionData(result);
      return result;
    } catch (err) {
      console.error('Get session error:', err);
      setError('حدث خطأ غير متوقع');
      return null;
    }
  };

  return {
    step,
    isLoading,
    error,
    sessionId,
    sessionData,
    sendCode,
    verifyCode,
    verify2FA,
    getSession,
    reset,
  };
}
